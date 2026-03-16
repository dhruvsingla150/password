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
    breachOverlay.style.opacity = "1";
    breachStatus.textContent = "";
    breachStatus.className = "breach-status";
    breachCounter.textContent = "";
    breachCounter.className = "breach-counter";
    breachFlash.className = "breach-flash";

    const W = breachCanvas.width;
    const H = breachCanvas.height;
    const cx = W / 2;
    const cy = H / 2;

    // The lock is drawn relative to a "unit size" so it scales to any screen
    const lockScale = Math.min(W, H) * 0.0028;

    const TOTAL_DURATION = 5400;
    const PHASE_WARP_END = 1800;
    const PHASE_LOCK_APPEAR = 1400;
    const PHASE_LOCK_SLAM = 2600;
    const PHASE_SHOCKWAVE = 2600;
    const PHASE_TEXT = 3200;
    const PHASE_HOLD = 4200;
    const PHASE_FADEOUT = 4400;

    let startTime = null;
    let animId = null;

    // ── Warp Stars ──────────────────────────────────
    const stars = [];
    for (let i = 0; i < 400; i++) {
      stars.push({
        x: (Math.random() - 0.5) * W * 3,
        y: (Math.random() - 0.5) * H * 3,
        z: Math.random() * 1500 + 200,
        pz: 0,
        size: Math.random() * 2 + 0.5,
      });
    }

    // ── Particle Burst (fired on lock slam) ─────────
    const burstParticles = [];
    for (let i = 0; i < 150; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 10 + 2;
      burstParticles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: Math.random() * 3 + 1,
        life: 1,
        decay: Math.random() * 0.015 + 0.008,
        color: ["#d4a017", "#27ae60", "#f0f0f0"][Math.floor(Math.random() * 3)],
      });
    }

    // ── Radial Lines (burst outward on slam) ────────
    const radialLines = [];
    for (let i = 0; i < 24; i++) {
      radialLines.push({
        angle: (i / 24) * Math.PI * 2,
        length: 0,
        maxLength: Math.random() * 250 + 150,
        speed: Math.random() * 10 + 6,
      });
    }

    // ── Floating Code Fragments ─────────────────────
    const codeFragments = [];
    const fragTexts = [
      "0x4F2A", "ENCRYPT", "SHA-256", ">>KEY",
      "AUTH_OK", "0xFFFF", "LOCKED", "HASH>>",
      "AES-128", "RSA2048", "VERIFY", "SEALED",
      "0xDEAD", "CIPHER", "ACCESS", "BLOCK",
    ];
    for (let i = 0; i < 30; i++) {
      codeFragments.push({
        x: Math.random() * W,
        y: Math.random() * H,
        text: fragTexts[Math.floor(Math.random() * fragTexts.length)],
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        alpha: 0,
        targetAlpha: Math.random() * 0.3 + 0.05,
        size: Math.random() * 4 + 8,
      });
    }

    let lockSlamDone = false;
    let burstFired = false;
    let textShown = false;
    let screenShake = 0;

    function easeOutBack(t) {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }

    function easeOutElastic(t) {
      if (t === 0 || t === 1) return t;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
    }

    function drawLock(lockCx, lockCy, scale, shackleOpen) {
      // shackleOpen: 1 = fully open (rotated up-left), 0 = fully closed
      const s = scale;
      const bodyW = 60 * s;
      const bodyH = 50 * s;
      const bodyR = 6 * s;
      const bodyTop = lockCy;
      const bodyLeft = lockCx - bodyW / 2;

      // Lock body
      bCtx.beginPath();
      bCtx.moveTo(bodyLeft + bodyR, bodyTop);
      bCtx.lineTo(bodyLeft + bodyW - bodyR, bodyTop);
      bCtx.quadraticCurveTo(bodyLeft + bodyW, bodyTop, bodyLeft + bodyW, bodyTop + bodyR);
      bCtx.lineTo(bodyLeft + bodyW, bodyTop + bodyH - bodyR);
      bCtx.quadraticCurveTo(bodyLeft + bodyW, bodyTop + bodyH, bodyLeft + bodyW - bodyR, bodyTop + bodyH);
      bCtx.lineTo(bodyLeft + bodyR, bodyTop + bodyH);
      bCtx.quadraticCurveTo(bodyLeft, bodyTop + bodyH, bodyLeft, bodyTop + bodyH - bodyR);
      bCtx.lineTo(bodyLeft, bodyTop + bodyR);
      bCtx.quadraticCurveTo(bodyLeft, bodyTop, bodyLeft + bodyR, bodyTop);
      bCtx.closePath();

      const bodyGrad = bCtx.createLinearGradient(bodyLeft, bodyTop, bodyLeft, bodyTop + bodyH);
      bodyGrad.addColorStop(0, "#2a2a2a");
      bodyGrad.addColorStop(0.5, "#1a1a1a");
      bodyGrad.addColorStop(1, "#111111");
      bCtx.fillStyle = bodyGrad;
      bCtx.fill();
      bCtx.strokeStyle = "#d4a017";
      bCtx.lineWidth = 2 * s;
      bCtx.stroke();

      // Inner border highlight
      bCtx.beginPath();
      const inset = 4 * s;
      bCtx.rect(bodyLeft + inset, bodyTop + inset, bodyW - inset * 2, bodyH - inset * 2);
      bCtx.strokeStyle = "rgba(212, 160, 23, 0.15)";
      bCtx.lineWidth = 1 * s;
      bCtx.stroke();

      // Keyhole
      const khCx = lockCx;
      const khCy = bodyTop + bodyH * 0.45;
      const khR = 7 * s;
      bCtx.beginPath();
      bCtx.arc(khCx, khCy, khR, 0, Math.PI * 2);
      bCtx.fillStyle = "#d4a017";
      bCtx.fill();
      bCtx.beginPath();
      bCtx.moveTo(khCx - 4 * s, khCy + khR * 0.6);
      bCtx.lineTo(khCx, khCy + bodyH * 0.45);
      bCtx.lineTo(khCx + 4 * s, khCy + khR * 0.6);
      bCtx.closePath();
      bCtx.fillStyle = "#d4a017";
      bCtx.fill();

      // Shackle
      const shackleW = 36 * s;
      const shackleH = 34 * s;
      const shackleThick = 8 * s;
      const shacklePivotX = lockCx + shackleW / 2;
      const shacklePivotY = bodyTop;

      bCtx.save();
      if (shackleOpen > 0.01) {
        bCtx.translate(shacklePivotX, shacklePivotY);
        bCtx.rotate(-shackleOpen * 0.6);
        bCtx.translate(-shacklePivotX, -shacklePivotY);
      }

      bCtx.beginPath();
      const sLeft = lockCx - shackleW / 2;
      const sBottom = bodyTop + 2 * s;
      bCtx.moveTo(sLeft, sBottom);
      bCtx.lineTo(sLeft, sBottom - shackleH + shackleW / 2);
      bCtx.arc(lockCx, sBottom - shackleH + shackleW / 2, shackleW / 2, Math.PI, 0, false);
      bCtx.lineTo(sLeft + shackleW, sBottom);

      bCtx.moveTo(sLeft + shackleW - shackleThick, sBottom);
      bCtx.lineTo(sLeft + shackleW - shackleThick, sBottom - shackleH + shackleW / 2);
      bCtx.arc(lockCx, sBottom - shackleH + shackleW / 2, shackleW / 2 - shackleThick, 0, Math.PI, true);
      bCtx.lineTo(sLeft + shackleThick, sBottom);

      const shackleGrad = bCtx.createLinearGradient(sLeft, sBottom - shackleH, sLeft + shackleW, sBottom);
      shackleGrad.addColorStop(0, "#444");
      shackleGrad.addColorStop(0.5, "#888");
      shackleGrad.addColorStop(1, "#555");
      bCtx.fillStyle = shackleGrad;
      bCtx.fill();
      bCtx.strokeStyle = "#d4a017";
      bCtx.lineWidth = 1.5 * s;
      bCtx.stroke();

      bCtx.restore();
    }

    function render(timestamp) {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;

      // Screen shake offset
      let shakeX = 0, shakeY = 0;
      if (screenShake > 0) {
        shakeX = (Math.random() - 0.5) * screenShake;
        shakeY = (Math.random() - 0.5) * screenShake;
        screenShake *= 0.9;
        if (screenShake < 0.5) screenShake = 0;
      }

      bCtx.save();
      bCtx.translate(shakeX, shakeY);

      bCtx.fillStyle = "rgba(0, 0, 0, 0.18)";
      bCtx.fillRect(-10, -10, W + 20, H + 20);

      // ── Floating Code Fragments ───────────────────
      if (elapsed > 200 && elapsed < PHASE_HOLD) {
        const fragTarget = elapsed < PHASE_LOCK_SLAM ? 1 : Math.max(0, 1 - (elapsed - PHASE_LOCK_SLAM) / 800);
        bCtx.font = `11px monospace`;
        for (const frag of codeFragments) {
          frag.x += frag.vx;
          frag.y += frag.vy;
          if (frag.x < 0 || frag.x > W) frag.vx *= -1;
          if (frag.y < 0 || frag.y > H) frag.vy *= -1;
          frag.alpha += (frag.targetAlpha * fragTarget - frag.alpha) * 0.05;
          if (frag.alpha > 0.01) {
            bCtx.globalAlpha = frag.alpha;
            bCtx.fillStyle = "#d4a017";
            bCtx.fillText(frag.text, frag.x, frag.y);
            bCtx.globalAlpha = 1;
          }
        }
      }

      // ── Phase 1: Warp Tunnel ──────────────────────
      if (elapsed < PHASE_WARP_END + 600) {
        const fadeOut = elapsed > PHASE_WARP_END
          ? Math.max(0, 1 - (elapsed - PHASE_WARP_END) / 600)
          : 1;
        const warpSpeed = 0.5 + Math.min(elapsed / PHASE_WARP_END, 1) * 18;

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
          const brightness = Math.min(1, depth * 2) * fadeOut;
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
            bCtx.fillStyle = `rgba(240, 240, 240, ${brightness * 0.4})`;
            bCtx.fill();
          }
        }

        // Hexagonal tunnel rings
        if (elapsed > 300) {
          const tunnelAlpha = Math.min(1, (elapsed - 300) / 500) * fadeOut;
          const numRings = 8;
          for (let i = 0; i < numRings; i++) {
            const ringZ = ((i / numRings) + (elapsed * 0.0012)) % 1;
            const ringScale = 1 / (1.01 - ringZ);
            const ringSize = ringScale * 40;
            const alpha = ringZ * 0.25 * tunnelAlpha;

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

      // ── Phase 2: Lock Appears (open) ──────────────
      if (elapsed >= PHASE_LOCK_APPEAR && elapsed < PHASE_FADEOUT + 1000) {
        let lockAlpha, lockDrawScale, shackleOpen;

        if (elapsed < PHASE_LOCK_SLAM) {
          // Lock fading in, open position
          const t = (elapsed - PHASE_LOCK_APPEAR) / (PHASE_LOCK_SLAM - PHASE_LOCK_APPEAR);
          lockAlpha = Math.min(1, t * 1.5);
          lockDrawScale = lockScale * (0.6 + easeOutBack(Math.min(t, 1)) * 0.4);
          shackleOpen = 1;
        } else {
          // Lock slams shut
          const slamDur = 250;
          const t = Math.min((elapsed - PHASE_LOCK_SLAM) / slamDur, 1);
          lockAlpha = 1;
          lockDrawScale = lockScale * (1 + (1 - t) * 0.05);
          shackleOpen = Math.max(0, 1 - easeOutElastic(t));

          if (!lockSlamDone && t >= 0.95) {
            lockSlamDone = true;
            screenShake = 18;
            burstFired = true;
            sfxBreachSlam();
          }
        }

        // Pulsing glow behind the lock
        if (elapsed >= PHASE_LOCK_SLAM) {
          const pulseT = ((elapsed - PHASE_LOCK_SLAM) % 1500) / 1500;
          const pulseR = 80 * lockScale + Math.sin(pulseT * Math.PI * 2) * 15 * lockScale;
          const glowGrad = bCtx.createRadialGradient(cx, cy + 25 * lockScale, 0, cx, cy + 25 * lockScale, pulseR);
          glowGrad.addColorStop(0, `rgba(212, 160, 23, ${0.15 * lockAlpha})`);
          glowGrad.addColorStop(1, "transparent");
          bCtx.fillStyle = glowGrad;
          bCtx.fillRect(cx - pulseR, cy + 25 * lockScale - pulseR, pulseR * 2, pulseR * 2);
        }

        bCtx.globalAlpha = lockAlpha;
        drawLock(cx, cy, lockDrawScale, shackleOpen);
        bCtx.globalAlpha = 1;
      }

      // ── Shockwave on slam ─────────────────────────
      if (elapsed >= PHASE_SHOCKWAVE && elapsed < PHASE_SHOCKWAVE + 800) {
        const t = (elapsed - PHASE_SHOCKWAVE) / 800;
        const radius = t * Math.max(W, H) * 0.6;
        const alpha = (1 - t) * 0.5;

        bCtx.beginPath();
        bCtx.arc(cx, cy + 25 * lockScale, radius, 0, Math.PI * 2);
        bCtx.strokeStyle = `rgba(212, 160, 23, ${alpha})`;
        bCtx.lineWidth = 3 + (1 - t) * 6;
        bCtx.stroke();

        bCtx.beginPath();
        bCtx.arc(cx, cy + 25 * lockScale, radius * 0.7, 0, Math.PI * 2);
        bCtx.strokeStyle = `rgba(39, 174, 96, ${alpha * 0.5})`;
        bCtx.lineWidth = 2;
        bCtx.stroke();
      }

      // ── Radial Lines on slam ──────────────────────
      if (burstFired && elapsed < PHASE_TEXT + 400) {
        for (const line of radialLines) {
          line.length = Math.min(line.maxLength, line.length + line.speed);
          const lineAlpha = Math.max(0, 1 - line.length / line.maxLength) * 0.5;
          const ex = cx + Math.cos(line.angle) * line.length;
          const ey = cy + 25 * lockScale + Math.sin(line.angle) * line.length;
          bCtx.beginPath();
          bCtx.moveTo(cx, cy + 25 * lockScale);
          bCtx.lineTo(ex, ey);
          bCtx.strokeStyle = `rgba(212, 160, 23, ${lineAlpha})`;
          bCtx.lineWidth = 1.5;
          bCtx.stroke();
        }
      }

      // ── Particle Burst ────────────────────────────
      if (burstFired) {
        for (const p of burstParticles) {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.05;
          p.vx *= 0.98;
          p.vy *= 0.98;
          p.life -= p.decay;

          if (p.life > 0) {
            bCtx.beginPath();
            bCtx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            bCtx.fillStyle = p.color;
            bCtx.globalAlpha = p.life * 0.8;
            bCtx.fill();
            bCtx.globalAlpha = 1;
          }
        }
      }

      // ── "LOCKED" Text ─────────────────────────────
      if (elapsed >= PHASE_TEXT && !textShown) {
        textShown = true;
        breachStatus.textContent = "LOCKED";
        breachStatus.className = "breach-status slam";
        sfxBreachFinal();
      }

      if (textShown && elapsed >= PHASE_TEXT && elapsed < PHASE_TEXT + 400) {
        if (elapsed < PHASE_TEXT + 200) {
          breachStatus.classList.add("glitch-text");
        } else {
          breachStatus.classList.remove("glitch-text");
        }
      }

      // ── Glitch tears ──────────────────────────────
      if (elapsed >= PHASE_LOCK_SLAM && elapsed < PHASE_LOCK_SLAM + 500 && Math.random() > 0.7) {
        const glitchY = Math.random() * H;
        const glitchH = Math.random() * 15 + 3;
        const glitchShift = (Math.random() - 0.5) * 25;
        try {
          const imgData = bCtx.getImageData(0, Math.max(0, glitchY), W, Math.min(glitchH, H - glitchY));
          bCtx.putImageData(imgData, glitchShift, glitchY);
        } catch (_) {}
      }

      // ── Scanlines ─────────────────────────────────
      if (elapsed > 200) {
        for (let y = 0; y < H; y += 3) {
          bCtx.fillStyle = "rgba(0, 0, 0, 0.06)";
          bCtx.fillRect(-10, y, W + 20, 1);
        }
      }

      // ── Vignette ──────────────────────────────────
      const vigGrad = bCtx.createRadialGradient(cx, cy, H * 0.3, cx, cy, H * 0.9);
      vigGrad.addColorStop(0, "transparent");
      vigGrad.addColorStop(1, "rgba(0, 0, 0, 0.5)");
      bCtx.fillStyle = vigGrad;
      bCtx.fillRect(-10, -10, W + 20, H + 20);

      bCtx.restore();

      // ── Fade out to game ──────────────────────────
      if (elapsed >= PHASE_FADEOUT) {
        const fadeT = Math.min((elapsed - PHASE_FADEOUT) / (TOTAL_DURATION - PHASE_FADEOUT), 1);
        breachOverlay.style.opacity = String(1 - fadeT);
      }

      if (elapsed < TOTAL_DURATION) {
        animId = requestAnimationFrame(render);
      } else {
        cancelAnimationFrame(animId);
        breachOverlay.classList.add("hidden");
        breachOverlay.style.opacity = "1";
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
  if (soundEnabled) { getAudioCtx(); sfxClick(); initVoiceEngine(); }
});

// ══════════════════════════════════════════════════════════════════════════════
//  IMMERSIVE VOICE ANNOUNCEMENT SYSTEM
// ══════════════════════════════════════════════════════════════════════════════

let voiceReady = false;
let chosenVoice = null;
let voiceQueue = [];
let voiceSpeaking = false;

const VOICE_PREFERENCE = [
  "Google UK English Male",
  "Google US English",
  "Microsoft David",
  "Microsoft Mark",
  "Daniel",
  "Alex",
  "Samantha",
  "Karen",
  "Moira",
  "Tessa",
];

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;

  for (const pref of VOICE_PREFERENCE) {
    const match = voices.find(v => v.name.includes(pref));
    if (match) return match;
  }

  const english = voices.filter(v => v.lang.startsWith("en"));
  const male = english.find(v =>
    /male|david|mark|daniel|james|alex|tom|guy|george/i.test(v.name)
  );
  if (male) return male;
  if (english.length) return english[0];
  return voices[0];
}

