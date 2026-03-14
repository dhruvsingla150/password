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
    const saved = localStorage.getItem(key) || "";
    $("#notes-textarea").value = saved;
    $("#go-notes-textarea").value = saved;
  } catch (_) {
    $("#notes-textarea").value = "";
    $("#go-notes-textarea").value = "";
  }
}

function clearNotesStorage() {
  const key = getNotesKey();
  if (!key) return;
  try { localStorage.removeItem(key); } catch (_) {}
}

function syncNotes(source, target) {
  target.value = source.value;
  saveNotes();
}

(function initNotes() {
  const gameToggle = $("#notes-toggle");
  const gameBody = $("#notes-body");
  const gameTextarea = $("#notes-textarea");

  const goToggle = $("#go-notes-toggle");
  const goBody = $("#go-notes-body");
  const goTextarea = $("#go-notes-textarea");

  gameToggle.addEventListener("click", () => {
    const isOpen = gameBody.classList.toggle("open");
    gameToggle.classList.toggle("active", isOpen);
    if (isOpen) gameTextarea.focus();
    sfxClick();
  });

  goToggle.addEventListener("click", () => {
    const isOpen = goBody.classList.toggle("open");
    goToggle.classList.toggle("active", isOpen);
    if (isOpen) goTextarea.focus();
    sfxClick();
  });

  gameTextarea.addEventListener("input", () => syncNotes(gameTextarea, goTextarea));
  goTextarea.addEventListener("input", () => syncNotes(goTextarea, gameTextarea));
})();

// ══════════════════════════════════════════════════════════════════════════════
//  BREACH TRANSITION ANIMATION
// ══════════════════════════════════════════════════════════════════════════════

const breachOverlay = $("#breach-overlay");
const breachCanvas = $("#breach-canvas");
const bCtx = breachCanvas.getContext("2d");
const breachStatus = $("#breach-status");
const breachCounter = $("#breach-counter");
const breachFlash = $("#breach-flash");

function resizeBreachCanvas() {
  breachCanvas.width = window.innerWidth;
  breachCanvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeBreachCanvas);

