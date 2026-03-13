const socket = io();

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const screens = {
  lobby: $("#screen-lobby"),
  waiting: $("#screen-waiting"),
  secret: $("#screen-secret"),
  game: $("#screen-game"),
  gameover: $("#screen-gameover"),
};

let currentDigitLength = 4;
let currentTurnTime = 0;
let currentRoomCode = null;
let playerName = null;

// ══════════════════════════════════════════════════════════════════════════════
//  SCRATCHPAD / NOTES
// ══════════════════════════════════════════════════════════════════════════════

function getNotesKey() {
  return currentRoomCode ? `crackr_notes_${currentRoomCode}` : null;
}

function saveNotes() {
  const key = getNotesKey();
  if (!key) return;
  const text = $("#notes-textarea").value;
  try { localStorage.setItem(key, text); } catch (_) {}
}

function loadNotes() {
  const key = getNotesKey();
  if (!key) return;
  try {
    $("#notes-textarea").value = localStorage.getItem(key) || "";
  } catch (_) {
    $("#notes-textarea").value = "";
  }
}

function clearNotesStorage() {
  const key = getNotesKey();
  if (!key) return;
  try { localStorage.removeItem(key); } catch (_) {}
}

(function initNotes() {
  const toggle = $("#notes-toggle");
  const body = $("#notes-body");
  const textarea = $("#notes-textarea");

  toggle.addEventListener("click", () => {
    const isOpen = body.classList.toggle("open");
    toggle.classList.toggle("active", isOpen);
    if (isOpen) textarea.focus();
    sfxClick();
  });

  textarea.addEventListener("input", saveNotes);
})();

// ══════════════════════════════════════════════════════════════════════════════
//  CURSOR SPOTLIGHT
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener("mousemove", (e) => {
  document.documentElement.style.setProperty("--mx", e.clientX + "px");
  document.documentElement.style.setProperty("--my", e.clientY + "px");
});

// ══════════════════════════════════════════════════════════════════════════════
//  CONFETTI
// ══════════════════════════════════════════════════════════════════════════════

const confettiCanvas = $("#confetti-canvas");
const cCtx = confettiCanvas.getContext("2d");
let confettiPieces = [];
let confettiAnimId = null;

function resizeConfetti() {
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeConfetti);
resizeConfetti();

function launchConfetti() {
  resizeConfetti();
  const colors = ["#d4a017", "#27ae60", "#d4d4d4", "#c0392b"];
  for (let i = 0; i < 100; i++) {
    confettiPieces.push({
      x: Math.random() * confettiCanvas.width,
      y: -10 - Math.random() * 150,
      w: Math.random() * 8 + 3,
      h: Math.random() * 4 + 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 3,
      vy: Math.random() * 2.5 + 1.5,
      rot: Math.random() * 360,
      rotV: (Math.random() - 0.5) * 8,
      life: 180 + Math.random() * 80,
    });
  }
  if (!confettiAnimId) animateConfetti();
}

function animateConfetti() {
  cCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  for (let i = confettiPieces.length - 1; i >= 0; i--) {
    const c = confettiPieces[i];
    c.x += c.vx;
    c.y += c.vy;
    c.vy += 0.025;
    c.vx *= 0.995;
    c.rot += c.rotV;
    c.life--;
    if (c.life <= 0 || c.y > confettiCanvas.height + 20) {
      confettiPieces.splice(i, 1);
      continue;
    }
    cCtx.save();
    cCtx.translate(c.x, c.y);
    cCtx.rotate((c.rot * Math.PI) / 180);
    cCtx.globalAlpha = Math.min(1, c.life / 25);
    cCtx.fillStyle = c.color;
    cCtx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
    cCtx.restore();
  }
  if (confettiPieces.length > 0) {
    confettiAnimId = requestAnimationFrame(animateConfetti);
  } else {
    confettiAnimId = null;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  SOUND SYSTEM
// ══════════════════════════════════════════════════════════════════════════════

let soundEnabled = false;
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(freq, dur, type, vol) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(vol || 0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (dur || 0.15));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (dur || 0.15));
  } catch (_) {}
}