function initVoiceEngine() {
  if (voiceReady) return;
  if (!window.speechSynthesis) return;

  const tryInit = () => {
    chosenVoice = pickVoice();
    if (chosenVoice) {
      voiceReady = true;
    }
  };

  tryInit();
  if (!voiceReady) {
    speechSynthesis.onvoiceschanged = () => {
      tryInit();
      speechSynthesis.onvoiceschanged = null;
    };
  }
}

function speakLine(text, opts = {}) {
  if (!soundEnabled || !voiceReady || !window.speechSynthesis) return;

  const {
    pitch = 0.3,
    rate = 0.85,
    volume = 1,
    delay = 0,
    priority = false,
  } = opts;

  const doSpeak = () => {
    speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    utter.voice = chosenVoice;
    utter.pitch = pitch;
    utter.rate = rate;
    utter.volume = volume;

    utter.onend = () => { voiceSpeaking = false; processVoiceQueue(); };
    utter.onerror = () => { voiceSpeaking = false; processVoiceQueue(); };

    voiceSpeaking = true;
    speechSynthesis.speak(utter);
  };

  if (priority) {
    voiceQueue = [];
    if (delay > 0) {
      setTimeout(doSpeak, delay);
    } else {
      doSpeak();
    }
  } else {
    voiceQueue.push({ fn: doSpeak, delay });
    if (!voiceSpeaking) processVoiceQueue();
  }
}