function playBreachAnimation() {
  return new Promise((resolve) => {
    resizeBreachCanvas();
    breachOverlay.classList.remove("hidden");
    breachStatus.textContent = "";
    breachStatus.className = "breach-status";
    breachCounter.textContent = "";
    breachCounter.className = "breach-counter";
    breachFlash.className = "breach-flash";

    const W = breachCanvas.width;
    const H = breachCanvas.height;
    const cx = W / 2;
    const cy = H / 2;

    const TOTAL_DURATION = 4200;
    const PHASE_WARP = 0;
    const PHASE_RAIN = 1200;
    const PHASE_GRID = 2200;
    const PHASE_SLAM = 3200;
    const PHASE_END = 3900;

    let startTime = null;
    let animId = null;

    // ── Warp Stars ──────────────────────────────────
    const stars = [];
    for (let i = 0; i < 500; i++) {
      stars.push({
        x: (Math.random() - 0.5) * W * 3,
        y: (Math.random() - 0.5) * H * 3,
        z: Math.random() * 1500 + 200,
        pz: 0,
        size: Math.random() * 2 + 0.5,
      });
    }

    // ── Matrix Rain Columns ─────────────────────────
    const FONT_SIZE = 14;
    const cols = Math.ceil(W / FONT_SIZE);
    const rainDrops = new Array(cols).fill(0);
    const rainChars = [];
    const matrixChars = "01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";
    for (let i = 0; i < cols; i++) {
      rainDrops[i] = Math.random() * -50;
      rainChars[i] = [];
    }

    // ── Grid Blocks ─────────────────────────────────
    const blocks = [];
    for (let i = 0; i < 80; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * 400 + 200;
      blocks.push({
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        z: Math.random() * 2000 + 500,
        w: Math.random() * 60 + 20,
        h: Math.random() * 60 + 20,
        speed: Math.random() * 15 + 8,
        char: matrixChars[Math.floor(Math.random() * matrixChars.length)],
        color: Math.random() > 0.5 ? "#d4a017" : "#27ae60",
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.1,
      });
    }

    // ── Shockwave Ring ──────────────────────────────
    let shockRadius = 0;
    let shockOpacity = 0;

    // ── Hexagonal Grid Lines ────────────────────────
    const hexLines = [];
    for (let i = 0; i < 30; i++) {
      const angle = (i / 30) * Math.PI * 2;
      hexLines.push({
        angle,
        length: 0,
        maxLength: Math.random() * 300 + 200,
        speed: Math.random() * 8 + 4,
        opacity: 0,
      });
    }

    // ── Particle Burst ──────────────────────────────
    const burstParticles = [];
    for (let i = 0; i < 200; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 12 + 3;
      burstParticles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: Math.random() * 3 + 1,
        life: 1,
        decay: Math.random() * 0.02 + 0.01,
        color: ["#d4a017", "#27ae60", "#f0f0f0", "#c0392b"][Math.floor(Math.random() * 4)],
      });
    }

    let slamShown = false;
    let finalShown = false;
    let burstFired = false;

    function render(timestamp) {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / TOTAL_DURATION, 1);

      bCtx.fillStyle = `rgba(0, 0, 0, ${elapsed < PHASE_RAIN ? 0.15 : 0.12})`;
      bCtx.fillRect(0, 0, W, H);

      // ── Phase 1: Warp Tunnel ──────────────────────
      if (elapsed < PHASE_GRID + 400) {
        const warpSpeed = elapsed < PHASE_RAIN
          ? 0.5 + (elapsed / PHASE_RAIN) * 15
          : 15 + ((elapsed - PHASE_RAIN) / 1000) * 5;

        for (const star of stars) {
          star.pz = star.z;
          star.z -= warpSpeed;

          if (star.z <= 0) {
            star.x = (Math.random() - 0.5) * W * 3;
            star.y = (Math.random() - 0.5) * H * 3;
            star.z = 1500;
            star.pz = star.z;
          }

          const sx = (star.x / star.z) * cx + cx;
          const sy = (star.y / star.z) * cy + cy;
          const px = (star.x / star.pz) * cx + cx;
          const py = (star.y / star.pz) * cy + cy;

          const depth = 1 - star.z / 1500;
          const brightness = Math.min(1, depth * 2);
          const streak = Math.min(1, warpSpeed / 15);

          bCtx.beginPath();
          bCtx.moveTo(px, py);
          bCtx.lineTo(sx, sy);
          bCtx.strokeStyle = `rgba(212, 160, 23, ${brightness * 0.8})`;
          bCtx.lineWidth = star.size * (1 + streak * 2) * depth;
          bCtx.stroke();

          if (depth > 0.7) {
            bCtx.beginPath();
            bCtx.arc(sx, sy, star.size * depth * 2, 0, Math.PI * 2);
            bCtx.fillStyle = `rgba(240, 240, 240, ${brightness * 0.5})`;
            bCtx.fill();
          }
        }

        if (elapsed > 400) {
          const tunnelProgress = Math.min((elapsed - 400) / (PHASE_GRID - 400), 1);
          const numRings = 8;
          for (let i = 0; i < numRings; i++) {
            const ringZ = ((i / numRings) + (elapsed * 0.001)) % 1;
            const ringScale = 1 / (1.01 - ringZ);
            const ringSize = ringScale * 40;
            const alpha = ringZ * 0.3 * tunnelProgress;

            bCtx.beginPath();
            const sides = 6;
            for (let s = 0; s <= sides; s++) {
              const angle = (s / sides) * Math.PI * 2 - Math.PI / 6;
              const hx = cx + Math.cos(angle) * ringSize;
              const hy = cy + Math.sin(angle) * ringSize;
              if (s === 0) bCtx.moveTo(hx, hy);
              else bCtx.lineTo(hx, hy);
            }
            bCtx.strokeStyle = `rgba(212, 160, 23, ${alpha})`;
            bCtx.lineWidth = 1 + ringZ;
            bCtx.stroke();
          }
        }
      }

      // ── Phase 2: Matrix Rain ──────────────────────
      if (elapsed >= PHASE_RAIN && elapsed < PHASE_SLAM + 300) {
        const rainAlpha = Math.min(1, (elapsed - PHASE_RAIN) / 500);
        bCtx.font = `${FONT_SIZE}px monospace`;

        for (let i = 0; i < cols; i++) {
          const char = matrixChars[Math.floor(Math.random() * matrixChars.length)];
          const x = i * FONT_SIZE;
          const y = rainDrops[i] * FONT_SIZE;

          if (y > 0 && y < H) {
            const headGlow = Math.random() > 0.7;
            bCtx.fillStyle = headGlow
              ? `rgba(240, 240, 240, ${rainAlpha * 0.9})`
              : `rgba(39, 174, 96, ${rainAlpha * (0.4 + Math.random() * 0.4)})`;
            bCtx.fillText(char, x, y);

            if (headGlow) {
              bCtx.shadowColor = "#27ae60";
              bCtx.shadowBlur = 8;
              bCtx.fillStyle = `rgba(39, 174, 96, ${rainAlpha})`;
              bCtx.fillText(char, x, y);
              bCtx.shadowBlur = 0;
            }
          }

          rainDrops[i] += 0.6 + Math.random() * 0.4;
          if (rainDrops[i] * FONT_SIZE > H && Math.random() > 0.975) {
            rainDrops[i] = Math.random() * -10;
          }
        }

        if (Math.random() > 0.92) {
          const glitchY = Math.random() * H;
          const glitchH = Math.random() * 20 + 5;
          const glitchShift = (Math.random() - 0.5) * 30;
          const imgData = bCtx.getImageData(0, glitchY, W, glitchH);
          bCtx.putImageData(imgData, glitchShift, glitchY + (Math.random() - 0.5) * 5);
        }
      }

      // ── Phase 3: Grid Blocks Flying At You ────────
      if (elapsed >= PHASE_GRID && elapsed < PHASE_END) {
        const blockAlpha = Math.min(1, (elapsed - PHASE_GRID) / 300);

        for (const block of blocks) {
          block.z -= block.speed;
          block.rotation += block.rotSpeed;

          if (block.z <= 1) {
            block.z = 2000;
            block.x = (Math.random() - 0.5) * 800;
            block.y = (Math.random() - 0.5) * 800;
          }

          const scale = 400 / block.z;
          const sx = block.x * scale + cx;
          const sy = block.y * scale + cy;
          const sw = block.w * scale;
          const sh = block.h * scale;

          if (sx < -100 || sx > W + 100 || sy < -100 || sy > H + 100) continue;

          const depth = 1 - block.z / 2000;

          bCtx.save();
          bCtx.translate(sx, sy);
          bCtx.rotate(block.rotation);
          bCtx.globalAlpha = depth * blockAlpha * 0.7;

          bCtx.strokeStyle = block.color;
          bCtx.lineWidth = 1 + depth;
          bCtx.strokeRect(-sw / 2, -sh / 2, sw, sh);

          const cornerSize = Math.min(sw, sh) * 0.3;
          bCtx.strokeStyle = block.color;
          bCtx.lineWidth = 2;
          bCtx.beginPath();
          bCtx.moveTo(-sw / 2, -sh / 2 + cornerSize);
          bCtx.lineTo(-sw / 2, -sh / 2);
          bCtx.lineTo(-sw / 2 + cornerSize, -sh / 2);
          bCtx.stroke();
          bCtx.beginPath();
          bCtx.moveTo(sw / 2 - cornerSize, -sh / 2);
          bCtx.lineTo(sw / 2, -sh / 2);
          bCtx.lineTo(sw / 2, -sh / 2 + cornerSize);
          bCtx.stroke();
          bCtx.beginPath();
          bCtx.moveTo(sw / 2, sh / 2 - cornerSize);
          bCtx.lineTo(sw / 2, sh / 2);
          bCtx.lineTo(sw / 2 - cornerSize, sh / 2);
          bCtx.stroke();
          bCtx.beginPath();
          bCtx.moveTo(-sw / 2 + cornerSize, sh / 2);
          bCtx.lineTo(-sw / 2, sh / 2);
          bCtx.lineTo(-sw / 2, sh / 2 - cornerSize);
          bCtx.stroke();

          if (depth > 0.3 && sw > 15) {
            bCtx.font = `${Math.max(10, sw * 0.4)}px monospace`;
            bCtx.fillStyle = block.color;
            bCtx.textAlign = "center";
            bCtx.textBaseline = "middle";
            bCtx.fillText(block.char, 0, 0);
          }

          bCtx.restore();
        }

        for (const line of hexLines) {
          if (elapsed >= PHASE_GRID + 200) {
            line.length = Math.min(line.maxLength, line.length + line.speed);
            line.opacity = Math.min(0.4, line.opacity + 0.02);
          }
          const ex = cx + Math.cos(line.angle) * line.length;
          const ey = cy + Math.sin(line.angle) * line.length;
          bCtx.beginPath();
          bCtx.moveTo(cx, cy);
          bCtx.lineTo(ex, ey);
          bCtx.strokeStyle = `rgba(212, 160, 23, ${line.opacity})`;
          bCtx.lineWidth = 1;
          bCtx.stroke();

          if (line.length > 50) {
            bCtx.beginPath();
            bCtx.arc(ex, ey, 2, 0, Math.PI * 2);
            bCtx.fillStyle = `rgba(212, 160, 23, ${line.opacity * 2})`;
            bCtx.fill();
          }
        }
      }

      // ── Phase 4: Slam Text + Shockwave ────────────
      if (elapsed >= PHASE_SLAM && !slamShown) {
        slamShown = true;
        breachStatus.textContent = "BREACH INITIATED";
        breachStatus.className = "breach-status slam";
        sfxBreachSlam();

        shockRadius = 0;
        shockOpacity = 1;
      }

      if (elapsed >= PHASE_SLAM && elapsed < PHASE_END) {
        const shockProgress = (elapsed - PHASE_SLAM) / (PHASE_END - PHASE_SLAM);
        shockRadius = shockProgress * Math.max(W, H) * 0.8;
        shockOpacity = 1 - shockProgress;

        bCtx.beginPath();
        bCtx.arc(cx, cy, shockRadius, 0, Math.PI * 2);
        bCtx.strokeStyle = `rgba(212, 160, 23, ${shockOpacity * 0.6})`;
        bCtx.lineWidth = 3 + (1 - shockProgress) * 5;
        bCtx.stroke();

        bCtx.beginPath();
        bCtx.arc(cx, cy, shockRadius * 0.85, 0, Math.PI * 2);
        bCtx.strokeStyle = `rgba(39, 174, 96, ${shockOpacity * 0.3})`;
        bCtx.lineWidth = 2;
        bCtx.stroke();

        if (elapsed >= PHASE_SLAM + 100 && elapsed < PHASE_SLAM + 300) {
          breachStatus.classList.add("glitch-text");
        } else {
          breachStatus.classList.remove("glitch-text");
        }
      }

      // ── Phase 5: Final Text + Burst + Flash ───────
      if (elapsed >= PHASE_END && !finalShown) {
        finalShown = true;
        breachStatus.textContent = "COMMENCE";
        breachStatus.className = "breach-status final-slam";
        breachFlash.className = "breach-flash fire";
        sfxBreachFinal();
        burstFired = true;
      }

      if (burstFired) {
        for (const p of burstParticles) {
          p.x += p.vx;
          p.y += p.vy;
          p.vx *= 0.97;
          p.vy *= 0.97;
          p.life -= p.decay;

          if (p.life > 0) {
            bCtx.beginPath();
            bCtx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            bCtx.fillStyle = p.color;
            bCtx.globalAlpha = p.life;
            bCtx.fill();
            bCtx.globalAlpha = 1;
          }
        }
      }

      // ── Scanline effect over everything ───────────
      if (elapsed > 200) {
        for (let y = 0; y < H; y += 3) {
          bCtx.fillStyle = `rgba(0, 0, 0, 0.08)`;
          bCtx.fillRect(0, y, W, 1);
        }
      }

      // ── Vignette ──────────────────────────────────
      const vigGrad = bCtx.createRadialGradient(cx, cy, H * 0.3, cx, cy, H * 0.9);
      vigGrad.addColorStop(0, "transparent");
      vigGrad.addColorStop(1, "rgba(0, 0, 0, 0.5)");
      bCtx.fillStyle = vigGrad;
      bCtx.fillRect(0, 0, W, H);

      if (elapsed < TOTAL_DURATION) {
        animId = requestAnimationFrame(render);
      } else {
        cancelAnimationFrame(animId);
        breachOverlay.classList.add("hidden");
        breachStatus.className = "breach-status";
        breachCounter.className = "breach-counter";
        breachFlash.className = "breach-flash";
        bCtx.clearRect(0, 0, W, H);
        resolve();
      }
    }

    bCtx.fillStyle = "#000";
    bCtx.fillRect(0, 0, W, H);
    animId = requestAnimationFrame(render);
  });
}

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