function sfxClick() { playTone(600, 0.04, "square", 0.03); }
function sfxSuccess() {
  playTone(440, 0.12, "sine", 0.06);
  setTimeout(() => playTone(554, 0.12, "sine", 0.06), 80);
  setTimeout(() => playTone(659, 0.16, "sine", 0.06), 160);
}
function sfxError() {
  playTone(180, 0.12, "square", 0.05);
  setTimeout(() => playTone(140, 0.18, "square", 0.05), 100);
}
function sfxWin() {
  [440, 554, 659, 880].forEach((f, i) => setTimeout(() => playTone(f, 0.2, "sine", 0.08), i * 100));
}
function sfxLose() {
  [350, 310, 270, 220].forEach((f, i) => setTimeout(() => playTone(f, 0.18, "triangle", 0.06), i * 130));
}
function sfxGuess() { playTone(350, 0.06, "sine", 0.04); }
function sfxTurn() {
  playTone(550, 0.08, "sine", 0.05);
  setTimeout(() => playTone(740, 0.1, "sine", 0.05), 60);
}

$("#sound-toggle").addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  const btn = $("#sound-toggle");
  btn.classList.toggle("active", soundEnabled);
  $("#sound-icon-off").style.display = soundEnabled ? "none" : "block";
  $("#sound-icon-on").style.display = soundEnabled ? "block" : "none";
  if (soundEnabled) { getAudioCtx(); sfxClick(); }
});

// ══════════════════════════════════════════════════════════════════════════════
//  DIGIT INPUT BOXES
// ══════════════════════════════════════════════════════════════════════════════

let secretDigitValues = [];

function createDigitBoxes(container, count) {
  container.innerHTML = "";
  secretDigitValues = new Array(count).fill("");
  for (let i = 0; i < count; i++) {
    const box = document.createElement("div");
    box.className = "digit-box";
    box.dataset.index = i;
    box.addEventListener("click", () => focusDigitBox(i));
    container.appendChild(box);
  }
}

function focusDigitBox(index) {
  $$("#secret-digit-boxes .digit-box").forEach(b => b.classList.remove("active"));
  const boxes = $$("#secret-digit-boxes .digit-box");
  if (index < boxes.length) boxes[index].classList.add("active");
}

function updateDigitBoxes() {
  $$("#secret-digit-boxes .digit-box").forEach((box, i) => {
    const val = secretDigitValues[i] || "";
    const wasFilled = box.classList.contains("filled");
    box.textContent = val;
    box.classList.toggle("filled", val !== "");
    if (val !== "" && !wasFilled) {
      box.style.animation = "none";
      box.offsetHeight;
      box.style.animation = "";
    }
  });
  $("#input-secret").value = secretDigitValues.join("");
}

function getActiveDigitIndex() {
  const idx = secretDigitValues.indexOf("");
  return idx === -1 ? secretDigitValues.length - 1 : idx;
}

document.addEventListener("keydown", (e) => {
  if (!screens.secret.classList.contains("active")) return;
  if ($("#input-secret").disabled) return;

  if (/^\d$/.test(e.key)) {
    const idx = getActiveDigitIndex();
    if (idx < currentDigitLength) {
      secretDigitValues[idx] = e.key;
      updateDigitBoxes();
      sfxClick();
      focusDigitBox(Math.min(idx + 1, currentDigitLength - 1));
    }
    e.preventDefault();
  } else if (e.key === "Backspace") {
    let idx = getActiveDigitIndex();
    if (idx === currentDigitLength || (idx > 0 && secretDigitValues[idx] === "")) {
      idx = Math.max(0, idx - 1);
    }
    secretDigitValues[idx] = "";
    updateDigitBoxes();
    focusDigitBox(idx);
    e.preventDefault();
  } else if (e.key === "Enter") {
    $("#btn-secret").click();
    e.preventDefault();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove("active"));
  screens[name].classList.add("active");
}

function showToast(msg, type) {
  const toast = $("#toast");
  toast.textContent = msg;
  toast.className = "toast";
  if (type === "success") toast.classList.add("toast-success");
  toast.classList.add("visible");
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.classList.add("hidden"), 300);
  }, 3000);
}

