const socket = io();

// ── DOM References ──────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const screens = {
  lobby: $("#screen-lobby"),
  waiting: $("#screen-waiting"),
  secret: $("#screen-secret"),
  game: $("#screen-game"),
  gameover: $("#screen-gameover"),
};

let currentDigitLength = 4;

// ── Helpers ─────────────────────────────────────────────────────────────────

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
}

function showToast(msg) {
  const toast = $("#toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  toast.classList.add("visible");
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.classList.add("hidden"), 300);
  }, 3000);
}

function renderGuesses(container, guesses) {
  container.innerHTML = "";
  guesses.forEach((g, i) => {
    const row = document.createElement("div");
    row.className = "guess-row";
    row.innerHTML = `
      <span style="color:var(--muted);font-size:0.75rem;min-width:1.2em;">${i + 1}</span>
      <span class="guess-number">${g.guess}</span>
      <span class="guess-result">
        <span class="result-badge numbers">${g.numbersCorrect}N</span>
        <span class="result-badge positions">${g.positionsCorrect}P</span>
      </span>
    `;
    container.appendChild(row);
  });
  container.scrollTop = container.scrollHeight;
}

// ── Lobby Tabs ──────────────────────────────────────────────────────────────

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    tab.classList.add("active");
    $(`#tab-${tab.dataset.tab}`).classList.add("active");
  });
});

// ── Create Room ─────────────────────────────────────────────────────────────

$("#btn-create").addEventListener("click", () => {
  const name = $("#input-name").value.trim();
  if (!name) {
    showToast("Please enter your name.");
    return;
  }
  const digitLength = $("#input-digits").value;
  socket.emit("create-room", { name, digitLength });
});

// ── Join Room ───────────────────────────────────────────────────────────────

$("#btn-join").addEventListener("click", () => {
  const name = $("#input-name").value.trim();
  const code = $("#input-code").value.trim();
  if (!name) {
    showToast("Please enter your name.");
    return;
  }
  if (!code) {
    showToast("Please enter a room code.");
    return;
  }
  socket.emit("join-room", { code, name });
});

// ── Room Created → Waiting ──────────────────────────────────────────────────

socket.on("room-created", ({ code, digitLength }) => {
  currentDigitLength = digitLength;
  $("#display-code").textContent = code;
  showScreen("waiting");
});

$("#btn-copy").addEventListener("click", () => {
  const code = $("#display-code").textContent;
  navigator.clipboard.writeText(code).then(
    () => showToast("Code copied!"),
    () => showToast("Couldn't copy — select it manually.")
  );
  const toast = $("#toast");
  toast.style.background = "var(--accent)";
  setTimeout(() => (toast.style.background = ""), 3200);
});

// ── Both Joined → Set Secret ────────────────────────────────────────────────

socket.on("game-start-set-secret", ({ digitLength, players }) => {
  currentDigitLength = digitLength;
  $("#digit-count-label").textContent = digitLength;
  $("#input-secret").maxLength = digitLength;
  $("#input-secret").placeholder = "0".repeat(digitLength);
  $("#input-secret").value = "";
  $("#input-secret").disabled = false;
  $("#btn-secret").disabled = false;
  $("#btn-secret").classList.remove("hidden");
  $("#secret-waiting").classList.add("hidden");
  showScreen("secret");
});

// ── Set Secret ──────────────────────────────────────────────────────────────

$("#btn-secret").addEventListener("click", () => {
  const secret = $("#input-secret").value.trim();
  if (secret.length !== currentDigitLength || !/^\d+$/.test(secret)) {
    showToast(`Enter exactly ${currentDigitLength} digits.`);
    return;
  }
  socket.emit("set-secret", { secret });
});

socket.on("secret-accepted", () => {
  $("#btn-secret").disabled = true;
  $("#btn-secret").classList.add("hidden");
  $("#input-secret").disabled = true;
  $("#secret-waiting").classList.remove("hidden");
});

socket.on("waiting-for-opponent-secret", () => {
  // already handled by secret-accepted visual
});

// ── Game Playing ────────────────────────────────────────────────────────────