function sfxBreachWarp() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(80, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 1.2);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.5);

    const noise = ctx.createOscillator();
    const noiseGain = ctx.createGain();
    noise.type = "sawtooth";
    noise.frequency.setValueAtTime(40, ctx.currentTime);
    noise.frequency.linearRampToValueAtTime(200, ctx.currentTime + 1.0);
    noiseGain.gain.setValueAtTime(0.03, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
    noise.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start();
    noise.stop(ctx.currentTime + 1.2);
  } catch (_) {}
}

function sfxBreachSlam() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);

    const hit = ctx.createOscillator();
    const hitGain = ctx.createGain();
    hit.type = "sine";
    hit.frequency.setValueAtTime(800, ctx.currentTime);
    hit.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.15);
    hitGain.gain.setValueAtTime(0.1, ctx.currentTime);
    hitGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    hit.connect(hitGain);
    hitGain.connect(ctx.destination);
    hit.start();
    hit.stop(ctx.currentTime + 0.2);
  } catch (_) {}
}

function sfxBreachFinal() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    [200, 400, 600, 800].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, ctx.currentTime + i * 0.04);
      gain.gain.setValueAtTime(0.08, ctx.currentTime + i * 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.04 + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.04);
      osc.stop(ctx.currentTime + i * 0.04 + 0.3);
    });

    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = "sawtooth";
    boom.frequency.setValueAtTime(100, ctx.currentTime);
    boom.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.4);
    boomGain.gain.setValueAtTime(0.1, ctx.currentTime);
    boomGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    boom.connect(boomGain);
    boomGain.connect(ctx.destination);
    boom.start();
    boom.stop(ctx.currentTime + 0.5);
  } catch (_) {}
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
    if (secretDigitValues.includes(e.key)) {
      showToast(`Digit ${e.key} already used — no repeats allowed.`);
      sfxError();
      e.preventDefault();
      return;
    }
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

function hasDuplicateDigits(str) {
  return new Set(str).size !== str.length;
}

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
  if (hasDuplicateDigits(secret)) {
    showToast("No repeated digits allowed.");
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

socket.on("game-playing", async ({ yourName, opponentName, digitLength, isYourTurn, yourSecret, turnTime }) => {
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

  sfxBreachWarp();
  await playBreachAnimation();

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
  if (hasDuplicateDigits(guess)) {
    showToast("No repeated digits allowed.");
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
  loadNotes();
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
    loadNotes();
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