function renderGuesses(container, guesses, animate) {
  const prevCount = container.children.length;
  container.innerHTML = "";
  guesses.forEach((g, i) => {
    const row = document.createElement("div");
    row.className = "guess-row";

    if (animate && i >= prevCount) {
      row.classList.add("new-guess");
      row.style.animationDelay = `${(i - prevCount) * 0.06}s`;
    }

    const allPositions = g.positionsCorrect === currentDigitLength;
    row.innerHTML =
      `<span class="guess-idx">${String(i + 1).padStart(2, "0")}</span>` +
      `<span class="guess-number">${g.guess}</span>` +
      `<span class="guess-result">` +
        `<span class="result-badge numbers">${g.numbersCorrect}N</span>` +
        `<span class="result-badge positions${allPositions ? " perfect" : ""}">${g.positionsCorrect}P</span>` +
      `</span>`;
    container.appendChild(row);
  });
  container.scrollTop = container.scrollHeight;
}

function animateRoomCode(code) {
  const display = $("#display-code");
  display.innerHTML = "";
  code.split("").forEach((char, i) => {
    const span = document.createElement("span");
    span.className = "char";
    span.textContent = char;
    span.style.animationDelay = `${i * 0.1}s`;
    display.appendChild(span);
  });
}

// ── Lobby Tabs ──────────────────────────────────────────────────────────────

$$(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach(t => t.classList.remove("active"));
    $$(".tab-content").forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    $(`#tab-${tab.dataset.tab}`).classList.add("active");
    sfxClick();
  });
});

// ── Create Room ─────────────────────────────────────────────────────────────

$("#btn-create").addEventListener("click", () => {
  const name = $("#input-name").value.trim();
  if (!name) { showToast("Agent ID required."); sfxError(); return; }
  socket.emit("create-room", { name, digitLength: $("#input-digits").value, turnTime: $("#input-turn-time").value });
  sfxClick();
});

// ── Join Room ───────────────────────────────────────────────────────────────

$("#btn-join").addEventListener("click", () => {
  const name = $("#input-name").value.trim();
  const code = $("#input-code").value.trim();
  if (!name) { showToast("Agent ID required."); sfxError(); return; }
  if (!code) { showToast("Access code required."); sfxError(); return; }
  playerName = name;
  currentRoomCode = code.toUpperCase().trim();
  socket.emit("join-room", { code, name });
  sfxClick();
});

// ── Room Created ────────────────────────────────────────────────────────────

socket.on("room-created", ({ code, digitLength, turnTime }) => {
  currentDigitLength = digitLength;
  currentTurnTime = turnTime || 0;
  currentRoomCode = code;
  playerName = $("#input-name").value.trim();
  animateRoomCode(code);
  showScreen("waiting");
  sfxSuccess();
});

$("#btn-copy").addEventListener("click", () => {
  const code = $("#display-code").textContent;
  navigator.clipboard.writeText(code).then(
    () => showToast("Code copied to clipboard.", "success"),
    () => showToast("Copy failed — select manually.")
  );
  sfxClick();
});

// ── Set Secret Screen ───────────────────────────────────────────────────────

socket.on("game-start-set-secret", ({ digitLength }) => {
  currentDigitLength = digitLength;
  $("#digit-count-label").textContent = digitLength;
  $("#input-secret").maxLength = digitLength;
  $("#input-secret").value = "";
  $("#input-secret").disabled = false;
  $("#btn-secret").disabled = false;
  $("#btn-secret").classList.remove("hidden");
  $("#secret-waiting").classList.add("hidden");
  createDigitBoxes($("#secret-digit-boxes"), digitLength);
  focusDigitBox(0);
  showScreen("secret");
  sfxTurn();
});

// ── Lock Secret ─────────────────────────────────────────────────────────────

