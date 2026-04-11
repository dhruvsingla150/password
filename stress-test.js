const WebSocket = require("ws");

// ── Configuration ───────────────────────────────────────────────────────────

const SERVER_URL = process.env.SERVER_URL || "https://password-xh9g.onrender.com";
const TOTAL_USERS = parseInt(process.env.USERS || "10000", 10);
const TOTAL_PAIRS = Math.floor(TOTAL_USERS / 2);
const DIGIT_LENGTH = parseInt(process.env.DIGITS || "4", 10);
const TURN_TIME = parseInt(process.env.TURN_TIME || "0", 10);
const GUESS_DELAY_MIN = parseInt(process.env.GUESS_DELAY_MIN || "300", 10);
const GUESS_DELAY_MAX = parseInt(process.env.GUESS_DELAY_MAX || "1500", 10);
const CONNECT_BATCH = parseInt(process.env.CONNECT_BATCH || "2000", 10);
const CONNECT_BATCH_DELAY = parseInt(process.env.CONNECT_BATCH_DELAY || "1", 10);
const SETUP_BATCH = parseInt(process.env.SETUP_BATCH || "500", 10);
const SETUP_BATCH_DELAY = parseInt(process.env.SETUP_BATCH_DELAY || "1", 10);
const MAX_GUESSES = 30;
const CONNECT_TIMEOUT = 60000;
const EVENT_TIMEOUT = 60000;

const WS_URL = SERVER_URL.replace(/^http/, "ws");

// ── Metrics ─────────────────────────────────────────────────────────────────

const metrics = {
  connectSuccesses: 0,
  connectFailures: 0,
  roomsCreated: 0,
  roomCreateFailures: 0,
  roomJoins: 0,
  roomJoinFailures: 0,
  secretsSet: 0,
  guessesMade: 0,
  gamesFinished: 0,
  gamesFailed: 0,
  errors: [],
  connectTimes: [],
  roomCreateTimes: [],
  roomJoinTimes: [],
  guessTimes: [],
  gameCompleteTimes: [],
  startTime: 0,
  phase1End: 0,
  phase2End: 0,
  phase3End: 0,
  phase4End: 0,
};

function randomDelay(min, max) {
  return new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
}

function generateSecret(len) {
  const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = digits.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  return digits.slice(0, len).join("");
}

function generateGuess(len, previousGuesses) {
  const usedSet = new Set(previousGuesses);
  let attempts = 0;
  while (attempts < 500) {
    const guess = generateSecret(len);
    if (!usedSet.has(guess)) return guess;
    attempts++;
  }
  return generateSecret(len);
}

// ── WebSocket wrapper ───────────────────────────────────────────────────────

function createWsWrapper(ws) {
  const listeners = {};
  let socketId = null;
  ws.setMaxListeners(50);

  ws.on("message", (raw) => {
    let parsed;
    try { parsed = JSON.parse(raw.toString()); } catch { return; }
    const { e: event, d: data } = parsed;
    if (!event) return;

    if (event === "connected") {
      socketId = data.id;
    }

    const fns = listeners[event];
    if (fns) {
      const toCall = [...fns];
      for (const fn of toCall) fn(data);
    }
  });

  return {
    get id() { return socketId; },
    emit(event, data) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ e: event, d: data || {} }));
      }
    },
    on(event, fn) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    once(event, fn) {
      const wrapped = (data) => {
        const arr = listeners[event];
        if (arr) {
          const idx = arr.indexOf(wrapped);
          if (idx !== -1) arr.splice(idx, 1);
        }
        fn(data);
      };
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(wrapped);
    },
    disconnect() {
      try { ws.close(); } catch {}
    },
    get raw() { return ws; },
  };
}

