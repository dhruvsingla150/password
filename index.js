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

app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders(res, filePath) {
      if (filePath.endsWith(".js")) {
        res.setHeader("Content-Type", "application/javascript; charset=UTF-8");
      } else if (filePath.endsWith(".css")) {
        res.setHeader("Content-Type", "text/css; charset=UTF-8");
      }
    },
  })
);

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Game State ──────────────────────────────────────────────────────────────

const rooms = new Map();

function generateRoomCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function clearTurnTimer(room) {
  if (room.turnTimer) {
    clearInterval(room.turnTimer);
    room.turnTimer = null;
  }
}

function startTurnTimer(room) {
  clearTurnTimer(room);
  if (!room.turnTime || room.turnTime <= 0) return;

  room.timeLeft = room.turnTime;
  io.to(room.code).emit("timer-tick", { timeLeft: room.timeLeft, turnTime: room.turnTime });

  room.turnTimer = setInterval(() => {
    room.timeLeft--;
    io.to(room.code).emit("timer-tick", { timeLeft: room.timeLeft, turnTime: room.turnTime });

    if (room.timeLeft <= 0) {
      clearTurnTimer(room);
      if (room.phase !== "playing" || room.players.length < 2) return;

      const opponent = room.players.find((p) => p.id !== room.turn);
      if (!opponent) return;

      room.turn = opponent.id;

      room.players.forEach((p) => {
        const myGuesses = room.guesses[p.id];
        const opponentGuesses = room.guesses[room.players.find((o) => o.id !== p.id).id];

        io.to(p.id).emit("turn-skipped", {
          isYourTurn: p.id === room.turn,
          yourGuesses: myGuesses,
          opponentGuesses: opponentGuesses,
          skippedPlayerId: room.players.find((pl) => pl.id !== opponent.id).id,
        });
      });

      startTurnTimer(room);
    }
  }, 1000);
}

function evaluateGuess(secret, guess) {
  const len = secret.length;
  let positionsCorrect = 0;
  let numbersCorrect = 0;
  const secretDigits = secret.split("");

  for (let i = 0; i < len; i++) {
    if (guess[i] === secret[i]) {
      positionsCorrect++;
    }
  }

  for (const digit of guess) {
    const idx = secretDigits.indexOf(digit);
    if (idx !== -1) {
      numbersCorrect++;
      secretDigits.splice(idx, 1);
    }
  }

  return { numbersCorrect, positionsCorrect };
}

// ── Socket Handlers ─────────────────────────────────────────────────────────

io.on("connection", (socket) => {
  let currentRoom = null;

  socket.on("create-room", ({ name, digitLength, turnTime }) => {
    const len = parseInt(digitLength, 10);
    if (isNaN(len) || len < 2 || len > 8) {
      socket.emit("error-msg", "Digit length must be between 2 and 8.");
      return;
    }

    const tt = parseInt(turnTime, 10);
    const validTurnTime = isNaN(tt) || tt < 0 ? 0 : Math.min(tt, 300);

    const code = generateRoomCode();
    const room = {
      code,
      digitLength: len,
      turnTime: validTurnTime,
      players: [{ id: socket.id, name, secret: null, ready: false }],
      guesses: { [socket.id]: [] },
      turn: null,
      phase: "waiting",
      winner: null,
      turnTimer: null,
      timeLeft: 0,
    };

    rooms.set(code, room);
    socket.join(code);
    currentRoom = code;

    socket.emit("room-created", { code, digitLength: len, turnTime: validTurnTime, playerName: name });
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

  socket.on("rejoin-room", ({ code, name }) => {
    const roomCode = code.toUpperCase().trim();
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit("rejoin-failed");
      return;
    }

    const player = room.players.find((p) => p.name === name);
    if (!player) {
      socket.emit("rejoin-failed");
      return;
    }

    if (room._reconnectTimers && room._reconnectTimers[name]) {
      clearTimeout(room._reconnectTimers[name]);
      delete room._reconnectTimers[name];
    }
    delete player.disconnectedAt;

    const oldId = player.id;
    if (oldId !== socket.id) {
      room.guesses[socket.id] = room.guesses[oldId] || [];
      delete room.guesses[oldId];
      player.id = socket.id;
      if (room.turn === oldId) room.turn = socket.id;
      if (room.winner === oldId) room.winner = socket.id;
    }

    socket.join(roomCode);
    currentRoom = roomCode;

    if (room.phase === "playing" && room.turnTime > 0 && room.timeLeft > 0) {
      startTurnTimer(room);
    }

    const opponent = room.players.find((p) => p.id !== socket.id);
    const myGuesses = room.guesses[socket.id] || [];
    const opponentGuesses = opponent ? (room.guesses[opponent.id] || []) : [];

    socket.emit("rejoin-state", {
      code: roomCode,
      phase: room.phase,
      digitLength: room.digitLength,
      turnTime: room.turnTime,
      timeLeft: room.timeLeft || 0,
      yourName: player.name,
      opponentName: opponent ? opponent.name : null,
      yourSecret: player.secret,
      yourSecretSet: player.ready,
      isYourTurn: room.turn === socket.id,
      yourGuesses: myGuesses,
      opponentGuesses: opponentGuesses,
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
          yourSecret: p.secret,
          turnTime: room.turnTime,
        });
      });

      startTurnTimer(room);
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

    if (result.positionsCorrect === room.digitLength) {
      room.phase = "finished";
      room.winner = socket.id;
      clearTurnTimer(room);

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

    startTurnTimer(room);
  });

  socket.on("play-again", () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    player.wantsRematch = true;

    if (room.players.every((p) => p.wantsRematch)) {
      clearTurnTimer(room);
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
    const pName = player ? player.name : "Opponent";

    if (room.phase === "playing" || room.phase === "setting") {
      clearTurnTimer(room);

      if (player) player.disconnectedAt = Date.now();

      const reconnectTimeout = setTimeout(() => {
        const r = rooms.get(currentRoom);
        if (!r) return;
        const p = r.players.find((pl) => pl.name === pName);
        if (!p || !p.disconnectedAt) return;

        r.players = r.players.filter((pl) => pl.name !== pName);
        delete r.guesses[p.id];

        if (r.players.length === 0) {
          rooms.delete(currentRoom);
        } else {
          io.to(currentRoom).emit("opponent-left", { name: pName });
          r.phase = "waiting";
          r.winner = null;
          r.turn = null;
          r.players.forEach((pl) => {
            pl.secret = null;
            pl.ready = false;
            r.guesses[pl.id] = [];
          });
        }
      }, 15000);

      if (!room._reconnectTimers) room._reconnectTimers = {};
      room._reconnectTimers[pName] = reconnectTimeout;
    } else {
      room.players = room.players.filter((p) => p.id !== socket.id);
      delete room.guesses[socket.id];

      if (room.players.length === 0) {
        rooms.delete(currentRoom);
      } else {
        io.to(currentRoom).emit("opponent-left", { name: pName });
        room.phase = "waiting";
        room.winner = null;
        room.turn = null;
        room.players.forEach((p) => {
          p.secret = null;
          p.ready = false;
          room.guesses[p.id] = [];
        });
      }
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
