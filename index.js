const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // Client script is loaded from index.html (CDN); avoid serving socket.io maps from this host.
  serveClient: false,
  cors: { origin: "*" },
  pingInterval: 25000,
  pingTimeout: 30000,
  transports: ["polling", "websocket"],
  allowUpgrades: true,
  httpCompression: true,
  perMessageDeflate: true,
  upgradeTimeout: 30000,
});

// ── Logging ─────────────────────────────────────────────────────────────────

let logSeq = 0;
function log(category, message, data = {}) {
  const seq = ++logSeq;
  const ts = new Date().toISOString();
  const dataStr = Object.keys(data).length > 0 ? " " + JSON.stringify(data) : "";
  console.log(`[${ts}] #${seq} [${category}] ${message}${dataStr}`);
}

function logRoom(room) {
  if (!room) return { room: null };
  return {
    code: room.code,
    phase: room.phase,
    playerCount: room.players.length,
    players: room.players.map((p) => ({
      name: p.name,
      id: p.id.substring(0, 8),
      ready: p.ready,
      disconnectedAt: p.disconnectedAt || null,
    })),
    turn: room.turn ? room.turn.substring(0, 8) : null,
    winner: room.winner ? room.winner.substring(0, 8) : null,
    guessCount: Object.fromEntries(
      Object.entries(room.guesses).map(([k, v]) => [k.substring(0, 8), v.length])
    ),
    hasReconnectTimers: room._reconnectTimers
      ? Object.keys(room._reconnectTimers).length
      : 0,
  };
}

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
const RECONNECT_GRACE_MS = 20000;

function generateRoomCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function clearTurnTimer(room) {
  if (room.turnTimer) {
    clearInterval(room.turnTimer);
    room.turnTimer = null;
  }
}

function startTurnTimer(room, options = {}) {
  const resetTimeLeft = options.resetTimeLeft !== false;
  clearTurnTimer(room);
  if (!room.turnTime || room.turnTime <= 0) return;

  if (resetTimeLeft) {
    room.timeLeft = room.turnTime;
  } else {
    const left = room.timeLeft;
    if (left == null || left <= 0) {
      room.timeLeft = room.turnTime;
    } else {
      room.timeLeft = Math.min(left, room.turnTime);
    }
  }
  io.to(room.code).emit("timer-tick", { timeLeft: room.timeLeft, turnTime: room.turnTime });

  room.turnTimer = setInterval(() => {
    room.timeLeft--;
    io.to(room.code).emit("timer-tick", { timeLeft: room.timeLeft, turnTime: room.turnTime });

    if (room.timeLeft <= 0) {
      clearTurnTimer(room);
      if (room.phase !== "playing" || room.players.length < 2) return;

      const skippedPlayer = room.players.find((p) => p.id === room.turn);
      const opponent = room.players.find((p) => p.id !== room.turn);
      if (!opponent) return;

      log("TIMER", `Turn skipped for ${skippedPlayer ? skippedPlayer.name : "unknown"}`, { room: room.code });
      room.turn = opponent.id;

      room.players.forEach((p) => {
        const myGuesses = room.guesses[p.id];
        const opponentGuesses = room.guesses[room.players.find((o) => o.id !== p.id).id];

        io.to(p.id).emit("turn-skipped", {
          isYourTurn: p.id === room.turn,
          yourGuesses: myGuesses,
          opponentGuesses: opponentGuesses,
          skippedPlayerId: skippedPlayer ? skippedPlayer.id : null,
        });
      });

      startTurnTimer(room);
    }
  }, 1000);
}

const CHAT_MAX_LEN = 500;