function waitForEvent(sock, event, timeoutMs = EVENT_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for "${event}"`));
    }, timeoutMs);

    sock.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });

    sock.once("error-msg", (msg) => {
      clearTimeout(timer);
      reject(new Error(`Server error on "${event}": ${msg}`));
    });

    sock.raw.once("close", () => {
      clearTimeout(timer);
      reject(new Error(`Disconnect on "${event}"`));
    });
  });
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function avg(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ── PHASE 1: Connect all sockets ────────────────────────────────────────────

async function connectAllSockets() {
  console.log(`\n── PHASE 1: Connecting ${TOTAL_USERS} sockets ──`);
  console.log(`   (batches of ${CONNECT_BATCH}, ${CONNECT_BATCH_DELAY}ms between batches)`);

  const sockets = [];
  const totalBatches = Math.ceil(TOTAL_USERS / CONNECT_BATCH);

  for (let batch = 0; batch < totalBatches; batch++) {
    const batchStart = batch * CONNECT_BATCH;
    const batchEnd = Math.min(batchStart + CONNECT_BATCH, TOTAL_USERS);

    const batchPromises = [];
    for (let i = batchStart; i < batchEnd; i++) {
      batchPromises.push(
        new Promise((resolve) => {
          const start = Date.now();
          const ws = new WebSocket(WS_URL);

          const timer = setTimeout(() => {
            try { ws.close(); } catch {}
            metrics.connectFailures++;
            resolve(null);
          }, CONNECT_TIMEOUT);

          ws.on("open", () => {
            clearTimeout(timer);
            metrics.connectTimes.push(Date.now() - start);
            metrics.connectSuccesses++;
            const wrapper = createWsWrapper(ws);
            resolve(wrapper);
          });

          ws.on("error", () => {
            clearTimeout(timer);
            metrics.connectFailures++;
            try { ws.close(); } catch {}
            resolve(null);
          });
        })
      );
    }

    const results = await Promise.all(batchPromises);
    for (const s of results) {
      if (s) sockets.push(s);
    }

    const pct = (((batch + 1) / totalBatches) * 100).toFixed(0);
    process.stdout.write(
      `   Batch ${batch + 1}/${totalBatches}: ${sockets.length} connected, ` +
      `${metrics.connectFailures} failed (${pct}%)\r`
    );

    if (batch < totalBatches - 1) {
      await new Promise((r) => setTimeout(r, CONNECT_BATCH_DELAY));
    }
  }

  console.log(`\n   Done: ${sockets.length}/${TOTAL_USERS} sockets connected`);
  return sockets;
}

// ── PHASE 2: Create rooms and pair up ───────────────────────────────────────

async function createAllRooms(sockets) {
  const pairCount = Math.floor(sockets.length / 2);
  console.log(`\n── PHASE 2: Creating ${pairCount} rooms ──`);
  console.log(`   (batches of ${SETUP_BATCH}, ${SETUP_BATCH_DELAY}ms between batches)`);

  const pairs = [];

  for (let i = 0; i < pairCount; i++) {
    pairs.push({
      id: i + 1,
      creator: sockets[i * 2],
      joiner: sockets[i * 2 + 1],
      roomCode: null,
      creatorGame: null,
      joinerGame: null,
    });
  }

  const totalBatches = Math.ceil(pairs.length / SETUP_BATCH);
  let created = 0;
  let failed = 0;

  for (let batch = 0; batch < totalBatches; batch++) {
    const batchStart = batch * SETUP_BATCH;
    const batchEnd = Math.min(batchStart + SETUP_BATCH, pairs.length);

    const batchPromises = [];
    for (let i = batchStart; i < batchEnd; i++) {
      const pair = pairs[i];
      batchPromises.push(
        (async () => {
          try {
            const start = Date.now();
            pair.creator.emit("create-room", {
              name: `Bot_${pair.id}_A`,
              digitLength: DIGIT_LENGTH,
              turnTime: TURN_TIME,
            });

            const roomData = await waitForEvent(pair.creator, "room-created");
            pair.roomCode = roomData.code;
            metrics.roomCreateTimes.push(Date.now() - start);
            metrics.roomsCreated++;
            created++;
          } catch (err) {
            metrics.roomCreateFailures++;
            metrics.errors.push({ pair: pair.id, phase: "create-room", error: err.message });
            pair.roomCode = null;
            failed++;
          }
        })()
      );
    }

    await Promise.all(batchPromises);

    const pct = (((batch + 1) / totalBatches) * 100).toFixed(0);
    process.stdout.write(
      `   Batch ${batch + 1}/${totalBatches}: ${created} rooms created, ${failed} failed (${pct}%)\r`
    );

    if (batch < totalBatches - 1) {
      await new Promise((r) => setTimeout(r, SETUP_BATCH_DELAY));
    }
  }

  console.log(`\n   Done: ${created} rooms created, ${failed} failed`);

  const validPairs = pairs.filter((p) => p.roomCode);
  console.log(`\n   Joining ${validPairs.length} rooms...`);

  const joinBatches = Math.ceil(validPairs.length / SETUP_BATCH);
  let joined = 0;
  let joinFailed = 0;

  for (let batch = 0; batch < joinBatches; batch++) {
    const batchStart = batch * SETUP_BATCH;
    const batchEnd = Math.min(batchStart + SETUP_BATCH, validPairs.length);

    const batchPromises = [];
    for (let i = batchStart; i < batchEnd; i++) {
      const pair = validPairs[i];
      batchPromises.push(
        (async () => {
          try {
            const start = Date.now();
            pair.joiner.emit("join-room", {
              code: pair.roomCode,
              name: `Bot_${pair.id}_B`,
            });

            await Promise.all([
              waitForEvent(pair.creator, "game-start-set-secret"),
              waitForEvent(pair.joiner, "game-start-set-secret"),
            ]);
            metrics.roomJoinTimes.push(Date.now() - start);
            metrics.roomJoins++;
            joined++;
          } catch (err) {
            metrics.roomJoinFailures++;
            metrics.errors.push({ pair: pair.id, phase: "join-room", error: err.message });
            pair.roomCode = null;
            joinFailed++;
          }
        })()
      );
    }

    await Promise.all(batchPromises);

    const pct = (((batch + 1) / joinBatches) * 100).toFixed(0);
    process.stdout.write(
      `   Batch ${batch + 1}/${joinBatches}: ${joined} joined, ${joinFailed} failed (${pct}%)\r`
    );

    if (batch < joinBatches - 1) {
      await new Promise((r) => setTimeout(r, SETUP_BATCH_DELAY));
    }
  }

  console.log(`\n   Done: ${joined} rooms joined, ${joinFailed} failed`);
  return pairs.filter((p) => p.roomCode);
}

// ── PHASE 3: Set all secrets ────────────────────────────────────────────────

async function setAllSecrets(pairs) {
  console.log(`\n── PHASE 3: Setting secrets for ${pairs.length} pairs ──`);

  const totalBatches = Math.ceil(pairs.length / SETUP_BATCH);
  let set = 0;
  let failed = 0;

  for (let batch = 0; batch < totalBatches; batch++) {
    const batchStart = batch * SETUP_BATCH;
    const batchEnd = Math.min(batchStart + SETUP_BATCH, pairs.length);

    const batchPromises = [];
    for (let i = batchStart; i < batchEnd; i++) {
      const pair = pairs[i];
      batchPromises.push(
        (async () => {
          try {
            pair.creator.emit("set-secret", { secret: generateSecret(DIGIT_LENGTH) });
            pair.joiner.emit("set-secret", { secret: generateSecret(DIGIT_LENGTH) });

            const [g1, g2] = await Promise.all([
              waitForEvent(pair.creator, "game-playing"),
              waitForEvent(pair.joiner, "game-playing"),
            ]);
            pair.creatorGame = g1;
            pair.joinerGame = g2;
            metrics.secretsSet += 2;
            set++;
          } catch (err) {
            metrics.errors.push({ pair: pair.id, phase: "set-secret", error: err.message });
            pair.creatorGame = null;
            failed++;
          }
        })()
      );
    }

    await Promise.all(batchPromises);

    const pct = (((batch + 1) / totalBatches) * 100).toFixed(0);
    process.stdout.write(
      `   Batch ${batch + 1}/${totalBatches}: ${set} ready, ${failed} failed (${pct}%)\r`
    );

    if (batch < totalBatches - 1) {
      await new Promise((r) => setTimeout(r, SETUP_BATCH_DELAY));
    }
  }

  console.log(`\n   Done: ${set} pairs ready to play, ${failed} failed`);
  return pairs.filter((p) => p.creatorGame);
}

// ── PHASE 4: All games play simultaneously ──────────────────────────────────

async function playAllGames(pairs) {
  const activeUsers = pairs.length * 2;
  console.log(`\n── PHASE 4: ${pairs.length} games starting simultaneously ──`);
  console.log(`   ${activeUsers} users actively playing right now`);
  console.log("");

  const playStart = Date.now();
  let completed = 0;
  let failed = 0;

  const CLEAR_LINE = "\r\x1b[2K";

  const progressInterval = setInterval(() => {
    const elapsed = ((Date.now() - playStart) / 1000).toFixed(0);
    const activeNow = pairs.length - completed - failed;
    process.stdout.write(
      `${CLEAR_LINE}   [${elapsed}s] Active: ${activeNow * 2} users (${activeNow} games) | ` +
      `Completed: ${completed} | Failed: ${failed} | ` +
      `Guesses: ${metrics.guessesMade}`
    );
  }, 1000);

  const gamePromises = pairs.map((pair) =>
    (async () => {
      try {
        const guessesA = [];
        const guessesB = [];
        let gameOver = false;
        let guessCount = 0;
        let isCreatorTurn = pair.creatorGame.isYourTurn;

        pair.creator.on("game-over", () => { gameOver = true; });
        pair.joiner.on("game-over", () => { gameOver = true; });

        const gameStart = Date.now();

        while (!gameOver && guessCount < MAX_GUESSES * 2) {
          const sock = isCreatorTurn ? pair.creator : pair.joiner;
          const list = isCreatorTurn ? guessesA : guessesB;

          await randomDelay(GUESS_DELAY_MIN, GUESS_DELAY_MAX);
          if (gameOver) break;

          const guess = generateGuess(DIGIT_LENGTH, list);
          list.push(guess);

          const guessStart = Date.now();
          sock.emit("make-guess", { guess });

          try {
            await waitForEvent(sock, "guess-result", 30000);
            metrics.guessTimes.push(Date.now() - guessStart);
            metrics.guessesMade++;
            isCreatorTurn = !isCreatorTurn;
          } catch (err) {
            if (gameOver) break;
            throw err;
          }

          guessCount++;
        }

        metrics.gamesFinished++;
        metrics.gameCompleteTimes.push(Date.now() - gameStart);
        completed++;
      } catch (err) {
        metrics.gamesFailed++;
        metrics.errors.push({ pair: pair.id, phase: "gameplay", error: err.message });
        failed++;
      }
    })()
  );

  await Promise.all(gamePromises);
  clearInterval(progressInterval);
  process.stdout.write(CLEAR_LINE);

  const totalElapsed = ((Date.now() - playStart) / 1000).toFixed(1);
  console.log(`   Done: ${completed} games completed, ${failed} failed in ${totalElapsed}s`);
}

// ── Report ──────────────────────────────────────────────────────────────────

function printReport() {
  const totalElapsed = ((Date.now() - metrics.startTime) / 1000).toFixed(1);
  const phase1Dur = ((metrics.phase1End - metrics.startTime) / 1000).toFixed(1);
  const phase2Dur = ((metrics.phase2End - metrics.phase1End) / 1000).toFixed(1);
  const phase3Dur = ((metrics.phase3End - metrics.phase2End) / 1000).toFixed(1);
  const phase4Dur = ((metrics.phase4End - metrics.phase3End) / 1000).toFixed(1);

  console.log("\n" + "═".repeat(70));
  console.log("  CRACKR STRESS TEST — SIMULTANEOUS USERS REPORT");
  console.log("═".repeat(70));
  console.log(`  Server:              ${SERVER_URL}`);
  console.log(`  Target users:        ${TOTAL_USERS}`);
  console.log(`  Total duration:      ${totalElapsed}s`);
  console.log(`  Digit length:        ${DIGIT_LENGTH}`);
  console.log(`  Turn timer:          ${TURN_TIME}s`);
  console.log("");

  console.log("── Phase Durations ─────────────────────────────────────────");
  console.log(`  1. Connect sockets:  ${phase1Dur}s`);
  console.log(`  2. Create/join rooms:${phase2Dur}s`);
  console.log(`  3. Set secrets:      ${phase3Dur}s`);
  console.log(`  4. Play games:       ${phase4Dur}s`);
  console.log("");

  console.log("── Connections ─────────────────────────────────────────────");
  console.log(`  Successful:          ${metrics.connectSuccesses}/${TOTAL_USERS}`);
  console.log(`  Failed:              ${metrics.connectFailures}`);
  if (metrics.connectTimes.length > 0) {
    console.log(`  avg:                 ${avg(metrics.connectTimes).toFixed(0)}ms`);
    console.log(`  p50:                 ${percentile(metrics.connectTimes, 50)}ms`);
    console.log(`  p95:                 ${percentile(metrics.connectTimes, 95)}ms`);
    console.log(`  p99:                 ${percentile(metrics.connectTimes, 99)}ms`);
    console.log(`  max:                 ${Math.max(...metrics.connectTimes)}ms`);
  }
  console.log("");

  console.log("── Rooms ───────────────────────────────────────────────────");
  console.log(`  Created:             ${metrics.roomsCreated} (${metrics.roomCreateFailures} failed)`);
  console.log(`  Joined:              ${metrics.roomJoins} (${metrics.roomJoinFailures} failed)`);
  if (metrics.roomCreateTimes.length > 0) {
    console.log(`  Create latency avg:  ${avg(metrics.roomCreateTimes).toFixed(0)}ms`);
    console.log(`  Create latency p95:  ${percentile(metrics.roomCreateTimes, 95)}ms`);
  }
  if (metrics.roomJoinTimes.length > 0) {
    console.log(`  Join latency avg:    ${avg(metrics.roomJoinTimes).toFixed(0)}ms`);
    console.log(`  Join latency p95:    ${percentile(metrics.roomJoinTimes, 95)}ms`);
  }
  console.log("");

  console.log("── Gameplay ────────────────────────────────────────────────");
  console.log(`  Secrets set:         ${metrics.secretsSet}`);
  console.log(`  Games finished:      ${metrics.gamesFinished}`);
  console.log(`  Games failed:        ${metrics.gamesFailed}`);
  console.log(`  Total guesses:       ${metrics.guessesMade}`);
  if (metrics.guessTimes.length > 0) {
    console.log(`  Guess RTT avg:       ${avg(metrics.guessTimes).toFixed(0)}ms`);
    console.log(`  Guess RTT p50:       ${percentile(metrics.guessTimes, 50)}ms`);
    console.log(`  Guess RTT p95:       ${percentile(metrics.guessTimes, 95)}ms`);
    console.log(`  Guess RTT p99:       ${percentile(metrics.guessTimes, 99)}ms`);
    console.log(`  Guess RTT max:       ${Math.max(...metrics.guessTimes)}ms`);
  }
  if (metrics.gameCompleteTimes.length > 0) {
    console.log(`  Game duration avg:   ${(avg(metrics.gameCompleteTimes) / 1000).toFixed(1)}s`);
    console.log(`  Game duration p95:   ${(percentile(metrics.gameCompleteTimes, 95) / 1000).toFixed(1)}s`);
    console.log(`  Game duration max:   ${(Math.max(...metrics.gameCompleteTimes) / 1000).toFixed(1)}s`);
  }
  console.log("");

  const totalGames = metrics.gamesFinished + metrics.gamesFailed;
  const successRate = totalGames > 0
    ? ((metrics.gamesFinished / totalGames) * 100).toFixed(1)
    : "N/A";
  console.log("── Summary ─────────────────────────────────────────────────");
  console.log(`  Peak simultaneous:   ${metrics.gamesFinished + metrics.gamesFailed} games (${(metrics.gamesFinished + metrics.gamesFailed) * 2} users)`);
  console.log(`  Success rate:        ${successRate}%`);

  if (metrics.errors.length > 0) {
    console.log("");
    console.log("── Error Summary (top 10) ──────────────────────────────────");
    const errorCounts = {};
    for (const e of metrics.errors) {
      const key = `[${e.phase}] ${e.error}`
        .replace(/Bot_\d+_[AB]/g, "Bot_N")
        .replace(/pair: \d+/g, "pair: N");
      errorCounts[key] = (errorCounts[key] || 0) + 1;
    }
    const sorted = Object.entries(errorCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [msg, count] of sorted) {
      console.log(`  (${count}x) ${msg}`);
    }
  }

  console.log("═".repeat(70));
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═".repeat(70));
  console.log("  CRACKR STRESS TEST — SIMULTANEOUS USERS");
  console.log("═".repeat(70));
  console.log(`  Target:           ${SERVER_URL}`);
  console.log(`  Users:            ${TOTAL_USERS} (${TOTAL_PAIRS} pairs)`);
  console.log(`  Digit length:     ${DIGIT_LENGTH}`);
  console.log(`  Turn timer:       ${TURN_TIME}s`);
  console.log(`  Guess delay:      ${GUESS_DELAY_MIN}-${GUESS_DELAY_MAX}ms`);
  console.log(`  Connect batch:    ${CONNECT_BATCH} sockets at a time`);
  console.log(`  Setup batch:      ${SETUP_BATCH} pairs at a time`);
  console.log("═".repeat(70));

  metrics.startTime = Date.now();

  const sockets = await connectAllSockets();
  metrics.phase1End = Date.now();

  if (sockets.length < 2) {
    console.error("\n  FATAL: Less than 2 sockets connected. Cannot proceed.");
    sockets.forEach((s) => s.disconnect());
    printReport();
    process.exit(1);
  }

  const pairedRooms = await createAllRooms(sockets);
  metrics.phase2End = Date.now();

  if (pairedRooms.length === 0) {
    console.error("\n  FATAL: No rooms were created. Cannot proceed.");
    sockets.forEach((s) => s.disconnect());
    printReport();
    process.exit(1);
  }

  const readyPairs = await setAllSecrets(pairedRooms);
  metrics.phase3End = Date.now();

  if (readyPairs.length === 0) {
    console.error("\n  FATAL: No games ready to play. Cannot proceed.");
    sockets.forEach((s) => s.disconnect());
    printReport();
    process.exit(1);
  }

  await playAllGames(readyPairs);
  metrics.phase4End = Date.now();

  console.log("\n  Disconnecting all sockets...");
  sockets.forEach((s) => { try { s.disconnect(); } catch (_) {} });

  printReport();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