$("#btn-secret").addEventListener("click", () => {
  const secret = $("#input-secret").value.trim();
  if (secret.length !== currentDigitLength || !/^\d+$/.test(secret)) {
    showToast(`Enter exactly ${currentDigitLength} digits.`);
    sfxError();
    $$("#secret-digit-boxes .digit-box").forEach(b => {
      b.classList.add("error-shake");
      setTimeout(() => b.classList.remove("error-shake"), 400);
    });
    return;
  }
  socket.emit("set-secret", { secret });
  sfxSuccess();
});

socket.on("secret-accepted", () => {
  $("#btn-secret").disabled = true;
  $("#btn-secret").classList.add("hidden");
  $("#input-secret").disabled = true;
  $("#secret-waiting").classList.remove("hidden");
  $$("#secret-digit-boxes .digit-box").forEach(b => {
    b.style.pointerEvents = "none";
    b.style.opacity = "0.5";
  });
});

socket.on("waiting-for-opponent-secret", () => {});

// ── Game Playing ────────────────────────────────────────────────────────────

socket.on("game-playing", ({ yourName, opponentName, digitLength, isYourTurn, yourSecret, turnTime }) => {
  currentDigitLength = digitLength;
  currentTurnTime = turnTime || 0;
  $("#game-title").textContent = `${yourName} vs ${opponentName}`;
  $("#game-your-secret").textContent = yourSecret;
  $("#input-guess").maxLength = digitLength;
  $("#input-guess").placeholder = "0".repeat(digitLength);
  $("#input-guess").value = "";
  $("#your-guesses").innerHTML = "";
  $("#opponent-guesses").innerHTML = "";

  if (currentTurnTime > 0) {
    $("#turn-timer").classList.remove("hidden");
  } else {
    $("#turn-timer").classList.add("hidden");
  }

  updateTurn(isYourTurn);
  showScreen("game");
  loadNotes();
  if (isYourTurn) $("#input-guess").focus();
  sfxTurn();
});

function updateTurn(isYourTurn) {
  const badge = $("#turn-indicator");
  const gi = $("#input-guess");
  const gb = $("#btn-guess");
  if (isYourTurn) {
    badge.textContent = "YOUR TURN";
    badge.className = "turn-badge your-turn";
    gi.disabled = false;
    gb.disabled = false;
    gi.focus();
  } else {
    badge.textContent = "OPPONENT'S TURN";
    badge.className = "turn-badge their-turn";
    gi.disabled = true;
    gb.disabled = true;
  }
}

// ── Guessing ────────────────────────────────────────────────────────────────

function submitGuess() {
  const guess = $("#input-guess").value.trim();
  if (guess.length !== currentDigitLength || !/^\d+$/.test(guess)) {
    showToast(`Enter exactly ${currentDigitLength} digits.`);
    sfxError();
    $(".input-row").classList.add("shake");
    setTimeout(() => $(".input-row").classList.remove("shake"), 400);
    return;
  }
  socket.emit("make-guess", { guess });
  $("#input-guess").value = "";
  sfxGuess();
}

$("#btn-guess").addEventListener("click", submitGuess);
$("#input-guess").addEventListener("keydown", e => { if (e.key === "Enter") submitGuess(); });

// ── Guess Result ────────────────────────────────────────────────────────────

socket.on("guess-result", ({ isYourTurn, yourGuesses, opponentGuesses }) => {
  renderGuesses($("#your-guesses"), yourGuesses, true);
  renderGuesses($("#opponent-guesses"), opponentGuesses, true);
  updateTurn(isYourTurn);
  if (isYourTurn) sfxTurn();
});

// ── Timer ────────────────────────────────────────────────────────────────────

const TIMER_CIRCUMFERENCE = 2 * Math.PI * 16;
let clientTimerInterval = null;
let clientTimeLeft = 0;

