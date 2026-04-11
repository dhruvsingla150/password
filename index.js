const uWS = require("uWebSockets.js");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ── Logging ─────────────────────────────────────────────────────────────────
const LOG_LEVEL = (process.env.LOG_LEVEL || "normal").toLowerCase();
const VERBOSE = LOG_LEVEL === "verbose";
const QUIET = LOG_LEVEL === "quiet";

let logSeq = 0;
function log(category, message, data = {}) {
  if (QUIET) return;
  const seq = ++logSeq;
  const ts = new Date().toISOString();
  const dataStr = Object.keys(data).length > 0 ? " " + JSON.stringify(data) : "";
  console.log(`[${ts}] #${seq} [${category}] ${message}${dataStr}`);
}

// ── MIME types for static file serving ──────────────────────────────────────
const MIME_TYPES = {
  ".html": "text/html; charset=UTF-8",
  ".css": "text/css; charset=UTF-8",
  ".js": "application/javascript; charset=UTF-8",
  ".json": "application/json; charset=UTF-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

const PUBLIC_DIR = path.join(__dirname, "public");

function serveStaticFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || "application/octet-stream";

  let fileContent;
  try {
    fileContent = fs.readFileSync(filePath);
  } catch {
    res.writeStatus("404 Not Found").end("Not Found");
    return;
  }
  res.writeHeader("Content-Type", mime);
  res.writeHeader("Access-Control-Allow-Origin", "*");
  res.end(fileContent);
}

// ── Game State ──────────────────────────────────────────────────────────────
const rooms = new Map();
const sockets = new Map(); // socketId -> ws
const RECONNECT_GRACE_MS = 20000;

let nextSocketId = 1;

const ROOM_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function generateRoomCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[(Math.random() * 36) | 0];
  }
  return code;
}

function generateSocketId() {
  return "s_" + (nextSocketId++) + "_" + crypto.randomBytes(4).toString("hex");
}

// ── WebSocket helpers ───────────────────────────────────────────────────────

function wsSend(ws, event, data) {
  try {
    const msg = JSON.stringify({ e: event, d: data });
    ws.send(msg, false);
  } catch { /* socket already closed */ }
}

function broadcastToRoom(roomCode, event, data) {
  const msg = JSON.stringify({ e: event, d: data });
  app.publish("room:" + roomCode, msg, false);
}

function sendToSocket(socketId, event, data) {
  const ws = sockets.get(socketId);
  if (ws) wsSend(ws, event, data);
}

// ── Turn Timer ──────────────────────────────────────────────────────────────

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
  broadcastToRoom(room.code, "timer-tick", { timeLeft: room.timeLeft, turnTime: room.turnTime });

  room.turnTimer = setInterval(() => {
    room.timeLeft--;
    broadcastToRoom(room.code, "timer-tick", { timeLeft: room.timeLeft, turnTime: room.turnTime });

    if (room.timeLeft <= 0) {
      clearTurnTimer(room);
      if (room.phase !== "playing" || room.players.length < 2) return;

      const skippedPlayer = room.players.find((p) => p.id === room.turn);
      const opponent = room.players.find((p) => p.id !== room.turn);
      if (!opponent) return;

      log("TIMER", `Turn skipped for ${skippedPlayer ? skippedPlayer.name : "unknown"}`, { room: room.code });
      room.turn = opponent.id;

      for (const p of room.players) {
        const opp = room.players.find((o) => o.id !== p.id);
        sendToSocket(p.id, "turn-skipped", {
          isYourTurn: p.id === room.turn,
          yourGuesses: room.guesses[p.id],
          opponentGuesses: room.guesses[opp.id],
          skippedPlayerId: skippedPlayer ? skippedPlayer.id : null,
        });
      }

      startTurnTimer(room);
    }
  }, 1000);
}

// ── Chat helpers ────────────────────────────────────────────────────────────

const CHAT_MAX_LEN = 500;

function sanitizeChatText(raw) {
  if (typeof raw !== "string") return null;
  const noNull = raw.replace(/\0/g, "");
  const collapsed = noNull.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  if (collapsed.length > CHAT_MAX_LEN) return collapsed.slice(0, CHAT_MAX_LEN);
  return collapsed;
}