function processVoiceQueue() {
  if (voiceQueue.length === 0) return;
  const next = voiceQueue.shift();
  if (next.delay > 0) {
    setTimeout(next.fn, next.delay);
  } else {
    next.fn();
  }
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── CONTEXTUAL VOICE LINES ──────────────────────────────────────────────────

const VOICE_LINES = {
  roomCreated: [
    "Room initialized. Awaiting operative.",
    "Secure channel open. Standing by.",
    "Transmission channel active.",
  ],

  opponentJoined: [
    "Operative connected. Prepare for engagement.",
    "Second agent detected. Lock your sequence.",
    "Connection established. Set your cipher.",
  ],

  secretLocked: [
    "Cipher locked. Awaiting opponent.",
    "Sequence secured.",
    "Code sealed. Standing by.",
  ],

  gameStart: [
    "Breach protocol initiated. Begin decryption.",
    "All systems engaged. Commence cracking.",
    "Decryption sequence active. Proceed.",
  ],

  yourTurn: [
    "Your move, operative.",
    "Input your sequence.",
    "Awaiting your cipher attempt.",
    "Your turn. Make it count.",
  ],

  opponentTurn: [
    "Opponent is decrypting.",
    "Stand by. Hostile cracking in progress.",
    "Enemy operative analyzing your cipher.",
  ],

  guessResult(numbersCorrect, positionsCorrect, digitLength, attemptNum) {
    const ratio = positionsCorrect / digitLength;
    const numRatio = numbersCorrect / digitLength;

    if (positionsCorrect === 0 && numbersCorrect === 0) {
      return pick([
        "Complete miss. Zero signals detected.",
        "Nothing. Cold read. Recalibrate.",
        "Negative on all vectors. Try again.",
        "Dead frequency. No matches found.",
      ]);
    }

    if (positionsCorrect === 0 && numbersCorrect > 0) {
      if (numRatio >= 0.7) {
        return pick([
          `${numbersCorrect} digits confirmed, but all displaced. Rearrange.`,
          "Right numbers. Wrong slots. Shuffle the sequence.",
          "The digits are there. The order isn't. Restructure.",
        ]);
      }
      return pick([
        `${numbersCorrect} signal${numbersCorrect > 1 ? "s" : ""} detected. Positions unknown.`,
        `Partial frequency match. ${numbersCorrect} digit${numbersCorrect > 1 ? "s" : ""} found.`,
        "Fragments detected. Keep probing.",
      ]);
    }

    if (ratio >= 0.75 && ratio < 1) {
      return pick([
        "Almost there. The cipher is cracking.",
        "Critical proximity. One final push.",
        `${positionsCorrect} positions locked. Nearly breached.`,
        "So close. The firewall is failing.",
      ]);
    }

    if (ratio >= 0.5) {
      return pick([
        `${positionsCorrect} positions locked. Halfway through the firewall.`,
        "Significant penetration. Continue this vector.",
        "The pattern is emerging. Press forward.",
        `Half the cipher decoded. ${digitLength - positionsCorrect} remain.`,
      ]);
    }

    if (positionsCorrect > 0) {
      return pick([
        `${positionsCorrect} position${positionsCorrect > 1 ? "s" : ""} confirmed. Keep probing.`,
        "Partial lock achieved. Refine your approach.",
        `Foothold established. ${positionsCorrect} in position.`,
      ]);
    }

    return pick([
      "Partial signal. Adjust and retry.",
      "Trace detected. Continue analysis.",
    ]);
  },

  opponentGuessReaction(numbersCorrect, positionsCorrect, digitLength) {
    const ratio = positionsCorrect / digitLength;

    if (positionsCorrect === 0 && numbersCorrect === 0) {
      return pick([
        "Opponent missed completely. Your cipher holds.",
        "Their probe failed. Zero contact.",
        "Clean deflection. Nothing leaked.",
      ]);
    }

    if (ratio >= 0.75) {
      return pick([
        "Warning. Opponent approaching critical breach.",
        "Alert. Your cipher is nearly compromised.",
        "Hostile operative closing in. Danger level critical.",
      ]);
    }

    if (ratio >= 0.5) {
      return pick([
        "Caution. Opponent has partial access.",
        "They're making progress against your defenses.",
        "Halfway penetration detected on your cipher.",
      ]);
    }

    if (positionsCorrect > 0 || numbersCorrect > 0) {
      return pick([
        "Minor probe against your cipher.",
        "They found fragments. Stay vigilant.",
      ]);
    }

    return null;
  },

  timerWarning(secondsLeft) {
    if (secondsLeft === 5) return pick(["Five seconds.", "Clock's running out."]);
    if (secondsLeft === 3) return pick(["Three seconds.", "Hurry."]);
    if (secondsLeft === 1) return "One.";
    return null;
  },

  turnSkippedYou: [
    "Time expired. Turn forfeited.",
    "Timeout. Opportunity lost.",
    "Clock ran out. Control transferred.",
  ],

  turnSkippedOpponent: [
    "Opponent timed out. Your window is open.",
    "Enemy hesitated. Seize the advantage.",
    "Their clock expired. Move now.",
  ],

  win(attempts) {
    if (attempts <= 2) {
      return pick([
        "Exceptional. Cipher cracked in record time.",
        "Masterful breach. Nearly instant decryption.",
        "Impressive. Surgical precision on the cipher.",
      ]);
    }
    if (attempts <= 5) {
      return pick([
        "Access granted. Code cracked. Well played, operative.",
        "Breach successful. Clean operation.",
        "Cipher broken. Target system compromised.",
      ]);
    }
    return pick([
      "Access granted. The code is yours.",
      "Persistence pays. Breach complete.",
      "System compromised. Mission accomplished.",
    ]);
  },

  lose: [
    "Access denied. Your cipher has been compromised.",
    "Breach detected. Opponent cracked your defenses.",
    "System failure. Your code has fallen.",
    "Security breach. The enemy broke through.",
  ],

  rematchRequested: [
    "Rematch signal transmitted.",
    "Requesting re-engagement.",
  ],

  opponentLeft: [
    "Connection severed. Operative has disconnected.",
    "Signal lost. Agent has left the channel.",
  ],

  copyCode: [
    "Access code copied to clipboard.",
  ],

  errorGeneric: [
    "Invalid input. Recalibrate.",
    "Error detected. Correct and retry.",
  ],
};

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
  speakLine(pick(VOICE_LINES.roomCreated), { delay: 300 });
});