function renderTimer(timeLeft, turnTime) {
  if (!turnTime || turnTime <= 0) return;
  const el = $("#timer-value");
  const fill = $("#timer-fill");
  const clamped = Math.max(0, timeLeft);
  el.textContent = clamped;

  const fraction = clamped / turnTime;
  fill.style.strokeDasharray = `${TIMER_CIRCUMFERENCE}`;
  fill.style.strokeDashoffset = `${TIMER_CIRCUMFERENCE * (1 - fraction)}`;

  const timerEl = $("#turn-timer");
  timerEl.classList.toggle("timer-warning", clamped <= 5 && clamped > 0);
  timerEl.classList.toggle("timer-danger", clamped <= 0);

  if (clamped <= 5 && clamped > 0) {
    playTone(800 + (5 - clamped) * 80, 0.05, "square", 0.03);
  }
}

function startClientTimer(timeLeft, turnTime) {
  stopClientTimer();
  clientTimeLeft = timeLeft;
  renderTimer(clientTimeLeft, turnTime);

  clientTimerInterval = setInterval(() => {
    clientTimeLeft--;
    renderTimer(clientTimeLeft, turnTime);
    if (clientTimeLeft <= 0) stopClientTimer();
  }, 1000);
}

function stopClientTimer() {
  if (clientTimerInterval) {
    clearInterval(clientTimerInterval);
    clientTimerInterval = null;
  }
}

socket.on("timer-tick", ({ timeLeft, turnTime }) => {
  if (Math.abs(clientTimeLeft - timeLeft) > 1 || !clientTimerInterval) {
    startClientTimer(timeLeft, turnTime);
  }
});

socket.on("turn-skipped", ({ isYourTurn, yourGuesses, opponentGuesses, skippedPlayerId }) => {
  renderGuesses($("#your-guesses"), yourGuesses, false);
  renderGuesses($("#opponent-guesses"), opponentGuesses, false);
  updateTurn(isYourTurn);

  if (skippedPlayerId === socket.id) {
    showToast("Time's up! Turn skipped.");
    sfxError();
  } else {
    showToast("Opponent ran out of time!");
    sfxTurn();
  }
});

// ── Game Over ───────────────────────────────────────────────────────────────

socket.on("game-over", ({ winnerName, youWon, yourSecret, opponentSecret, yourGuesses, opponentGuesses }) => {
  const icon = $("#gameover-icon");
  const title = $("#gameover-title");
  const panel = $(".gameover-panel");

  if (youWon) {
    icon.textContent = "ACCESS GRANTED";
    icon.className = "go-icon win-icon";
    icon.style.color = "var(--green)";
    icon.style.fontSize = "1.1rem";
    icon.style.letterSpacing = "0.25em";
    icon.style.fontWeight = "700";
    title.textContent = "CODE CRACKED";
    title.className = "go-title win-text";
    $("#gameover-subtitle").textContent = `Breached in ${yourGuesses.length} attempt${yourGuesses.length !== 1 ? "s" : ""}.`;
    launchConfetti();
    sfxWin();
    panel.classList.add("win-glow");
    setTimeout(() => panel.classList.remove("win-glow"), 6000);
  } else {
    icon.textContent = "ACCESS DENIED";
    icon.className = "go-icon lose-icon";
    icon.style.color = "var(--red)";
    icon.style.fontSize = "1.1rem";
    icon.style.letterSpacing = "0.25em";
    icon.style.fontWeight = "700";
    title.textContent = `${winnerName} CRACKED IT`;
    title.className = "go-title lose-text";
    $("#gameover-subtitle").textContent = `They breached your code in ${opponentGuesses.length} attempt${opponentGuesses.length !== 1 ? "s" : ""}.`;
    sfxLose();
    panel.classList.add("red-flash");
    setTimeout(() => panel.classList.remove("red-flash"), 400);
  }

  const yv = $("#reveal-yours");
  const tv = $("#reveal-theirs");
  yv.textContent = yourSecret;
  tv.textContent = opponentSecret;
  yv.classList.add("revealed");
  tv.classList.add("revealed");
  setTimeout(() => { yv.classList.remove("revealed"); tv.classList.remove("revealed"); }, 600);

  stopClientTimer();
  $("#turn-timer").classList.add("hidden");

  renderGuesses($("#go-your-guesses"), yourGuesses, false);
  renderGuesses($("#go-opponent-guesses"), opponentGuesses, false);

  $("#btn-rematch").disabled = false;
  $("#btn-rematch").classList.remove("hidden");
  $("#rematch-waiting").classList.add("hidden");
  showScreen("gameover");
});