// ── Game logic ──────────────────────────────────────────────────────────────

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

// ── Event Handlers ──────────────────────────────────────────────────────────

function handleCreateRoom(ws, { name, digitLength, turnTime }) {
  const socketId = ws.socketId;
  const sid = socketId.substring(0, 8);
  if (VERBOSE) log("ROOM", `create-room requested`, { sid, name, digitLength, turnTime });

  const len = parseInt(digitLength, 10);
  if (isNaN(len) || len < 2 || len > 8) {
    if (VERBOSE) log("ROOM", `create-room rejected: invalid digit length`, { sid, digitLength });
    wsSend(ws, "error-msg", "Digit length must be between 2 and 8.");
    return;
  }

  const tt = parseInt(turnTime, 10);
  const validTurnTime = isNaN(tt) || tt < 0 ? 0 : Math.min(tt, 300);

  const code = generateRoomCode();
  const room = {
    code,
    digitLength: len,
    turnTime: validTurnTime,
    players: [{ id: socketId, name, secret: null, ready: false }],
    guesses: { [socketId]: [] },
    turn: null,
    phase: "waiting",
    winner: null,
    turnTimer: null,
    timeLeft: 0,
  };

  rooms.set(code, room);
  ws.subscribe("room:" + code);
  ws.currentRoom = code;

  if (VERBOSE) log("ROOM", `Room created`, { sid, name, room: logRoom(room) });
  wsSend(ws, "room-created", { code, digitLength: len, turnTime: validTurnTime, playerName: name });
}

function handleJoinRoom(ws, { code, name }) {
  const socketId = ws.socketId;
  const sid = socketId.substring(0, 8);
  const roomCode = code.toUpperCase().trim();
  const room = rooms.get(roomCode);

  if (VERBOSE) log("ROOM", `join-room requested`, { sid, name, roomCode, roomExists: !!room });

  if (!room) {
    if (VERBOSE) log("ROOM", `join-room failed: room not found`, { sid, roomCode, totalRooms: rooms.size });
    wsSend(ws, "error-msg", "Room not found.");
    return;
  }
  if (room.players.length >= 2) {
    if (VERBOSE) log("ROOM", `join-room failed: room full`, { sid, roomCode, room: logRoom(room) });
    wsSend(ws, "error-msg", "Room is full.");
    return;
  }
  if (room.phase !== "waiting") {
    if (VERBOSE) log("ROOM", `join-room failed: game in progress`, { sid, roomCode, phase: room.phase });
    wsSend(ws, "error-msg", "Game already in progress.");
    return;
  }

  room.players.push({ id: socketId, name, secret: null, ready: false });
  room.guesses[socketId] = [];
  room.phase = "setting";

  ws.subscribe("room:" + roomCode);
  ws.currentRoom = roomCode;

  if (VERBOSE) log("ROOM", `Player joined room`, { sid, name, room: logRoom(room) });

  const names = room.players.map((p) => p.name);
  broadcastToRoom(roomCode, "game-start-set-secret", {
    digitLength: room.digitLength,
    players: names,
  });
}