socket.on("game-playing", ({ yourName, opponentName, digitLength, isYourTurn, yourSecret }) => {
  currentDigitLength = digitLength;
  $("#game-title").textContent = `${yourName} vs ${opponentName}`;
  $("#game-your-secret").textContent = yourSecret;
  $("#input-guess").maxLength = digitLength;
  $("#input-guess").placeholder = "0".repeat(digitLength);
  $("#input-guess").value = "";
  $("#your-guesses").innerHTML = "";
  $("#opponent-guesses").innerHTML = "";
  updateTurn(isYourTurn);
  showScreen("game");
  if (isYourTurn) $("#input-guess").focus();
});

function updateTurn(isYourTurn) {
  const badge = $("#turn-indicator");
  const guessInput = $("#input-guess");
  const guessBtn = $("#btn-guess");

  if (isYourTurn) {
    badge.textContent = "Your Turn";
    badge.className = "turn-badge your-turn";
    guessInput.disabled = false;
    guessBtn.disabled = false;
    guessInput.focus();
  } else {
    badge.textContent = "Opponent's Turn";
    badge.className = "turn-badge their-turn";
    guessInput.disabled = true;
    guessBtn.disabled = true;
  }
}

// ── Make Guess ───────────────────────────────────────────────────────────────

function submitGuess() {
  const guess = $("#input-guess").value.trim();
  if (guess.length !== currentDigitLength || !/^\d+$/.test(guess)) {
    showToast(`Enter exactly ${currentDigitLength} digits.`);
    return;
  }
  socket.emit("make-guess", { guess });
  $("#input-guess").value = "";
}

$("#btn-guess").addEventListener("click", submitGuess);
$("#input-guess").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitGuess();
});

// ── Guess Result ────────────────────────────────────────────────────────────

socket.on("guess-result", ({ isYourTurn, yourGuesses, opponentGuesses }) => {
  renderGuesses($("#your-guesses"), yourGuesses);
  renderGuesses($("#opponent-guesses"), opponentGuesses);
  updateTurn(isYourTurn);
});

// ── Game Over ───────────────────────────────────────────────────────────────

socket.on("game-over", ({ winnerName, youWon, yourSecret, opponentSecret, yourGuesses, opponentGuesses }) => {
  if (youWon) {
    $("#gameover-icon").textContent = "🏆";
    $("#gameover-title").textContent = "You Won!";
    $("#gameover-subtitle").textContent = `You cracked it in ${yourGuesses.length} guess${yourGuesses.length !== 1 ? "es" : ""}!`;
  } else {
    $("#gameover-icon").textContent = "😔";
    $("#gameover-title").textContent = `${winnerName} Won!`;
    $("#gameover-subtitle").textContent = `They cracked your number in ${opponentGuesses.length} guess${opponentGuesses.length !== 1 ? "es" : ""}.`;
  }

  $("#reveal-yours").textContent = yourSecret;
  $("#reveal-theirs").textContent = opponentSecret;

  renderGuesses($("#go-your-guesses"), yourGuesses);
  renderGuesses($("#go-opponent-guesses"), opponentGuesses);

  $("#btn-rematch").disabled = false;
  $("#btn-rematch").classList.remove("hidden");
  $("#rematch-waiting").classList.add("hidden");

  showScreen("gameover");
});

// ── Rematch ─────────────────────────────────────────────────────────────────

$("#btn-rematch").addEventListener("click", () => {
  socket.emit("play-again");
});

socket.on("waiting-for-rematch", () => {
  $("#btn-rematch").disabled = true;
  $("#btn-rematch").classList.add("hidden");
  $("#rematch-waiting").classList.remove("hidden");
});

// ── Opponent Left ───────────────────────────────────────────────────────────

socket.on("opponent-left", ({ name }) => {
  showToast(`${name} left the game.`);
  $("#input-secret").disabled = false;
  $("#input-guess").disabled = false;
  $("#btn-guess").disabled = false;
  showScreen("lobby");
});

// ── Errors ──────────────────────────────────────────────────────────────────

socket.on("error-msg", (msg) => {
  showToast(msg);
});

// ── Enter Key on Lobby Inputs ───────────────────────────────────────────────

$("#input-code").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#btn-join").click();
});

$("#input-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const activeTab = document.querySelector(".tab.active");
    if (activeTab.dataset.tab === "create") $("#btn-create").click();
  }
});

$("#input-secret").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#btn-secret").click();
});