function sanitizeChatText(raw) {
  if (typeof raw !== "string") return null;
  const noNull = raw.replace(/\0/g, "");
  const collapsed = noNull.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  if (collapsed.length > CHAT_MAX_LEN) return collapsed.slice(0, CHAT_MAX_LEN);
  return collapsed;
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
  const sid = socket.id.substring(0, 8);

  log("CONN", `Socket connected`, { sid, transport: socket.conn.transport.name, remoteAddr: socket.handshake.address });

  socket.conn.on("upgrade", (transport) => {
    log("CONN", `Transport upgraded`, { sid, from: "polling", to: transport.name });
  });

  socket.conn.on("packetCreate", (packet) => {
    if (packet.type === "ping") {
      log("PING", `Server sent ping`, { sid, transport: socket.conn.transport.name });
    }
  });

  socket.conn.on("packet", (packet) => {
    if (packet.type === "pong") {
      log("PONG", `Client responded pong`, { sid, transport: socket.conn.transport.name });
    }
  });

  socket.conn.on("close", (reason, description) => {
    log("CONN", `Engine transport closed`, { sid, reason, description: description ? String(description) : null, transport: socket.conn.transport.name });
  });

  socket.on("create-room", ({ name, digitLength, turnTime }) => {
    log("ROOM", `create-room requested`, { sid, name, digitLength, turnTime });

    const len = parseInt(digitLength, 10);
    if (isNaN(len) || len < 2 || len > 8) {
      log("ROOM", `create-room rejected: invalid digit length`, { sid, digitLength });
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

    log("ROOM", `Room created`, { sid, name, room: logRoom(room) });
    socket.emit("room-created", { code, digitLength: len, turnTime: validTurnTime, playerName: name });
  });

  socket.on("join-room", ({ code, name }) => {
    const roomCode = code.toUpperCase().trim();
    const room = rooms.get(roomCode);

    log("ROOM", `join-room requested`, { sid, name, roomCode, roomExists: !!room });

    if (!room) {
      log("ROOM", `join-room failed: room not found`, { sid, roomCode, totalRooms: rooms.size });
      socket.emit("error-msg", "Room not found.");
      return;
    }
    if (room.players.length >= 2) {
      log("ROOM", `join-room failed: room full`, { sid, roomCode, room: logRoom(room) });
      socket.emit("error-msg", "Room is full.");
      return;
    }
    if (room.phase !== "waiting") {
      log("ROOM", `join-room failed: game in progress`, { sid, roomCode, phase: room.phase });
      socket.emit("error-msg", "Game already in progress.");
      return;
    }

    room.players.push({ id: socket.id, name, secret: null, ready: false });
    room.guesses[socket.id] = [];
    room.phase = "setting";

    socket.join(roomCode);
    currentRoom = roomCode;

    log("ROOM", `Player joined room`, { sid, name, room: logRoom(room) });

    const names = room.players.map((p) => p.name);
    io.to(roomCode).emit("game-start-set-secret", {
      digitLength: room.digitLength,
      players: names,
    });
  });

  socket.on("rejoin-room", ({ code, name }) => {
    const roomCode = code.toUpperCase().trim();
    const room = rooms.get(roomCode);

    log("REJOIN", `rejoin-room requested`, { sid, name, roomCode, roomExists: !!room });

    if (!room) {
      log("REJOIN", `rejoin-room FAILED: room not found`, { sid, name, roomCode, totalRooms: rooms.size, allRoomCodes: Array.from(rooms.keys()) });
      socket.emit("rejoin-failed", { reason: "room_not_found" });
      return;
    }

    const player = room.players.find((p) => p.name === name);
    if (!player) {
      log("REJOIN", `rejoin-room FAILED: player not in room`, { sid, name, roomCode, room: logRoom(room) });
      socket.emit("rejoin-failed", { reason: "player_not_found" });
      return;
    }

    if (room._reconnectTimers && room._reconnectTimers[name]) {
      clearTimeout(room._reconnectTimers[name]);
      delete room._reconnectTimers[name];
      log("REJOIN", `Cleared reconnect timer for ${name}`, { sid, roomCode });
    }
    delete player.disconnectedAt;

    const oldId = player.id;
    if (oldId !== socket.id) {
      log("REJOIN", `Migrating socket ID`, { sid, name, oldId: oldId.substring(0, 8), newId: sid });
      room.guesses[socket.id] = room.guesses[oldId] || [];
      delete room.guesses[oldId];
      player.id = socket.id;
      if (room.turn === oldId) room.turn = socket.id;
      if (room.winner === oldId) room.winner = socket.id;
    }

    socket.join(roomCode);
    currentRoom = roomCode;

    const allConnected = room.players.every((p) => !p.disconnectedAt);
    if (room.phase === "playing" && room.turnTime > 0 && room.timeLeft > 0 && allConnected) {
      log("REJOIN", `Restarting turn timer (all players connected)`, { sid, roomCode, timeLeft: room.timeLeft });
      startTurnTimer(room, { resetTimeLeft: false });
    }

    const opponent = room.players.find((p) => p.id !== socket.id);
    const myGuesses = room.guesses[socket.id] || [];
    const opponentGuesses = opponent ? (room.guesses[opponent.id] || []) : [];

    log("REJOIN", `rejoin-room SUCCESS`, { sid, name, room: logRoom(room) });

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
      winnerName: room.winner ? (room.players.find((p) => p.id === room.winner) || {}).name : null,
      youWon: room.winner === socket.id,
      opponentSecret: opponent ? opponent.secret : null,
    });

    if (opponent && !opponent.disconnectedAt) {
      io.to(opponent.id).emit("opponent-reconnected", { name: player.name });
    }
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
    if (new Set(s).size !== s.length) {
      socket.emit("error-msg", "No repeated digits allowed.");
      return;
    }

    player.secret = s;
    player.ready = true;

    log("GAME", `Secret set`, { sid, name: player.name, room: currentRoom });
    socket.emit("secret-accepted");

    if (room.players.every((p) => p.ready)) {
      room.phase = "playing";
      const starter = room.players[Math.floor(Math.random() * room.players.length)];
      room.turn = starter.id;

      log("GAME", `Game phase -> playing`, { room: currentRoom, starter: starter.name });

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
    if (new Set(g).size !== g.length) {
      socket.emit("error-msg", "No repeated digits allowed.");
      return;
    }

    const player = room.players.find((p) => p.id === socket.id);
    const opponent = room.players.find((p) => p.id !== socket.id);
    const result = evaluateGuess(opponent.secret, g);

    room.guesses[socket.id].push({ guess: g, ...result });

    log("GAME", `Guess made`, { sid, name: player ? player.name : "?", guess: g, result, room: currentRoom, guessNum: room.guesses[socket.id].length });

    if (result.positionsCorrect === room.digitLength) {
      room.phase = "finished";
      room.winner = socket.id;
      clearTurnTimer(room);

      const guesser = room.players.find((p) => p.id === socket.id);
      log("GAME", `Game over! Winner: ${guesser.name}`, { room: currentRoom, attempts: room.guesses[socket.id].length });

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

  socket.on("chat-message", ({ text }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.players.length !== 2) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    const cleaned = sanitizeChatText(text);
    if (!cleaned) return;

    log("CHAT", `Message`, { sid, room: currentRoom, from: player.name, len: cleaned.length });
    io.to(currentRoom).emit("chat-message", {
      from: player.name,
      text: cleaned,
      ts: Date.now(),
    });
  });

  socket.on("play-again", () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    player.wantsRematch = true;
    log("GAME", `Rematch requested`, { sid, name: player.name, room: currentRoom });

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

      log("GAME", `Rematch starting`, { room: currentRoom });

      const names = room.players.map((p) => p.name);
      io.to(currentRoom).emit("game-start-set-secret", {
        digitLength: room.digitLength,
        players: names,
      });
    } else {
      socket.emit("waiting-for-rematch");
    }
  });

  socket.on("disconnect", (reason) => {
    log("DISC", `Socket disconnected`, { sid, reason, hadRoom: !!currentRoom, roomCode: currentRoom });

    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) {
      log("DISC", `Room already gone on disconnect`, { sid, roomCode: currentRoom });
      return;
    }

    const player = room.players.find((p) => p.id === socket.id);
    const pName = player ? player.name : null;

    if (!player) {
      log("DISC", `Player not found in room on disconnect (already removed?)`, { sid, roomCode: currentRoom, room: logRoom(room) });
      return;
    }

    log("DISC", `Player disconnecting`, { sid, name: pName, phase: room.phase, room: logRoom(room) });

    if (room.phase === "playing" || room.phase === "setting" || room.phase === "finished") {
      // During an active round, the turn clock keeps running on the server while someone is
      // disconnected — real time counts down so reconnecting players sync to the same deadline.
      if (room.phase !== "playing") {
        clearTurnTimer(room);
      }

      player.disconnectedAt = Date.now();

      const opponent = room.players.find((p) => p.id !== socket.id);
      if (opponent && !opponent.disconnectedAt) {
        io.to(opponent.id).emit("opponent-disconnected", { name: pName, graceMs: RECONNECT_GRACE_MS });
      }

      const savedRoom = currentRoom;
      const reconnectTimeout = setTimeout(() => {
        const r = rooms.get(savedRoom);
        if (!r) {
          log("DISC", `Reconnect timer fired but room gone`, { name: pName, roomCode: savedRoom });
          return;
        }
        const p = r.players.find((pl) => pl.name === pName);
        if (!p || !p.disconnectedAt) {
          log("DISC", `Reconnect timer fired but player already reconnected`, { name: pName, roomCode: savedRoom });
          return;
        }

        log("DISC", `Reconnect grace expired, removing player`, { name: pName, roomCode: savedRoom, phase: r.phase, room: logRoom(r) });

        r.players = r.players.filter((pl) => pl.name !== pName);
        delete r.guesses[p.id];

        if (r.players.length === 0) {
          log("DISC", `Room empty after removal, deleting`, { roomCode: savedRoom });
          clearTurnTimer(r);
          rooms.delete(savedRoom);
        } else {
          io.to(savedRoom).emit("opponent-left", { name: pName });
          r.phase = "waiting";
          r.winner = null;
          r.turn = null;
          r.players.forEach((pl) => {
            pl.secret = null;
            pl.ready = false;
            r.guesses[pl.id] = [];
          });
          log("DISC", `Room reset to waiting`, { roomCode: savedRoom, room: logRoom(r) });
        }
      }, RECONNECT_GRACE_MS);

      if (!room._reconnectTimers) room._reconnectTimers = {};
      room._reconnectTimers[pName] = reconnectTimeout;
      log("DISC", `Reconnect timer set (${RECONNECT_GRACE_MS}ms)`, { name: pName, roomCode: savedRoom });
    } else {
      log("DISC", `Phase is "${room.phase}", applying grace period anyway`, { sid, name: pName, roomCode: currentRoom });

      player.disconnectedAt = Date.now();

      const savedRoom = currentRoom;
      const reconnectTimeout = setTimeout(() => {
        const r = rooms.get(savedRoom);
        if (!r) return;
        const p = r.players.find((pl) => pl.name === pName);
        if (!p || !p.disconnectedAt) return;

        log("DISC", `Grace expired in "${r.phase}" phase, removing player`, { name: pName, roomCode: savedRoom });

        r.players = r.players.filter((pl) => pl.name !== pName);
        delete r.guesses[p.id];

        if (r.players.length === 0) {
          rooms.delete(savedRoom);
        } else {
          io.to(savedRoom).emit("opponent-left", { name: pName });
          r.phase = "waiting";
          r.winner = null;
          r.turn = null;
          r.players.forEach((pl) => {
            pl.secret = null;
            pl.ready = false;
            r.guesses[pl.id] = [];
          });
        }
      }, RECONNECT_GRACE_MS);

      if (!room._reconnectTimers) room._reconnectTimers = {};
      room._reconnectTimers[pName] = reconnectTimeout;
    }
  });
});