function handleRejoinRoom(ws, { code, name }) {
  const socketId = ws.socketId;
  const sid = socketId.substring(0, 8);
  const roomCode = code.toUpperCase().trim();
  const room = rooms.get(roomCode);

  if (VERBOSE) log("REJOIN", `rejoin-room requested`, { sid, name, roomCode, roomExists: !!room });

  if (!room) {
    if (VERBOSE) log("REJOIN", `rejoin-room FAILED: room not found`, { sid, name, roomCode, totalRooms: rooms.size, allRoomCodes: Array.from(rooms.keys()) });
    wsSend(ws, "rejoin-failed", { reason: "room_not_found" });
    return;
  }

  const player = room.players.find((p) => p.name === name);
  if (!player) {
    if (VERBOSE) log("REJOIN", `rejoin-room FAILED: player not in room`, { sid, name, roomCode, room: logRoom(room) });
    wsSend(ws, "rejoin-failed", { reason: "player_not_found" });
    return;
  }

  if (room._reconnectTimers && room._reconnectTimers[name]) {
    clearTimeout(room._reconnectTimers[name]);
    delete room._reconnectTimers[name];
    if (VERBOSE) log("REJOIN", `Cleared reconnect timer for ${name}`, { sid, roomCode });
  }
  delete player.disconnectedAt;

  const oldId = player.id;
  if (oldId !== socketId) {
    if (VERBOSE) log("REJOIN", `Migrating socket ID`, { sid, name, oldId: oldId.substring(0, 8), newId: sid });
    room.guesses[socketId] = room.guesses[oldId] || [];
    delete room.guesses[oldId];
    player.id = socketId;
    if (room.turn === oldId) room.turn = socketId;
    if (room.winner === oldId) room.winner = socketId;
  }

  ws.subscribe("room:" + roomCode);
  ws.currentRoom = roomCode;

  const allConnected = room.players.every((p) => !p.disconnectedAt);
  if (room.phase === "playing" && room.turnTime > 0 && room.timeLeft > 0 && allConnected) {
    if (VERBOSE) log("REJOIN", `Restarting turn timer (all players connected)`, { sid, roomCode, timeLeft: room.timeLeft });
    startTurnTimer(room, { resetTimeLeft: false });
  }

  const opponent = room.players.find((p) => p.id !== socketId);
  const myGuesses = room.guesses[socketId] || [];
  const opponentGuesses = opponent ? (room.guesses[opponent.id] || []) : [];

  if (VERBOSE) log("REJOIN", `rejoin-room SUCCESS`, { sid, name, room: logRoom(room) });

  wsSend(ws, "rejoin-state", {
    code: roomCode,
    phase: room.phase,
    digitLength: room.digitLength,
    turnTime: room.turnTime,
    timeLeft: room.timeLeft || 0,
    yourName: player.name,
    opponentName: opponent ? opponent.name : null,
    yourSecret: player.secret,
    yourSecretSet: player.ready,
    isYourTurn: room.turn === socketId,
    yourGuesses: myGuesses,
    opponentGuesses: opponentGuesses,
    winnerName: room.winner ? (room.players.find((p) => p.id === room.winner) || {}).name : null,
    youWon: room.winner === socketId,
    opponentSecret: opponent ? opponent.secret : null,
  });

  if (opponent && !opponent.disconnectedAt) {
    sendToSocket(opponent.id, "opponent-reconnected", { name: player.name });
  }
}

function handleSetSecret(ws, { secret }) {
  const socketId = ws.socketId;
  const currentRoom = ws.currentRoom;
  if (!currentRoom) return;
  const room = rooms.get(currentRoom);
  if (!room || room.phase !== "setting") return;

  const player = room.players.find((p) => p.id === socketId);
  if (!player) return;

  const s = secret.trim();
  if (s.length !== room.digitLength || !/^\d+$/.test(s)) {
    wsSend(ws, "error-msg", `Secret must be exactly ${room.digitLength} digits (0-9).`);
    return;
  }
  if (new Set(s).size !== s.length) {
    wsSend(ws, "error-msg", "No repeated digits allowed.");
    return;
  }

  player.secret = s;
  player.ready = true;

  if (VERBOSE) log("GAME", `Secret set`, { sid: socketId.substring(0, 8), name: player.name, room: currentRoom });
  wsSend(ws, "secret-accepted", {});

  if (room.players.every((p) => p.ready)) {
    room.phase = "playing";
    const starter = room.players[Math.floor(Math.random() * room.players.length)];
    room.turn = starter.id;

    log("GAME", `Game phase -> playing`, { room: currentRoom, starter: starter.name });

    for (const p of room.players) {
      const opp = room.players.find((o) => o.id !== p.id);
      sendToSocket(p.id, "game-playing", {
        yourName: p.name,
        opponentName: opp.name,
        digitLength: room.digitLength,
        isYourTurn: p.id === room.turn,
        yourSecret: p.secret,
        turnTime: room.turnTime,
      });
    }

    startTurnTimer(room);
  } else {
    wsSend(ws, "waiting-for-opponent-secret", {});
  }
}

