const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname, "public")));

// ── Game State ──────────────────────────────────────────────────────────────

const rooms = new Map();

function generateRoomCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function evaluateGuess(secret, guess) {
  const len = secret.length;
  let bulls = 0;
  let cows = 0;
  const secretUnmatched = [];
  const guessUnmatched = [];

  for (let i = 0; i < len; i++) {
    if (guess[i] === secret[i]) {
      bulls++;
    } else {
      secretUnmatched.push(secret[i]);
      guessUnmatched.push(guess[i]);
    }
  }

  for (const digit of guessUnmatched) {
    const idx = secretUnmatched.indexOf(digit);
    if (idx !== -1) {
      cows++;
      secretUnmatched.splice(idx, 1);
    }
  }

  return { bulls, cows };
}

// ── Socket Handlers ─────────────────────────────────────────────────────────

io.on("connection", (socket) => {
  let currentRoom = null;

  socket.on("create-room", ({ name, digitLength }) => {
    const len = parseInt(digitLength, 10);
    if (isNaN(len) || len < 2 || len > 8) {
      socket.emit("error-msg", "Digit length must be between 2 and 8.");
      return;
    }

    const code = generateRoomCode();
    const room = {
      code,
      digitLength: len,
      players: [{ id: socket.id, name, secret: null, ready: false }],
      guesses: { [socket.id]: [] },
      turn: null,
      phase: "waiting", // waiting | setting | playing | finished
      winner: null,
    };

    rooms.set(code, room);
    socket.join(code);
    currentRoom = code;

    socket.emit("room-created", { code, digitLength: len, playerName: name });
  });

  socket.on("join-room", ({ code, name }) => {
    const roomCode = code.toUpperCase().trim();
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit("error-msg", "Room not found.");
      return;
    }
    if (room.players.length >= 2) {
      socket.emit("error-msg", "Room is full.");
      return;
    }
    if (room.phase !== "waiting") {
      socket.emit("error-msg", "Game already in progress.");
      return;
    }

    room.players.push({ id: socket.id, name, secret: null, ready: false });
    room.guesses[socket.id] = [];
    room.phase = "setting";

    socket.join(roomCode);
    currentRoom = roomCode;

    const names = room.players.map((p) => p.name);
    io.to(roomCode).emit("game-start-set-secret", {
      digitLength: room.digitLength,
      players: names,
    });
  });

  socket.on("set-secret", ({ secret }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== "setting") return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    const s = secret.trim();
    if (s.length !== room.digitLength || !/^\d+$/.test(s)) {
      socket.emit("error-msg", `Secret must be exactly ${room.digitLength} digits (0-9).`);
      return;
    }

    player.secret = s;
    player.ready = true;

    socket.emit("secret-accepted");

    if (room.players.every((p) => p.ready)) {
      room.phase = "playing";
      room.turn = room.players[0].id;

      room.players.forEach((p) => {
        const opponent = room.players.find((o) => o.id !== p.id);
        io.to(p.id).emit("game-playing", {
          yourName: p.name,
          opponentName: opponent.name,
          digitLength: room.digitLength,
          isYourTurn: p.id === room.turn,
        });
      });
    } else {
      socket.emit("waiting-for-opponent-secret");
    }
  });

  socket.on("make-guess", ({ guess }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== "playing") return;

    if (socket.id !== room.turn) {
      socket.emit("error-msg", "It's not your turn.");
      return;
    }

    const g = guess.trim();
    if (g.length !== room.digitLength || !/^\d+$/.test(g)) {
      socket.emit("error-msg", `Guess must be exactly ${room.digitLength} digits.`);
      return;
    }

    const opponent = room.players.find((p) => p.id !== socket.id);
    const result = evaluateGuess(opponent.secret, g);

    room.guesses[socket.id].push({ guess: g, ...result });

    if (result.bulls === room.digitLength) {
      room.phase = "finished";
      room.winner = socket.id;

      const guesser = room.players.find((p) => p.id === socket.id);

      room.players.forEach((p) => {
        const myGuesses = room.guesses[p.id];
        const theirGuesses = room.guesses[room.players.find((o) => o.id !== p.id).id];
        const opponentPlayer = room.players.find((o) => o.id !== p.id);

        io.to(p.id).emit("game-over", {
          winnerName: guesser.name,
          youWon: p.id === socket.id,
          yourSecret: p.secret,
          opponentSecret: opponentPlayer.secret,
          yourGuesses: myGuesses,
          opponentGuesses: theirGuesses,
          totalRounds: myGuesses.length,
        });
      });

      return;
    }

    room.turn = opponent.id;

    room.players.forEach((p) => {
      const myGuesses = room.guesses[p.id];
      const opponentGuesses = room.guesses[room.players.find((o) => o.id !== p.id).id];

      io.to(p.id).emit("guess-result", {
        isYourTurn: p.id === room.turn,
        yourGuesses: myGuesses,
        opponentGuesses: opponentGuesses,
      });
    });
  });

  socket.on("play-again", () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    player.wantsRematch = true;

    if (room.players.every((p) => p.wantsRematch)) {
      room.phase = "setting";
      room.winner = null;
      room.turn = null;
      room.players.forEach((p) => {
        p.secret = null;
        p.ready = false;
        p.wantsRematch = false;
        room.guesses[p.id] = [];
      });

      const names = room.players.map((p) => p.name);
      io.to(currentRoom).emit("game-start-set-secret", {
        digitLength: room.digitLength,
        players: names,
      });
    } else {
      socket.emit("waiting-for-rematch");
    }
  });

  socket.on("disconnect", () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    const playerName = player ? player.name : "Opponent";

    room.players = room.players.filter((p) => p.id !== socket.id);

    if (room.players.length === 0) {
      rooms.delete(currentRoom);
    } else {
      io.to(currentRoom).emit("opponent-left", { name: playerName });
      room.phase = "waiting";
      room.winner = null;
      room.turn = null;
      room.players.forEach((p) => {
        p.secret = null;
        p.ready = false;
        room.guesses[p.id] = [];
      });
    }
  });
});

// ── Cleanup stale rooms every 30 minutes ────────────────────────────────────

setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.players.length === 0) {
      rooms.delete(code);
    }
  }
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
