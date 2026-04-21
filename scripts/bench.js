// Micro-benchmarks isolating the hot-path functions that were changed.
// Ops/sec numbers are indicative of the per-guess CPU savings under load.

// ── OLD implementations (copied verbatim from pre-change index.js) ─────────

function oldEvaluateGuess(secret, guess) {
  const len = secret.length;
  let positionsCorrect = 0;
  let numbersCorrect = 0;
  const secretDigits = secret.split("");
  for (let i = 0; i < len; i++) {
    if (guess[i] === secret[i]) positionsCorrect++;
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

const OLD_DIGIT_RE = /^\d+$/;
function oldValidate(s, len) {
  if (s.length !== len || !OLD_DIGIT_RE.test(s)) return 1;
  if (new Set(s).size !== s.length) return 2;
  return 0;
}

// ── NEW implementations (mirror of index.js) ──────────────────────────────

const EVAL_COUNTS = new Uint8Array(10);
function newEvaluateGuess(secret, guess) {
  const len = secret.length;
  let positionsCorrect = 0;
  let numbersCorrect = 0;
  const counts = EVAL_COUNTS;
  for (let i = 0; i < 10; i++) counts[i] = 0;
  for (let i = 0; i < len; i++) {
    const sc = secret.charCodeAt(i);
    const gc = guess.charCodeAt(i);
    counts[sc - 48]++;
    if (sc === gc) positionsCorrect++;
  }
  for (let i = 0; i < len; i++) {
    const gd = guess.charCodeAt(i) - 48;
    if (counts[gd] > 0) { numbersCorrect++; counts[gd]--; }
  }
  return { numbersCorrect, positionsCorrect };
}

function newValidate(s, expectedLen) {
  if (typeof s !== "string" || s.length !== expectedLen) return 1;
  let bitmask = 0;
  for (let i = 0; i < expectedLen; i++) {
    const c = s.charCodeAt(i) - 48;
    if (c < 0 || c > 9) return 1;
    const bit = 1 << c;
    if ((bitmask & bit) !== 0) return 2;
    bitmask |= bit;
  }
  return 0;
}

// ── Correctness check: old vs new must agree on all inputs ────────────────

function allPermutations(digits) {
  if (digits.length <= 1) return [digits];
  const out = [];
  for (let i = 0; i < digits.length; i++) {
    const head = digits[i];
    const rest = digits.slice(0, i).concat(digits.slice(i + 1));
    for (const p of allPermutations(rest)) out.push(head + p);
  }
  return out;
}
const all4 = allPermutations(["0","1","2","3"]).concat(
  allPermutations(["4","5","6","7"])
);
let mismatches = 0;
for (const s of all4) {
  for (const g of all4) {
    const a = oldEvaluateGuess(s, g);
    const b = newEvaluateGuess(s, g);
    if (a.numbersCorrect !== b.numbersCorrect || a.positionsCorrect !== b.positionsCorrect) {
      mismatches++;
      if (mismatches < 5) console.error(`MISMATCH s=${s} g=${g} old=${JSON.stringify(a)} new=${JSON.stringify(b)}`);
    }
  }
}
console.log(`Correctness: ${mismatches === 0 ? "OK" : mismatches + " mismatches"} (evaluateGuess across ${all4.length * all4.length} pairs)`);

// Validate correctness too.
const validateCases = [
  ["1234", 4, 0],
  ["12345", 4, 1],
  ["12a4", 4, 1],
  ["1124", 4, 2],
  ["", 4, 1],
  ["0123", 4, 0],
  ["9876", 4, 0],
  ["9878", 4, 2],
];
let vMismatch = 0;
for (const [s, len, expected] of validateCases) {
  const a = oldValidate(s, len);
  const b = newValidate(s, len);
  if (a !== b || a !== expected) {
    vMismatch++;
    console.error(`VALIDATE MISMATCH s="${s}" len=${len} expected=${expected} old=${a} new=${b}`);
  }
}
console.log(`Correctness: ${vMismatch === 0 ? "OK" : vMismatch + " mismatches"} (validate)`);

// ── Benchmark ─────────────────────────────────────────────────────────────

function bench(label, fn, iterations) {
  fn(); fn(); fn(); // warm up
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const end = process.hrtime.bigint();
  const ns = Number(end - start);
  const ops = (iterations / ns) * 1e9;
  console.log(`${label.padEnd(40)} ${(ns / iterations).toFixed(0).padStart(6)} ns/op  ${(ops / 1e6).toFixed(2)} Mops/sec`);
}

const ITERS = 2_000_000;

console.log("\n── evaluateGuess (4-digit) ──");
bench("old evaluateGuess", () => oldEvaluateGuess("1234", "1324"), ITERS);
bench("new evaluateGuess", () => newEvaluateGuess("1234", "1324"), ITERS);

console.log("\n── evaluateGuess (8-digit) ──");
bench("old evaluateGuess len=8", () => oldEvaluateGuess("01234567", "76543210"), ITERS);
bench("new evaluateGuess len=8", () => newEvaluateGuess("01234567", "76543210"), ITERS);

console.log("\n── validate (4-digit, valid) ──");
bench("old validate (valid)", () => oldValidate("1234", 4), ITERS);
bench("new validate (valid)", () => newValidate("1234", 4), ITERS);

console.log("\n── validate (4-digit, duplicate) ──");
bench("old validate (duplicate)", () => oldValidate("1124", 4), ITERS);
bench("new validate (duplicate)", () => newValidate("1124", 4), ITERS);

console.log("\n── validate (4-digit, non-digit) ──");
bench("old validate (non-digit)", () => oldValidate("12a4", 4), ITERS);
bench("new validate (non-digit)", () => newValidate("12a4", 4), ITERS);