function handleMakeGuess(ws, { guess }) {
  const socketId = ws.socketId;
  const currentRoom = ws.currentRoom;
  if (!currentRoom) return;
  const room = rooms.get(currentRoom);
  if (!room || room.phase !== "playing") return;

  if (socketId !== room.turn) {
    wsSend(ws, "error-msg", "It's not your turn.");
    return;
  }

  const g = guess.trim();
  if (g.length !== room.digitLength || !/^\d+$/.test(g)) {
    wsSend(ws, "error-msg", `Guess must be exactly ${room.digitLength} digits.`);
    return;
  }
  if (new Set(g).size !== g.length) {
    wsSend(ws, "error-msg", "No repeated digits allowed.");
    return;
  }

  const p0 = room.players[0];
  const p1 = room.players[1];
  const isP0 = socketId === p0.id;
  const player = isP0 ? p0 : p1;
  const opponent = isP0 ? p1 : p0;
  const result = evaluateGuess(opponent.secret, g);
  const entry = { guess: g, numbersCorrect: result.numbersCorrect, positionsCorrect: result.positionsCorrect };

  room.guesses[socketId].push(entry);

  if (VERBOSE) log("GAME", `Guess made`, { sid: socketId.substring(0, 8), name: player.name, guess: g, result, room: currentRoom, guessNum: room.guesses[socketId].length });

  if (result.positionsCorrect === room.digitLength) {
    room.phase = "finished";
    room.winner = socketId;
    clearTurnTimer(room);

    log("GAME", `Game over! Winner: ${player.name}`, { room: currentRoom, attempts: room.guesses[socketId].length });

    const myGuesses = room.guesses[player.id];
    const oppGuesses = room.guesses[opponent.id];

    wsSend(ws, "game-over", {
      winnerName: player.name,
      youWon: true,
      yourSecret: player.secret,
      opponentSecret: opponent.secret,
      yourGuesses: myGuesses,
      opponentGuesses: oppGuesses,
      totalRounds: myGuesses.length,
    });

    sendToSocket(opponent.id, "game-over", {
      winnerName: player.name,
      youWon: false,
      yourSecret: opponent.secret,
      opponentSecret: player.secret,
      yourGuesses: oppGuesses,
      opponentGuesses: myGuesses,
      totalRounds: oppGuesses.length,
    });

    return;
  }

  room.turn = opponent.id;

  wsSend(ws, "guess-result", {
    isYourTurn: false,
    lastGuess: entry,
    guessNumber: room.guesses[player.id].length,
  });

  sendToSocket(opponent.id, "guess-result", {
    isYourTurn: true,
    lastGuess: { guess: g, numbersCorrect: result.numbersCorrect, positionsCorrect: result.positionsCorrect },
    guessNumber: room.guesses[player.id].length,
  });

  startTurnTimer(room);
}

function handleChatMessage(ws, { text }) {
  const socketId = ws.socketId;
  const currentRoom = ws.currentRoom;
  if (!currentRoom) return;
  const room = rooms.get(currentRoom);
  if (!room || room.players.length !== 2) return;

  const player = room.players.find((p) => p.id === socketId);
  if (!player) return;

  const cleaned = sanitizeChatText(text);
  if (!cleaned) return;

  if (VERBOSE) log("CHAT", `Message`, { sid: socketId.substring(0, 8), room: currentRoom, from: player.name, len: cleaned.length });
  broadcastToRoom(currentRoom, "chat-message", {
    from: player.name,
    text: cleaned,
    ts: Date.now(),
  });
}

