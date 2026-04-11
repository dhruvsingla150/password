const WebSocket = require("ws");

// ── Configuration ───────────────────────────────────────────────────────────

const SERVER_URL = process.env.SERVER_URL || "https://password-xh9g.onrender.com";
const DIGIT_LENGTH = parseInt(process.env.DIGITS || "4", 10);
const TURN_TIME = parseInt(process.env.TURN_TIME || "0", 10);
const GUESS_DELAY_MIN = parseInt(process.env.GUESS_DELAY_MIN || "300", 10);
const GUESS_DELAY_MAX = parseInt(process.env.GUESS_DELAY_MAX || "1500", 10);
const MAX_GUESSES = 20;
const CONNECT_TIMEOUT = 30000;
const GAME_TIMEOUT = 120000;

const WS_URL = SERVER_URL.replace(/^http/, "ws");

const STAGES = [
  { durationSec: 60,  targetPairs: 10  },
  { durationSec: 60,  targetPairs: 25  },
  { durationSec: 60,  targetPairs: 50  },
  { durationSec: 60,  targetPairs: 75  },
  { durationSec: 60,  targetPairs: 100 },
  { durationSec: 30,  targetPairs: 0   },
];

// ── Metrics ─────────────────────────────────────────────────────────────────

const metrics = {
  pairsAttempted: 0,
  pairsCompleted: 0,
  pairsFailed: 0,
  connectSuccesses: 0,
  connectFailures: 0,
  guessesMade: 0,
  gamesFinished: 0,
  peakConcurrentPairs: 0,
  errors: [],
  connectTimes: [],
  guessTimes: [],
  gameCompleteTimes: [],
  stageResults: [],
  startTime: Date.now(),
};

let activePairs = 0;
let shouldStop = false;

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
  while (attempts < 1000) {
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

function connectSocket(label) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const ws = new WebSocket(WS_URL);

    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error(`${label}: connect timeout`));
    }, CONNECT_TIMEOUT);

    ws.on("open", () => {
      clearTimeout(timer);
      metrics.connectTimes.push(Date.now() - start);
      metrics.connectSuccesses++;
      resolve(createWsWrapper(ws));
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      metrics.connectFailures++;
      reject(new Error(`${label}: connect error — ${err.message}`));
    });
  });
}

