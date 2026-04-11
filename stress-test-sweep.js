const { execSync } = require("child_process");
const path = require("path");

// ── Configuration ───────────────────────────────────────────────────────────

const START_USERS = parseInt(process.env.START || "3000", 10);
const END_USERS = parseInt(process.env.END || "10000", 10);
const STEP = parseInt(process.env.STEP || "1000", 10);
const MAX_GUESS_RTT_P95 = parseInt(process.env.MAX_RTT || "2000", 10);
const MIN_SUCCESS_RATE = parseFloat(process.env.MIN_SUCCESS || "90");
const COOLDOWN_SEC = parseInt(process.env.COOLDOWN || "30", 10);

const STRESS_SCRIPT = path.join(__dirname, "stress-test.js");

// ── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractMetric(output, pattern) {
  const match = output.match(pattern);
  return match ? match[1].trim() : null;
}

function runStressTest(users) {
  const env = {
    ...process.env,
    USERS: String(users),
    TURN_TIME: "0",
  };

  try {
    const output = execSync(`node "${STRESS_SCRIPT}"`, {
      env,
      timeout: 600000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { success: true, output };
  } catch (err) {
    const output = (err.stdout || "") + (err.stderr || "");
    return { success: false, output, error: err.message };
  }
}

function parseResults(output, users) {
  const connectOk = extractMetric(output, /Successful:\s+(\d+)/);
  const connectFail = extractMetric(output, /Failed:\s+(\d+)/);
  const gamesFinished = extractMetric(output, /Games finished:\s+(\d+)/);
  const gamesFailed = extractMetric(output, /Games failed:\s+(\d+)/);
  const totalGuesses = extractMetric(output, /Total guesses:\s+(\d+)/);
  const guessAvg = extractMetric(output, /Guess RTT avg:\s+(\d+)ms/);
  const guessP50 = extractMetric(output, /Guess RTT p50:\s+(\d+)ms/);
  const guessP95 = extractMetric(output, /Guess RTT p95:\s+(\d+)ms/);
  const guessP99 = extractMetric(output, /Guess RTT p99:\s+(\d+)ms/);
  const guessMax = extractMetric(output, /Guess RTT max:\s+(\d+)ms/);
  const successRate = extractMetric(output, /Success rate:\s+([\d.]+)%/);
  const playDuration = extractMetric(output, /4\. Play games:\s+([\d.]+)s/);
  const connectAvg = extractMetric(output, /avg:\s+(\d+)ms/);

  return {
    users,
    pairs: Math.floor(users / 2),
    connectOk: parseInt(connectOk) || 0,
    connectFail: parseInt(connectFail) || 0,
    gamesFinished: parseInt(gamesFinished) || 0,
    gamesFailed: parseInt(gamesFailed) || 0,
    totalGuesses: parseInt(totalGuesses) || 0,
    guessAvg: parseInt(guessAvg) || 0,
    guessP50: parseInt(guessP50) || 0,
    guessP95: parseInt(guessP95) || 0,
    guessP99: parseInt(guessP99) || 0,
    guessMax: parseInt(guessMax) || 0,
    successRate: parseFloat(successRate) || 0,
    playDuration: parseFloat(playDuration) || 0,
    connectAvg: parseInt(connectAvg) || 0,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const steps = [];
  for (let u = START_USERS; u <= END_USERS; u += STEP) {
    steps.push(u);
  }

  console.log("═".repeat(70));
  console.log("  CRACKR CAPACITY SWEEP");
  console.log("═".repeat(70));
  console.log(`  Range:        ${START_USERS} → ${END_USERS} users (step ${STEP})`);
  console.log(`  Runs:         ${steps.length} (${steps.join(", ")} users)`);
  console.log(`  Pass criteria:`);
  console.log(`    - Success rate  >= ${MIN_SUCCESS_RATE}%`);
  console.log(`    - Guess RTT p95 <= ${MAX_GUESS_RTT_P95}ms`);
  console.log(`  Cooldown:     ${COOLDOWN_SEC}s between runs`);
  console.log("═".repeat(70));
  console.log("");

  const results = [];
  let lastPass = null;
  let firstFail = null;

  for (let i = 0; i < steps.length; i++) {
    const users = steps[i];
    const runNum = i + 1;

    console.log(`\n${"─".repeat(70)}`);
    console.log(`  RUN ${runNum}/${steps.length}: ${users} users (${Math.floor(users / 2)} pairs)`);
    console.log(`${"─".repeat(70)}\n`);

    const { success, output, error } = runStressTest(users);

    if (!success && !output) {
      console.log(`  CRASHED: ${error}`);
      results.push({
        users,
        pairs: Math.floor(users / 2),
        connectOk: 0,
        connectFail: users,
        gamesFinished: 0,
        gamesFailed: 0,
        guessAvg: 0,
        guessP50: 0,
        guessP95: 0,
        guessP99: 0,
        guessMax: 0,
        successRate: 0,
        playDuration: 0,
        connectAvg: 0,
        totalGuesses: 0,
        verdict: "CRASH",
      });
      firstFail = firstFail || users;
      console.log(`\n  Stopping sweep — process crashed at ${users} users.`);
      break;
    }

    const r = parseResults(output, users);

    const rttOk = r.guessP95 <= MAX_GUESS_RTT_P95 || r.guessP95 === 0;
    const srOk = r.successRate >= MIN_SUCCESS_RATE;
    const passed = rttOk && srOk && r.gamesFinished > 0;

    r.verdict = passed ? "PASS" : "FAIL";
    results.push(r);

    if (passed) {
      lastPass = users;
    } else {
      firstFail = firstFail || users;
    }

    console.log(`\n  ┌─ Result: ${r.verdict}`);
    console.log(`  │  Connected:    ${r.connectOk}/${users}`);
    console.log(`  │  Games:        ${r.gamesFinished} ok, ${r.gamesFailed} failed`);
    console.log(`  │  Success rate: ${r.successRate}%`);
    console.log(`  │  Guess RTT:    avg ${r.guessAvg}ms, p50 ${r.guessP50}ms, p95 ${r.guessP95}ms, max ${r.guessMax}ms`);
    console.log(`  │  Play time:    ${r.playDuration}s`);
    console.log(`  └─`);

    if (!passed) {
      const failReasons = [];
      if (!srOk) failReasons.push(`success rate ${r.successRate}% < ${MIN_SUCCESS_RATE}%`);
      if (!rttOk) failReasons.push(`p95 RTT ${r.guessP95}ms > ${MAX_GUESS_RTT_P95}ms`);
      if (r.gamesFinished === 0) failReasons.push("zero games finished");
      console.log(`  Fail reason: ${failReasons.join(", ")}`);
    }

    if (i < steps.length - 1) {
      console.log(`\n  Cooling down ${COOLDOWN_SEC}s before next run...`);
      await sleep(COOLDOWN_SEC * 1000);
    }
  }

  // ── Final report ──────────────────────────────────────────────────────────

  console.log("\n\n" + "═".repeat(70));
  console.log("  CAPACITY SWEEP RESULTS");
  console.log("═".repeat(70));

  const header = "  Users  | Verdict |  Connected  |  Games OK  | Fail |  RTT avg  |  RTT p95  |  Rate";
  console.log(header);
  console.log("  " + "─".repeat(header.length - 2));

  for (const r of results) {
    const line =
      `  ${String(r.users).padStart(5)}  ` +
      `| ${r.verdict.padEnd(7)} ` +
      `| ${String(r.connectOk).padStart(5)}/${String(r.users).padStart(5)} ` +
      `| ${String(r.gamesFinished).padStart(9)}  ` +
      `| ${String(r.gamesFailed).padStart(4)} ` +
      `| ${String(r.guessAvg).padStart(5)}ms  ` +
      `| ${String(r.guessP95).padStart(5)}ms  ` +
      `| ${String(r.successRate).padStart(5)}%`;
    console.log(line);
  }

  console.log("");
  console.log("═".repeat(70));

  if (lastPass) {
    console.log(`  MAX CONCURRENT USERS (passing criteria): ${lastPass}`);
  } else {
    console.log(`  NO PASSING RUNS — server could not handle ${START_USERS} users.`);
  }

  if (firstFail) {
    console.log(`  FIRST FAILURE AT: ${firstFail} users`);
  }

  if (lastPass && firstFail) {
    console.log(`  CAPACITY RANGE: ${lastPass} – ${firstFail} users`);
  }

  console.log("═".repeat(70));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