function handlePlayAgain(ws) {
  const socketId = ws.socketId;
  const currentRoom = ws.currentRoom;
  if (!currentRoom) return;
  const room = rooms.get(currentRoom);
  if (!room) return;

  const player = room.players.find((p) => p.id === socketId);
  if (!player) return;

  player.wantsRematch = true;
  if (VERBOSE) log("GAME", `Rematch requested`, { sid: socketId.substring(0, 8), name: player.name, room: currentRoom });

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

    if (VERBOSE) log("GAME", `Rematch starting`, { room: currentRoom });

    const names = room.players.map((p) => p.name);
    broadcastToRoom(currentRoom, "game-start-set-secret", {
      digitLength: room.digitLength,
      players: names,
    });
  } else {
    wsSend(ws, "waiting-for-rematch", {});
  }
}

function handleDisconnect(ws) {
  const socketId = ws.socketId;
  const currentRoom = ws.currentRoom;
  sockets.delete(socketId);

  if (VERBOSE) log("DISC", `Socket disconnected`, { sid: socketId.substring(0, 8), hadRoom: !!currentRoom, roomCode: currentRoom });

  if (!currentRoom) return;
  const room = rooms.get(currentRoom);
  if (!room) {
    if (VERBOSE) log("DISC", `Room already gone on disconnect`, { sid: socketId.substring(0, 8), roomCode: currentRoom });
    return;
  }

  const player = room.players.find((p) => p.id === socketId);
  const pName = player ? player.name : null;

  if (!player) {
    if (VERBOSE) log("DISC", `Player not found in room on disconnect (already removed?)`, { sid: socketId.substring(0, 8), roomCode: currentRoom, room: logRoom(room) });
    return;
  }

  if (VERBOSE) log("DISC", `Player disconnecting`, { sid: socketId.substring(0, 8), name: pName, phase: room.phase, room: logRoom(room) });

  if (room.phase === "playing" || room.phase === "setting" || room.phase === "finished") {
    if (room.phase !== "playing") {
      clearTurnTimer(room);
    }

    player.disconnectedAt = Date.now();

    const opponent = room.players.find((p) => p.id !== socketId);
    if (opponent && !opponent.disconnectedAt) {
      sendToSocket(opponent.id, "opponent-disconnected", { name: pName, graceMs: RECONNECT_GRACE_MS });
    }

    const savedRoom = currentRoom;
    const reconnectTimeout = setTimeout(() => {
      const r = rooms.get(savedRoom);
      if (!r) {
        if (VERBOSE) log("DISC", `Reconnect timer fired but room gone`, { name: pName, roomCode: savedRoom });
        return;
      }
      const p = r.players.find((pl) => pl.name === pName);
      if (!p || !p.disconnectedAt) {
        if (VERBOSE) log("DISC", `Reconnect timer fired but player already reconnected`, { name: pName, roomCode: savedRoom });
        return;
      }

      if (VERBOSE) log("DISC", `Reconnect grace expired, removing player`, { name: pName, roomCode: savedRoom, phase: r.phase, room: logRoom(r) });

      r.players = r.players.filter((pl) => pl.name !== pName);
      delete r.guesses[p.id];

      if (r.players.length === 0) {
        if (VERBOSE) log("DISC", `Room empty after removal, deleting`, { roomCode: savedRoom });
        clearTurnTimer(r);
        rooms.delete(savedRoom);
      } else {
        broadcastToRoom(savedRoom, "opponent-left", { name: pName });
        r.phase = "waiting";
        r.winner = null;
        r.turn = null;
        r.players.forEach((pl) => {
          pl.secret = null;
          pl.ready = false;
          r.guesses[pl.id] = [];
        });
        if (VERBOSE) log("DISC", `Room reset to waiting`, { roomCode: savedRoom, room: logRoom(r) });
      }
    }, RECONNECT_GRACE_MS);

    if (!room._reconnectTimers) room._reconnectTimers = {};
    room._reconnectTimers[pName] = reconnectTimeout;
    if (VERBOSE) log("DISC", `Reconnect timer set (${RECONNECT_GRACE_MS}ms)`, { name: pName, roomCode: savedRoom });
  } else {
    if (VERBOSE) log("DISC", `Phase is "${room.phase}", applying grace period anyway`, { sid: socketId.substring(0, 8), name: pName, roomCode: currentRoom });

    player.disconnectedAt = Date.now();

    const savedRoom = currentRoom;
    const reconnectTimeout = setTimeout(() => {
      const r = rooms.get(savedRoom);
      if (!r) return;
      const p = r.players.find((pl) => pl.name === pName);
      if (!p || !p.disconnectedAt) return;

      if (VERBOSE) log("DISC", `Grace expired in "${r.phase}" phase, removing player`, { name: pName, roomCode: savedRoom });

      r.players = r.players.filter((pl) => pl.name !== pName);
      delete r.guesses[p.id];

      if (r.players.length === 0) {
        rooms.delete(savedRoom);
      } else {
        broadcastToRoom(savedRoom, "opponent-left", { name: pName });
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
}

// ── Message Router ──────────────────────────────────────────────────────────

const EVENT_HANDLERS = {
  "create-room": handleCreateRoom,
  "join-room": handleJoinRoom,
  "rejoin-room": handleRejoinRoom,
  "set-secret": handleSetSecret,
  "make-guess": handleMakeGuess,
  "chat-message": handleChatMessage,
  "play-again": handlePlayAgain,
};

// ── uWebSockets App ─────────────────────────────────────────────────────────

const app = uWS.App();

app.ws("/*", {
  maxPayloadLength: 64 * 1024,
  maxBackpressure: 128 * 1024,
  idleTimeout: 120,
  sendPingsAutomatically: true,

  upgrade: (res, req, context) => {
    res.upgrade(
      { socketId: null, currentRoom: null },
      req.getHeader("sec-websocket-key"),
      req.getHeader("sec-websocket-protocol"),
      req.getHeader("sec-websocket-extensions"),
      context
    );
  },

  open: (ws) => {
    const id = generateSocketId();
    ws.socketId = id;
    ws.currentRoom = null;
    sockets.set(id, ws);

    wsSend(ws, "connected", { id });

    if (VERBOSE) log("CONN", `Socket connected`, { sid: id.substring(0, 8) });
  },

  message: (ws, message, isBinary) => {
    let parsed;
    try {
      const text = Buffer.from(message).toString("utf-8");
      parsed = JSON.parse(text);
    } catch {
      return;
    }

    const { e: event, d: data } = parsed;
    if (!event) return;

    const handler = EVENT_HANDLERS[event];
    if (handler) {
      handler(ws, data || {});
    }
  },

  close: (ws, code, message) => {
    handleDisconnect(ws);
  },
});

// ── Static file serving ─────────────────────────────────────────────────────

app.get("/", (res, req) => {
  res.onAborted(() => {});
  serveStaticFile(res, path.join(PUBLIC_DIR, "index.html"));
});

app.get("/*", (res, req) => {
  res.onAborted(() => {});
  const url = req.getUrl();
  const safePath = path.normalize(url).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeStatus("403 Forbidden").end("Forbidden");
    return;
  }

  serveStaticFile(res, filePath);
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
  for (const [, room] of rooms) {
    snapshot.push(logRoom(room));
  }
  log("SNAPSHOT", `Active rooms`, { count: rooms.size, rooms: snapshot });
}, 5 * 60 * 1000);

// ── Start server ────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3000", 10);

app.listen(PORT, (listenSocket) => {
  if (listenSocket) {
    log("SERVER", `Server started`, { port: PORT, nodeVersion: process.version, pid: process.pid, backend: "uWebSockets.js" });
  } else {
    log("SERVER", `Failed to listen on port ${PORT}`);
    process.exit(1);
  }
});

// ── Graceful shutdown ───────────────────────────────────────────────────────

function shutdown(signal) {
  log("SERVER", `${signal} received, shutting down`, { activeRooms: rooms.size });
  for (const [, ws] of sockets) {
    wsSend(ws, "server-shutdown", {});
  }
  setTimeout(() => process.exit(0), 2000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  log("FATAL", `Uncaught exception (NOT exiting — kept alive)`, { error: err.message, stack: err.stack });
});

process.on("unhandledRejection", (reason) => {
  log("FATAL", `Unhandled rejection`, { reason: String(reason) });
});