// ── Rematch ─────────────────────────────────────────────────────────────────

$("#btn-rematch").addEventListener("click", () => {
  socket.emit("play-again");
  sfxClick();
});

socket.on("waiting-for-rematch", () => {
  $("#btn-rematch").disabled = true;
  $("#btn-rematch").classList.add("hidden");
  $("#rematch-waiting").classList.remove("hidden");
});

// ── Opponent Left ───────────────────────────────────────────────────────────

socket.on("opponent-left", ({ name }) => {
  showToast(`${name} disconnected.`);
  stopClientTimer();
  clearNotesStorage();
  currentRoomCode = null;
  playerName = null;
  $("#turn-timer").classList.add("hidden");
  $("#input-secret").disabled = false;
  $("#input-guess").disabled = false;
  $("#btn-guess").disabled = false;
  showScreen("lobby");
  sfxError();
});

// ── Errors ──────────────────────────────────────────────────────────────────

socket.on("error-msg", (msg) => { showToast(msg); sfxError(); });

// ── Reconnect Handling ───────────────────────────────────────────────────────

socket.on("connect", () => {
  if (currentRoomCode && playerName) {
    socket.emit("rejoin-room", { code: currentRoomCode, name: playerName });
  }
});

socket.on("rejoin-state", (state) => {
  currentDigitLength = state.digitLength;
  currentTurnTime = state.turnTime || 0;
  currentRoomCode = state.code;

  if (state.phase === "waiting") {
    animateRoomCode(state.code);
    showScreen("waiting");
  } else if (state.phase === "setting") {
    $("#digit-count-label").textContent = state.digitLength;
    $("#input-secret").maxLength = state.digitLength;

    if (state.yourSecretSet) {
      $("#input-secret").disabled = true;
      $("#btn-secret").disabled = true;
      $("#btn-secret").classList.add("hidden");
      $("#secret-waiting").classList.remove("hidden");
    } else {
      $("#input-secret").value = "";
      $("#input-secret").disabled = false;
      $("#btn-secret").disabled = false;
      $("#btn-secret").classList.remove("hidden");
      $("#secret-waiting").classList.add("hidden");
      createDigitBoxes($("#secret-digit-boxes"), state.digitLength);
      focusDigitBox(0);
    }
    showScreen("secret");
  } else if (state.phase === "playing") {
    $("#game-title").textContent = `${state.yourName} vs ${state.opponentName}`;
    $("#game-your-secret").textContent = state.yourSecret;
    $("#input-guess").maxLength = state.digitLength;
    $("#input-guess").placeholder = "0".repeat(state.digitLength);
    $("#input-guess").value = "";

    if (currentTurnTime > 0) {
      $("#turn-timer").classList.remove("hidden");
      startClientTimer(state.timeLeft, currentTurnTime);
    } else {
      $("#turn-timer").classList.add("hidden");
    }

    renderGuesses($("#your-guesses"), state.yourGuesses, false);
    renderGuesses($("#opponent-guesses"), state.opponentGuesses, false);
    updateTurn(state.isYourTurn);
    showScreen("game");
    loadNotes();
  } else if (state.phase === "finished") {
    stopClientTimer();
    $("#turn-timer").classList.add("hidden");
    showScreen("gameover");
  }
});

socket.on("rejoin-failed", () => {
  clearNotesStorage();
  currentRoomCode = null;
  playerName = null;
  stopClientTimer();
  $("#turn-timer").classList.add("hidden");
  showScreen("lobby");
});

// ── Keyboard Shortcuts ──────────────────────────────────────────────────────

$("#input-code").addEventListener("keydown", e => { if (e.key === "Enter") $("#btn-join").click(); });
$("#input-name").addEventListener("keydown", e => {
  if (e.key === "Enter") {
    const t = document.querySelector(".tab.active");
    if (t.dataset.tab === "create") $("#btn-create").click();
  }
});