function waitForEvent(sock, event, timeoutMs = GAME_TIMEOUT) {
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

// ── Simulate one game pair that loops until told to stop ────────────────────

async function simulateRepeatingPair(pairId) {
  let gamesPlayed = 0;

  while (!shouldStop) {
    const runId = `P${pairId}-G${++gamesPlayed}`;
    let sock1, sock2;

    try {
      activePairs++;
      if (activePairs > metrics.peakConcurrentPairs) {
        metrics.peakConcurrentPairs = activePairs;
      }
      metrics.pairsAttempted++;

      [sock1, sock2] = await Promise.all([
        connectSocket(`${runId}/A`),
        connectSocket(`${runId}/B`),
      ]);

      sock1.emit("create-room", {
        name: `Bot_${pairId}A`,
        digitLength: DIGIT_LENGTH,
        turnTime: TURN_TIME,
      });

      const roomData = await waitForEvent(sock1, "room-created");

      await randomDelay(100, 300);

      sock2.emit("join-room", { code: roomData.code, name: `Bot_${pairId}B` });

      await Promise.all([
        waitForEvent(sock1, "game-start-set-secret"),
        waitForEvent(sock2, "game-start-set-secret"),
      ]);

      await randomDelay(200, 600);

      sock1.emit("set-secret", { secret: generateSecret(DIGIT_LENGTH) });
      sock2.emit("set-secret", { secret: generateSecret(DIGIT_LENGTH) });

      const [game1] = await Promise.all([
        waitForEvent(sock1, "game-playing"),
        waitForEvent(sock2, "game-playing"),
      ]);

      const gameStart = Date.now();
      const p1Guesses = [];
      const p2Guesses = [];
      let gameOver = false;
      let guessCount = 0;
      let isP1Turn = game1.isYourTurn;

      sock1.on("game-over", () => { gameOver = true; });
      sock2.on("game-over", () => { gameOver = true; });

      while (!gameOver && guessCount < MAX_GUESSES * 2 && !shouldStop) {
        const sock = isP1Turn ? sock1 : sock2;
        const list = isP1Turn ? p1Guesses : p2Guesses;

        await randomDelay(GUESS_DELAY_MIN, GUESS_DELAY_MAX);
        if (gameOver || shouldStop) break;

        const guess = generateGuess(DIGIT_LENGTH, list);
        list.push(guess);

        const guessStart = Date.now();
        sock.emit("make-guess", { guess });

        try {
          await waitForEvent(sock, "guess-result", 15000);
          metrics.guessTimes.push(Date.now() - guessStart);
          metrics.guessesMade++;
          isP1Turn = !isP1Turn;
        } catch (err) {
          if (gameOver) break;
          throw err;
        }

        guessCount++;
      }

      metrics.gamesFinished++;
      metrics.gameCompleteTimes.push(Date.now() - gameStart);

      metrics.pairsCompleted++;
    } catch (err) {
      metrics.pairsFailed++;
      metrics.errors.push({ pair: pairId, error: err.message });
    } finally {
      activePairs--;
      if (sock1) sock1.disconnect();
      if (sock2) sock2.disconnect();
    }

    if (!shouldStop) await randomDelay(500, 1500);
  }
}

// ── Ramp controller ─────────────────────────────────────────────────────────

async function runRamp() {
  const pairWorkers = new Map();
  let nextPairId = 1;

  for (let stageIdx = 0; stageIdx < STAGES.length; stageIdx++) {
    const stage = STAGES[stageIdx];
    const stageStart = Date.now();
    const targetPairs = stage.targetPairs;
    const currentPairs = pairWorkers.size;

    console.log(`\n── Stage ${stageIdx + 1}/${STAGES.length}: ` +
      `target ${targetPairs} pairs (${targetPairs * 2} users) ` +
      `for ${stage.durationSec}s ──`);

    if (targetPairs > currentPairs) {
      const toAdd = targetPairs - currentPairs;
      const rampInterval = (stage.durationSec * 1000 * 0.3) / Math.max(toAdd, 1);

      for (let i = 0; i < toAdd; i++) {
        const id = nextPairId++;
        pairWorkers.set(id, simulateRepeatingPair(id));
        if (i < toAdd - 1) {
          await new Promise((r) => setTimeout(r, Math.min(rampInterval, 2000)));
        }
      }
    }

    const stageSnapshot = {
      stage: stageIdx + 1,
      targetPairs,
      targetUsers: targetPairs * 2,
      pairsCompletedBefore: metrics.pairsCompleted,
      pairsFailedBefore: metrics.pairsFailed,
      guessesBefore: metrics.guessesMade,
    };

    const remainingMs = stage.durationSec * 1000 - (Date.now() - stageStart);
    if (remainingMs > 0) {
      await new Promise((r) => setTimeout(r, remainingMs));
    }

    stageSnapshot.pairsCompletedAfter = metrics.pairsCompleted;
    stageSnapshot.pairsFailedAfter = metrics.pairsFailed;
    stageSnapshot.guessesAfter = metrics.guessesMade;
    stageSnapshot.gamesInStage = stageSnapshot.pairsCompletedAfter - stageSnapshot.pairsCompletedBefore;
    stageSnapshot.failuresInStage = stageSnapshot.pairsFailedAfter - stageSnapshot.pairsFailedBefore;
    stageSnapshot.guessesInStage = stageSnapshot.guessesAfter - stageSnapshot.guessesBefore;
    metrics.stageResults.push(stageSnapshot);

    console.log(`    => completed ${stageSnapshot.gamesInStage} games, ` +
      `${stageSnapshot.failuresInStage} failures, ` +
      `${stageSnapshot.guessesInStage} guesses`);
  }

  console.log("\nRamping down... waiting for active games to finish.");
  shouldStop = true;
  await Promise.all(pairWorkers.values());
}

// ── Report ──────────────────────────────────────────────────────────────────

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

function printReport() {
  const elapsed = ((Date.now() - metrics.startTime) / 1000).toFixed(1);

  console.log("\n" + "═".repeat(64));
  console.log("  CRACKR RAMP STRESS TEST REPORT");
  console.log("═".repeat(64));
  console.log(`  Server:              ${SERVER_URL}`);
  console.log(`  Duration:            ${elapsed}s`);
  console.log(`  Peak concurrent:     ${metrics.peakConcurrentPairs} pairs (${metrics.peakConcurrentPairs * 2} users)`);
  console.log("");

  console.log("── Per-Stage Breakdown ───────────────────────────────────");
  console.log("  Stage  |  Target  |  Games OK  |  Failed  |  Guesses");
  console.log("  " + "-".repeat(58));
  for (const s of metrics.stageResults) {
    console.log(`  ${String(s.stage).padStart(5)}  |  ${String(s.targetUsers).padStart(3)} usr |  ${String(s.gamesInStage).padStart(8)}  |  ${String(s.failuresInStage).padStart(6)}  |  ${String(s.guessesInStage).padStart(6)}`);
  }

  console.log("");
  console.log("── Connections ──────────────────────────────────────────");
  console.log(`  Successful:          ${metrics.connectSuccesses}`);
  console.log(`  Failed:              ${metrics.connectFailures}`);
  if (metrics.connectTimes.length > 0) {
    console.log(`  avg:                 ${avg(metrics.connectTimes).toFixed(0)}ms`);
    console.log(`  p50:                 ${percentile(metrics.connectTimes, 50)}ms`);
    console.log(`  p95:                 ${percentile(metrics.connectTimes, 95)}ms`);
    console.log(`  max:                 ${Math.max(...metrics.connectTimes)}ms`);
  }

  if (metrics.guessTimes.length > 0) {
    console.log("");
    console.log("── Guess Round-Trip Latency ─────────────────────────────");
    console.log(`  avg:                 ${avg(metrics.guessTimes).toFixed(0)}ms`);
    console.log(`  p50:                 ${percentile(metrics.guessTimes, 50)}ms`);
    console.log(`  p95:                 ${percentile(metrics.guessTimes, 95)}ms`);
    console.log(`  p99:                 ${percentile(metrics.guessTimes, 99)}ms`);
    console.log(`  max:                 ${Math.max(...metrics.guessTimes)}ms`);
  }

  console.log("");
  console.log("── Totals ──────────────────────────────────────────────");
  console.log(`  Pairs attempted:     ${metrics.pairsAttempted}`);
  console.log(`  Pairs completed:     ${metrics.pairsCompleted}`);
  console.log(`  Pairs failed:        ${metrics.pairsFailed}`);
  console.log(`  Games finished:      ${metrics.gamesFinished}`);
  console.log(`  Guesses made:        ${metrics.guessesMade}`);
  const successRate = metrics.pairsAttempted > 0
    ? ((metrics.pairsCompleted / metrics.pairsAttempted) * 100).toFixed(1)
    : "N/A";
  console.log(`  Success rate:        ${successRate}%`);

  if (metrics.errors.length > 0) {
    console.log("");
    console.log("── Error Summary ───────────────────────────────────────");
    const errorCounts = {};
    for (const e of metrics.errors) {
      const key = e.error
        .replace(/P\d+-G\d+/g, "PN-GN")
        .replace(/Bot_\d+[AB]/g, "Bot_N");
      errorCounts[key] = (errorCounts[key] || 0) + 1;
    }
    for (const [msg, count] of Object.entries(errorCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`  (${count}x) ${msg}`);
    }
  }

  console.log("═".repeat(64));
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═".repeat(64));
  console.log("  CRACKR RAMP STRESS TEST");
  console.log("═".repeat(64));
  console.log(`  Target: ${SERVER_URL}`);
  console.log(`  Stages:`);
  for (let i = 0; i < STAGES.length; i++) {
    const s = STAGES[i];
    console.log(`    ${i + 1}. ${s.durationSec}s → ${s.targetPairs} pairs (${s.targetPairs * 2} users)`);
  }
  console.log("═".repeat(64));

  await runRamp();
  printReport();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
