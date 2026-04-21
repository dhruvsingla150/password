// Verifies the master turn-timer tick: with turnTime=2, if the first player
// does nothing, a turn-skipped event must arrive within ~2-3 seconds and
// the turn must pass to the opponent.
const WebSocket = require("ws");

const URL = process.env.URL || "ws://localhost:3000";
const DIGITS = 4;
const TURN_TIME = 2;

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const handlers = {};
    const pending = {};
    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const fns = handlers[msg.e];
      if (fns && fns.length > 0) for (const fn of fns.slice()) fn(msg.d);
      else (pending[msg.e] = pending[msg.e] || []).push(msg.d);
    });
    ws.on("error", reject);
    ws.on("open", () => resolve({
      send: (e, d) => ws.send(JSON.stringify({ e, d: d || {} })),
      on: (e, fn) => { (handlers[e] = handlers[e] || []).push(fn); },
      once: (e, fn) => {
        const b = pending[e];
        if (b && b.length > 0) {
          const d = b.shift();
          if (!b.length) delete pending[e];
          fn(d);
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

function waitEvent(c, e, ms = 6000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for "${e}"`)), ms);
    c.once(e, (d) => { clearTimeout(t); resolve(d); });
  });
}

async function main() {
  const a = await connect();
  const b = await connect();
  await waitEvent(a, "connected");
  await waitEvent(b, "connected");

  a.send("create-room", { name: "Alice", digitLength: DIGITS, turnTime: TURN_TIME });
  const { code } = await waitEvent(a, "room-created");
  b.send("join-room", { code, name: "Bob" });
  await Promise.all([waitEvent(a, "game-start-set-secret"), waitEvent(b, "game-start-set-secret")]);

  a.send("set-secret", { secret: "1234" });
  b.send("set-secret", { secret: "5678" });
  const [ga, gb] = await Promise.all([waitEvent(a, "game-playing"), waitEvent(b, "game-playing")]);
  console.log(`Game started. turnTime=${TURN_TIME}s. A.isYourTurn=${ga.isYourTurn}, B.isYourTurn=${gb.isYourTurn}`);

  // Collect timer ticks on both sides for a few seconds to verify the master
  // tick actually drives broadcasts.
  const aTicks = [];
  const bTicks = [];
  a.on("timer-tick", (d) => aTicks.push(d.timeLeft));
  b.on("timer-tick", (d) => bTicks.push(d.timeLeft));

  const t0 = Date.now();
  // Wait for turn-skipped on BOTH sides (broadcast).
  const skippedA = waitEvent(a, "turn-skipped", (TURN_TIME + 3) * 1000);
  const skippedB = waitEvent(b, "turn-skipped", (TURN_TIME + 3) * 1000);
  const [sa, sb] = await Promise.all([skippedA, skippedB]);
  const elapsed = Date.now() - t0;
  console.log(`turn-skipped arrived after ${elapsed}ms (expected ~${TURN_TIME * 1000}ms)`);
  console.log("A timer ticks:", aTicks);
  console.log("B timer ticks:", bTicks);

  if (elapsed < TURN_TIME * 1000 - 500) throw new Error(`skipped too soon (${elapsed}ms)`);
  if (elapsed > TURN_TIME * 1000 + 2500) throw new Error(`skipped too late (${elapsed}ms)`);

  // Turn must now belong to the OTHER player.
  const firstMover = ga.isYourTurn ? "A" : "B";
  const newTurnA = sa.isYourTurn;
  const newTurnB = sb.isYourTurn;
  if (newTurnA === newTurnB) throw new Error("turn flag should differ between players");
  const newMover = newTurnA ? "A" : "B";
  if (newMover === firstMover) throw new Error("turn did not actually pass to opponent");

  console.log(`[PASS] turn expired → skipped: was ${firstMover}, now ${newMover}`);

  a.close(); b.close();
  console.log("\nTIMER SMOKE PASSED");
  process.exit(0);
}

main().catch((e) => { console.error("\nTIMER SMOKE FAILED:", e.message); process.exit(1); });