$("#btn-copy").addEventListener("click", () => {
  const code = $("#display-code").textContent;
  navigator.clipboard.writeText(code).then(
    () => { showToast("Code copied to clipboard.", "success"); speakLine(pick(VOICE_LINES.copyCode)); },
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
  speakLine(pick(VOICE_LINES.opponentJoined), { delay: 200, priority: true });
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
  speakLine(pick(VOICE_LINES.secretLocked), { delay: 200 });
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

  updateTurn(isYourTurn);
  showScreen("game");
  loadNotes();

  sfxBreachWarp();
  await playBreachAnimation();

  if (isYourTurn) $("#input-guess").focus();
  sfxTurn();
  speakLine(pick(VOICE_LINES.gameStart), { delay: 400, priority: true });
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

  if (isYourTurn) {
    sfxTurn();
    const lastOpponentGuess = opponentGuesses[opponentGuesses.length - 1];
    if (lastOpponentGuess) {
      const reaction = VOICE_LINES.opponentGuessReaction(
        lastOpponentGuess.numbersCorrect,
        lastOpponentGuess.positionsCorrect,
        currentDigitLength
      );
      if (reaction) {
        speakLine(reaction, { delay: 600 });
      } else {
        speakLine(pick(VOICE_LINES.yourTurn), { delay: 600 });
      }
    } else {
      speakLine(pick(VOICE_LINES.yourTurn), { delay: 400 });
    }
  } else {
    const lastYourGuess = yourGuesses[yourGuesses.length - 1];
    if (lastYourGuess) {
      const line = VOICE_LINES.guessResult(
        lastYourGuess.numbersCorrect,
        lastYourGuess.positionsCorrect,
        currentDigitLength,
        yourGuesses.length
      );
      speakLine(line, { delay: 300 });
    }
  }
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
    const timerLine = VOICE_LINES.timerWarning(clamped);
    if (timerLine) speakLine(timerLine, { rate: 1.0, pitch: 0.2, priority: true });
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
    speakLine(pick(VOICE_LINES.turnSkippedYou), { delay: 200, priority: true });
  } else {
    showToast("Opponent ran out of time!");
    sfxTurn();
    speakLine(pick(VOICE_LINES.turnSkippedOpponent), { delay: 200, priority: true });
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
    speakLine(VOICE_LINES.win(yourGuesses.length), { delay: 800, priority: true });
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
    speakLine(pick(VOICE_LINES.lose), { delay: 800, priority: true });
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
  speakLine(pick(VOICE_LINES.rematchRequested), { delay: 200 });
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
  speakLine(pick(VOICE_LINES.opponentLeft), { delay: 300, priority: true });
});

// ── Errors ──────────────────────────────────────────────────────────────────

socket.on("error-msg", (msg) => {
  showToast(msg);
  sfxError();
  speakLine(pick(VOICE_LINES.errorGeneric), { delay: 200 });
});

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