// ── Cleanup stale rooms every 30 minutes ────────────────────────────────────

setInterval(() => {
  let cleaned = 0;
  for (const [code, room] of rooms) {
    if (room.players.length === 0) {
      clearTurnTimer(room);
      rooms.delete(code);
      cleaned++;
    }
  }
  if (cleaned > 0 || rooms.size > 0) {
    log("CLEANUP", `Periodic cleanup`, { removed: cleaned, remaining: rooms.size });
  }
}, 30 * 60 * 1000);

// ── Periodic state snapshot ─────────────────────────────────────────────────

setInterval(() => {
  if (rooms.size === 0) return;
  const snapshot = [];
  for (const [code, room] of rooms) {
    snapshot.push(logRoom(room));
  }
  log("SNAPSHOT", `Active rooms`, { count: rooms.size, rooms: snapshot });
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log("SERVER", `Server started`, { port: PORT, nodeVersion: process.version, pid: process.pid });
});

process.on("SIGTERM", () => {
  log("SERVER", `SIGTERM received, shutting down`, { activeRooms: rooms.size });
  io.emit("server-shutdown");
  server.close(() => {
    log("SERVER", `Server closed`);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
});

process.on("SIGINT", () => {
  log("SERVER", `SIGINT received, shutting down`, { activeRooms: rooms.size });
  io.emit("server-shutdown");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
});

process.on("uncaughtException", (err) => {
  log("FATAL", `Uncaught exception (NOT exiting — kept alive)`, { error: err.message, stack: err.stack });
});

process.on("unhandledRejection", (reason) => {
  log("FATAL", `Unhandled rejection`, { reason: String(reason) });
});
