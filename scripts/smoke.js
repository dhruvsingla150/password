// End-to-end smoke test for the optimized server.
// Exercises: connect, create-room, join-room, set-secret, make-guess, game-over.
// Also verifies the two distinct digit-validation error messages.
const WebSocket = require("ws");

const URL = process.env.URL || "ws://localhost:3000";
const DIGITS = 4;

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const handlers = {};
    const pending = {}; // buffered events that have no listener yet
    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const fns = handlers[msg.e];
      if (fns && fns.length > 0) {
        for (const fn of fns.slice()) fn(msg.d);
      } else {
        (pending[msg.e] = pending[msg.e] || []).push(msg.d);
      }
    });
    ws.on("error", reject);
    ws.on("open", () => resolve({
      send: (e, d) => ws.send(JSON.stringify({ e, d: d || {} })),
      on: (e, fn) => { (handlers[e] = handlers[e] || []).push(fn); },
      once: (e, fn) => {
        // Drain buffered events first so we don't miss messages that
        // arrived before this listener was attached.
        const buffered = pending[e];
        if (buffered && buffered.length > 0) {
          const data = buffered.shift();
          if (buffered.length === 0) delete pending[e];
          fn(data);
          return;
        }
        const w = (d) => {
          const a = handlers[e];
          if (a) { const i = a.indexOf(w); if (i !== -1) a.splice(i, 1); }
          fn(d);
        };
        (handlers[e] = handlers[e] || []).push(w);
      },
      close: () => ws.close(),
    }));
  });
}

function waitEvent(c, e, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for "${e}"`)), timeoutMs);
    c.once(e, (d) => { clearTimeout(t); resolve(d); });
  });
}

function assert(cond, msg) {
  if (!cond) { throw new Error("ASSERT: " + msg); }
}

async function happyPath() {
  const a = await connect();
  const b = await connect();
  await waitEvent(a, "connected");
  await waitEvent(b, "connected");

  a.send("create-room", { name: "Alice", digitLength: DIGITS, turnTime: 0 });
  const { code } = await waitEvent(a, "room-created");
  assert(typeof code === "string" && code.length === 6, "room code shape");

  b.send("join-room", { code, name: "Bob" });
  await Promise.all([waitEvent(a, "game-start-set-secret"), waitEvent(b, "game-start-set-secret")]);

  const aSecret = "1234";
  const bSecret = "5678";
  a.send("set-secret", { secret: aSecret });
  b.send("set-secret", { secret: bSecret });
  const [ga, gb] = await Promise.all([waitEvent(a, "game-playing"), waitEvent(b, "game-playing")]);
  assert(ga.isYourTurn !== gb.isYourTurn, "exactly one player starts");

  // Whoever's turn it is guesses the opponent's exact secret to trigger game-over.
  const mover = ga.isYourTurn ? a : b;
  const target = ga.isYourTurn ? bSecret : aSecret;
  mover.send("make-guess", { guess: target });
  const [overA, overB] = await Promise.all([waitEvent(a, "game-over"), waitEvent(b, "game-over")]);
  assert(overA.winnerName && overA.winnerName === overB.winnerName, "both sides see same winner");

  a.close(); b.close();
  console.log("[PASS] happy path (connect → create → join → secret → win)");
}

async function validationErrors() {
  const a = await connect();
  const b = await connect();
  await waitEvent(a, "connected");
  await waitEvent(b, "connected");

  a.send("create-room", { name: "X", digitLength: DIGITS, turnTime: 0 });
  const { code } = await waitEvent(a, "room-created");
  b.send("join-room", { code, name: "Y" });
  await Promise.all([waitEvent(a, "game-start-set-secret"), waitEvent(b, "game-start-set-secret")]);

  // Wrong length → DIGIT_BAD_FORMAT message.
  a.send("set-secret", { secret: "12" });
  const err1 = await waitEvent(a, "error-msg");
  assert(/Secret must be exactly/.test(err1), `wrong-length msg: ${err1}`);

  // Non-digit character → DIGIT_BAD_FORMAT message.
  a.send("set-secret", { secret: "12a4" });
  const err2 = await waitEvent(a, "error-msg");
  assert(/Secret must be exactly/.test(err2), `non-digit msg: ${err2}`);

  // Duplicate digits → DIGIT_DUPLICATE message.
  a.send("set-secret", { secret: "1123" });
  const err3 = await waitEvent(a, "error-msg");
  assert(/No repeated digits/.test(err3), `duplicate msg: ${err3}`);

  // Good secret → accepted.
  a.send("set-secret", { secret: "1234" });
  await waitEvent(a, "secret-accepted");

  a.close(); b.close();
  console.log("[PASS] validation errors (3 cases + accept)");
}

async function evaluateGuessCheck() {
  // Drives a game and checks evaluateGuess gives expected results for a
  // known secret / guess pair.
  const a = await connect();
  const b = await connect();
  await waitEvent(a, "connected");
  await waitEvent(b, "connected");

  a.send("create-room", { name: "A", digitLength: DIGITS, turnTime: 0 });
  const { code } = await waitEvent(a, "room-created");
  b.send("join-room", { code, name: "B" });
  await Promise.all([waitEvent(a, "game-start-set-secret"), waitEvent(b, "game-start-set-secret")]);

  // A's secret = "1234", B's secret = "4321"
  a.send("set-secret", { secret: "1234" });
  b.send("set-secret", { secret: "4321" });
  const [ga] = await Promise.all([waitEvent(a, "game-playing"), waitEvent(b, "game-playing")]);

  // Whoever goes first guesses "1243" against opponent secret.
  // If A goes first: guessing against B's "4321" with "1243" → positions: 0 match (1vs4, 2vs3, 4vs2, 3vs1) → 0; numbers: 1,2,3,4 all in 4,3,2,1 → 4 numbersCorrect.
  // If B goes first: guessing against A's "1234" with "1243" → positions: 1vs1 (ok), 2vs2 (ok), 4vs3 (no), 3vs4 (no) → 2 positions; numbers: 1,2,4,3 all in 1,2,3,4 → 4 numbers.
  const mover = ga.isYourTurn ? a : b;
  const expectingPositions = ga.isYourTurn ? 0 : 2;
  mover.send("make-guess", { guess: "1243" });
  const r = await waitEvent(mover, "guess-result");
  assert(r.lastGuess.numbersCorrect === 4, `numbersCorrect=4, got ${r.lastGuess.numbersCorrect}`);
  assert(r.lastGuess.positionsCorrect === expectingPositions, `positionsCorrect=${expectingPositions}, got ${r.lastGuess.positionsCorrect}`);

  a.close(); b.close();
  console.log("[PASS] evaluateGuess correctness");
}

async function main() {
  await happyPath();
  await validationErrors();
  await evaluateGuessCheck();
  console.log("\nALL SMOKE TESTS PASSED");
  process.exit(0);
}

main().catch((e) => { console.error("\nSMOKE FAILED:", e.message, "\n", e.stack); process.exit(1); });
