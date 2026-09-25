"use strict";

/* =========================================================
   Config
   ========================================================= */

// Logical playfield size. The canvas is scaled to fit the screen,
// but all game math happens in these units.
const W = 960;
const H = 600;

const PADDLE = { w: 14, h: 104, margin: 32, speed: 560 };
const BALL = {
  r: 8,
  startSpeed: 440,
  speedUp: 1.055, // multiplier on every paddle hit
  maxSpeed: 1150,
  maxAngle: Math.PI * 0.3, // steepest bounce when hitting the paddle edge
};

const STEP = 1 / 120; // fixed physics timestep (frame-rate independent)
const COUNTDOWN_TICK = 0.7; // seconds per countdown number
const SERVE_DELAY = 1.0; // pause before serving after a point
const END_DELAY = 0.9; // pause before showing the game-over screen

const AI_LEVELS = {
  easy: { speed: 0.55, reaction: 0.28, error: 78, deadzone: 10 },
  normal: { speed: 0.78, reaction: 0.14, error: 50, deadzone: 6 },
  hard: { speed: 1.0, reaction: 0.06, error: 30, deadzone: 4 },
  demo: { speed: 0.9, reaction: 0.1, error: 44, deadzone: 6 },
};

const COLORS = {
  p1: "#22d3ee",
  p2: "#f43f7f",
  ball: "#ffffff",
  court: "#080b1f",
  line: "rgba(150, 170, 255, 0.16)",
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isTouch = window.matchMedia("(hover: none)").matches;

/* =========================================================
   Helpers
   ========================================================= */

const $ = (id) => document.getElementById(id);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const rand = (min, max) => min + Math.random() * (max - min);

const storage = {
  key: "neon-pong-settings",
  load() {
    try {
      return JSON.parse(localStorage.getItem(this.key)) || {};
    } catch {
      return {};
    }
  },
  save(data) {
    try {
      localStorage.setItem(this.key, JSON.stringify(data));
    } catch {
      /* storage unavailable (private mode etc.) — settings just won't persist */
    }
  },
};

/* =========================================================
   Sound — synthesized with the Web Audio API, no files needed
   ========================================================= */

const sound = (() => {
  let ac = null;
  let master = null;
  let muted = false;

  function unlock() {
    if (!ac) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      ac = new AudioCtx();
      master = ac.createGain();
      master.gain.value = 0.3;
      master.connect(ac.destination);
    }
    if (ac.state === "suspended") ac.resume();
  }

  function tone(freq, duration, { type = "square", volume = 0.5, slide = 0, delay = 0 } = {}) {
    if (muted || !ac || game.demo) return;
    const t = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  return {
    unlock,
    get muted() {
      return muted;
    },
    set muted(value) {
      muted = value;
    },
    paddle: (intensity) => tone(400 + intensity * 400, 0.08, { volume: 0.5 }),
    wall: () => tone(230, 0.06, { type: "triangle", volume: 0.4 }),
    score: () => tone(520, 0.4, { type: "sawtooth", slide: -400, volume: 0.35 }),
    tick: () => tone(660, 0.09, { volume: 0.35 }),
    go: () => tone(990, 0.25, { volume: 0.4 }),
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, { delay: i * 0.12, volume: 0.35 })),
    lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.28, { type: "triangle", delay: i * 0.14, volume: 0.45 })),
  };
})();

/* =========================================================
   DOM
   ========================================================= */

const canvas = $("canvas");
const ctx = canvas.getContext("2d");
const app = $("app");
const court = $("court");

const ui = {
  nameOne: $("nameOne"),
  nameTwo: $("nameTwo"),
  scoreOne: $("scoreOne"),
  scoreTwo: $("scoreTwo"),
  targetLabel: $("targetLabel"),
  controlsHint: $("controlsHint"),
  soundBtn: $("soundBtn"),
  overlays: { menu: $("menu"), paused: $("pause"), over: $("gameover") },
  form: $("setupForm"),
  inputOne: $("inputOne"),
  inputTwo: $("inputTwo"),
  difficultyField: $("difficultyField"),
};

/* =========================================================
   Game state
   ========================================================= */

const settings = {
  mode: "cpu", // "cpu" | "pvp"
  difficulty: "normal",
  target: 7,
  nameOne: "",
  nameTwo: "",
  muted: false,
  ...storage.load(),
};

function makePaddle(x, color) {
  return { x, y: (H - PADDLE.h) / 2, vy: 0, color, flash: 0, touchY: null, ai: { timer: 0, target: H / 2, error: 0 } };
}

const game = {
  screen: "menu", // menu | game | paused | over
  phase: "serve", // countdown | serve | playing | ending
  demo: true, // CPU vs CPU attract mode behind the menu
  timer: 0,
  goTimer: 0,
  serveDir: 1,
  scores: [0, 0],
  p1: makePaddle(PADDLE.margin, COLORS.p1),
  p2: makePaddle(W - PADDLE.margin - PADDLE.w, COLORS.p2),
  ball: { x: W / 2, y: H / 2, vx: 0, vy: 0, speed: BALL.startSpeed, trail: [] },
  lastHitter: 0,
  rally: 0,
  winner: 0,
  resumeVelocity: null, // ball velocity saved while the post-pause countdown runs
  stats: null,
  particles: [],
  shake: 0,
  goalFlash: { side: 0, t: 0 },
};

const keys = {};

function resetStats() {
  game.stats = { longestRally: 0, hits: 0, topSpeed: BALL.startSpeed, time: 0 };
}

/* =========================================================
   Match flow
   ========================================================= */

function playerName(side) {
  if (side === 1) return settings.nameOne || "Player 1";
  if (settings.mode === "cpu") return "CPU";
  return settings.nameTwo || "Player 2";
}

function resetPaddles() {
  for (const p of [game.p1, game.p2]) {
    p.y = (H - PADDLE.h) / 2;
    p.vy = 0;
    p.flash = 0;
    p.touchY = null;
  }
}

function placeBall() {
  const b = game.ball;
  b.x = W / 2;
  b.y = H / 2 + rand(-60, 60);
  b.vx = 0;
  b.vy = 0;
  b.speed = BALL.startSpeed;
  b.trail.length = 0;
  game.lastHitter = 0;
  game.rally = 0;
  game.resumeVelocity = null;
}

function launchBall() {
  const b = game.ball;
  const angle = rand(-0.4, 0.4);
  b.vx = Math.cos(angle) * b.speed * game.serveDir;
  b.vy = Math.sin(angle) * b.speed;
  game.phase = "playing";
  resampleAiError();
}

function startDemo() {
  game.demo = true;
  game.scores = [0, 0];
  resetPaddles();
  placeBall();
  game.serveDir = Math.random() < 0.5 ? 1 : -1;
  game.phase = "serve";
  game.timer = SERVE_DELAY;
}

function startMatch() {
  game.demo = false;
  game.scores = [0, 0];
  game.particles.length = 0;
  resetStats();
  resetPaddles();
  placeBall();
  game.serveDir = Math.random() < 0.5 ? 1 : -1;
  startCountdown();
  updateScoreboard();
  showScreen("game");
}

function startCountdown() {
  game.phase = "countdown";
  game.timer = COUNTDOWN_TICK * 3;
  sound.tick();
}

function scorePoint(side) {
  const b = game.ball;
  const color = side === 1 ? COLORS.p1 : COLORS.p2;

  burst(side === 1 ? W : 0, clamp(b.y, 0, H), color, 46, 520, side === 1 ? -1 : 1);
  game.goalFlash = { side, t: 1 };
  if (!reducedMotion) game.shake = 14;

  if (game.demo) {
    placeBall();
    game.serveDir = side === 1 ? 1 : -1;
    game.phase = "serve";
    game.timer = SERVE_DELAY;
    return;
  }

  game.scores[side - 1]++;
  sound.score();
  updateScoreboard(side);

  if (game.scores[side - 1] >= settings.target) {
    game.phase = "ending";
    game.timer = END_DELAY;
    game.winner = side;
    b.vx = b.vy = 0;
    b.x = -100; // keep it off screen until the next match
    return;
  }

  // Serve toward the player who just conceded.
  game.serveDir = side === 1 ? 1 : -1;
  placeBall();
  game.phase = "serve";
  game.timer = SERVE_DELAY;
}

function endMatch() {
  const side = game.winner;
  const loserScore = game.scores[side === 1 ? 1 : 0];
  const title = $("winnerTitle");
  title.textContent = `${playerName(side)} wins`;
  title.className = `panel-title winner p${side}`;
  $("finalScore").textContent = side === 1
    ? `${game.scores[0]} – ${loserScore}`
    : `${loserScore} – ${game.scores[1]}`;

  const s = game.stats;
  $("statRally").textContent = s.longestRally;
  $("statHits").textContent = s.hits;
  $("statSpeed").textContent = `${(s.topSpeed / BALL.startSpeed).toFixed(1)}×`;
  const secs = Math.round(s.time);
  $("statTime").textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  if (settings.mode === "cpu" && side === 2) sound.lose();
  else sound.win();

  if (!reducedMotion) {
    for (let i = 0; i < 4; i++) {
      burst(rand(W * 0.2, W * 0.8), rand(H * 0.2, H * 0.8), side === 1 ? COLORS.p1 : COLORS.p2, 40, 420);
    }
  }
  showScreen("over");
}

function pause() {
  if (game.screen !== "game") return;
  showScreen("paused");
}

function resume() {
  if (game.screen !== "paused") return;
  showScreen("game");
  // Give players a moment to get ready if the ball was in motion.
  if (game.phase === "playing") {
    game.resumeVelocity = { vx: game.ball.vx, vy: game.ball.vy };
    startCountdown();
  }
}

function goToMenu() {
  startDemo();
  showScreen("menu");
}

/* =========================================================
   Physics
   ========================================================= */

function update(dt) {
  controlPaddle(game.p1, 1, dt);
  controlPaddle(game.p2, 2, dt);

  switch (game.phase) {
    case "countdown": {
      const before = Math.ceil(game.timer / COUNTDOWN_TICK);
      game.timer -= dt;
      const after = Math.ceil(game.timer / COUNTDOWN_TICK);
      if (game.timer <= 0) {
        sound.go();
        game.goTimer = 0.5;
        if (game.resumeVelocity) {
          Object.assign(game.ball, game.resumeVelocity);
          game.resumeVelocity = null;
          game.phase = "playing";
        } else {
          launchBall();
        }
      } else if (after !== before) {
        sound.tick();
      }
      break;
    }
    case "serve":
      game.timer -= dt;
      if (game.timer <= 0) launchBall();
      break;
    case "playing":
      stepBall(dt);
      if (!game.demo) game.stats.time += dt;
      break;
    case "ending":
      game.timer -= dt;
      if (game.timer <= 0) {
        game.phase = "over";
        endMatch();
      }
      break;
  }

  updateEffects(dt);
}

function controlPaddle(p, side, dt) {
  const cpuControlled = game.demo || (side === 2 && settings.mode === "cpu");
  let vy = 0;

  if (cpuControlled) {
    vy = aiVelocity(p, side, dt);
  } else {
    const soloMode = settings.mode === "cpu";
    const up = side === 1 ? keys.KeyW || (soloMode && keys.ArrowUp) : keys.ArrowUp;
    const down = side === 1 ? keys.KeyS || (soloMode && keys.ArrowDown) : keys.ArrowDown;
    const dir = (down ? 1 : 0) - (up ? 1 : 0);

    if (dir !== 0) {
      p.touchY = null;
      vy = dir * PADDLE.speed;
    } else if (p.touchY !== null) {
      const diff = p.touchY - (p.y + PADDLE.h / 2);
      vy = clamp(diff * 16, -PADDLE.speed * 1.6, PADDLE.speed * 1.6);
    }
  }

  const prevY = p.y;
  p.y = clamp(p.y + vy * dt, 0, H - PADDLE.h);
  p.vy = (p.y - prevY) / dt; // actual velocity after hitting the walls
}

// Where will the ball be (vertically) once it reaches x? Accounts for wall bounces.
function predictY(b, x) {
  const t = (x - b.x) / b.vx;
  if (t < 0) return b.y;
  const span = H - 2 * BALL.r;
  const period = span * 2;
  let y = (b.y - BALL.r + b.vy * t) % period;
  if (y < 0) y += period;
  if (y > span) y = period - y;
  return y + BALL.r;
}

function aiVelocity(p, side, dt) {
  const level = AI_LEVELS[game.demo ? "demo" : settings.difficulty];
  const ai = p.ai;
  const b = game.ball;

  ai.timer -= dt;
  if (ai.timer <= 0) {
    ai.timer = level.reaction;
    const incoming = game.phase === "playing" && (side === 1 ? b.vx < 0 : b.vx > 0);
    if (incoming) {
      const faceX = side === 1 ? p.x + PADDLE.w : p.x;
      ai.target = predictY(b, faceX) + ai.error;
    } else {
      // Drift back toward the middle while the ball is going away.
      ai.target = H / 2 + (b.y - H / 2) * 0.3;
    }
  }

  const diff = ai.target - (p.y + PADDLE.h / 2);
  if (Math.abs(diff) < level.deadzone) return 0;
  const max = PADDLE.speed * level.speed;
  return clamp(diff * 10, -max, max);
}

function resampleAiError() {
  for (const p of [game.p1, game.p2]) {
    const level = AI_LEVELS[game.demo ? "demo" : settings.difficulty];
    p.ai.error = rand(-level.error, level.error);
  }
}

function stepBall(dt) {
  const b = game.ball;
  const r = BALL.r;
  const prevX = b.x;

  b.x += b.vx * dt;
  b.y += b.vy * dt;

  b.trail.push({ x: b.x, y: b.y });
  if (b.trail.length > 18) b.trail.shift();

  // Top / bottom walls
  if (b.y - r < 0) {
    b.y = r;
    b.vy = Math.abs(b.vy);
    onWallHit(b.x, 0);
  } else if (b.y + r > H) {
    b.y = H - r;
    b.vy = -Math.abs(b.vy);
    onWallHit(b.x, H);
  }

  // Paddles — only check the one the ball is moving toward
  if (b.vx < 0) checkPaddleHit(game.p1, 1, prevX);
  else checkPaddleHit(game.p2, -1, prevX);

  // Goals — let the ball fully leave the court first
  if (b.x < -r * 3) scorePoint(2);
  else if (b.x > W + r * 3) scorePoint(1);
}

function checkPaddleHit(p, dir, prevX) {
  const b = game.ball;
  const r = BALL.r;
  const face = dir === 1 ? p.x + PADDLE.w : p.x;
  const prevEdge = prevX - dir * r;
  const edge = b.x - dir * r;

  // Did the ball's leading edge cross the paddle face during this step?
  const crossed = dir === 1 ? prevEdge >= face && edge <= face : prevEdge <= face && edge >= face;
  if (!crossed) return;
  if (b.y + r < p.y || b.y - r > p.y + PADDLE.h) return;

  // The further from the center it hits, the steeper the bounce.
  const offset = clamp((b.y - (p.y + PADDLE.h / 2)) / (PADDLE.h / 2 + r), -1, 1);
  const angle = offset * BALL.maxAngle;
  b.speed = Math.min(b.speed * BALL.speedUp, BALL.maxSpeed);
  b.vx = Math.cos(angle) * b.speed * dir;
  // A moving paddle adds a bit of spin.
  b.vy = clamp(Math.sin(angle) * b.speed + p.vy * 0.12, -b.speed * 0.85, b.speed * 0.85);
  b.x = face + dir * r;

  const side = dir === 1 ? 1 : 2;
  game.lastHitter = side;
  game.rally++;
  p.flash = 1;
  resampleAiError();

  const intensity = (b.speed - BALL.startSpeed) / (BALL.maxSpeed - BALL.startSpeed);
  burst(face, b.y, p.color, 14 + Math.round(intensity * 16), 260 + intensity * 260, dir);
  sound.paddle(intensity);
  if (!reducedMotion && intensity > 0.6) game.shake = Math.max(game.shake, 4);

  if (!game.demo) {
    const s = game.stats;
    s.hits++;
    s.longestRally = Math.max(s.longestRally, game.rally);
    s.topSpeed = Math.max(s.topSpeed, b.speed);
  }
}

function onWallHit(x, y) {
  burst(x, y, "#c7d2fe", 6, 160, 0, y === 0 ? 1 : -1);
  sound.wall();
}

/* =========================================================
   Effects
   ========================================================= */

function burst(x, y, color, count, speed, dirX = 0, dirY = 0) {
  if (reducedMotion) count = Math.ceil(count / 3);
  for (let i = 0; i < count; i++) {
    let angle = rand(0, Math.PI * 2);
    // Bias the spray away from the surface that was hit.
    if (dirX) angle = rand(-1.2, 1.2) + (dirX > 0 ? 0 : Math.PI);
    if (dirY) angle = rand(-1.2, 1.2) + (dirY > 0 ? Math.PI / 2 : -Math.PI / 2);
    const v = rand(0.25, 1) * speed;
    const life = rand(0.35, 0.8);
    game.particles.push({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v, life, max: life, color, size: rand(1.5, 3.5) });
  }
}

function updateEffects(dt) {
  const damping = Math.pow(0.05, dt);
  for (let i = game.particles.length - 1; i >= 0; i--) {
    const pt = game.particles[i];
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vx *= damping;
    pt.vy *= damping;
    pt.life -= dt;
    if (pt.life <= 0) game.particles.splice(i, 1);
  }
  game.p1.flash = Math.max(0, game.p1.flash - dt * 4);
  game.p2.flash = Math.max(0, game.p2.flash - dt * 4);
  game.shake *= Math.pow(0.002, dt);
  if (game.shake < 0.1) game.shake = 0;
  game.goalFlash.t = Math.max(0, game.goalFlash.t - dt * 1.8);
  game.goTimer = Math.max(0, game.goTimer - dt);
}

/* =========================================================
   Rendering
   ========================================================= */

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function render() {
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);

  // Background
  ctx.fillStyle = COLORS.court;
  ctx.fillRect(0, 0, W, H);

  const sideGlow = (x0, x1, color) => {
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, color);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), H);
  };
  sideGlow(0, 220, "rgba(34, 211, 238, 0.07)");
  sideGlow(W, W - 220, "rgba(244, 63, 127, 0.07)");

  // Goal flash when someone scores
  if (game.goalFlash.t > 0) {
    const { side, t } = game.goalFlash;
    const rgb = side === 1 ? "34, 211, 238" : "244, 63, 127";
    if (side === 1) sideGlow(W, W - 360, `rgba(${rgb}, ${0.45 * t})`);
    else sideGlow(0, 360, `rgba(${rgb}, ${0.45 * t})`);
  }

  ctx.save();
  if (game.shake) ctx.translate(rand(-game.shake, game.shake), rand(-game.shake, game.shake));

  drawCourtLines();
  drawPaddle(game.p1);
  drawPaddle(game.p2);
  drawBall();
  drawParticles();

  ctx.restore();

  drawCountdown();
}

function drawCourtLines() {
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 14]);
  ctx.beginPath();
  ctx.moveTo(W / 2, 10);
  ctx.lineTo(W / 2, H);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 70, 0, Math.PI * 2);
  ctx.stroke();
}

function drawPaddle(p) {
  const grow = p.flash * 4;
  ctx.save();
  ctx.shadowColor = p.color;
  ctx.shadowBlur = 24 + p.flash * 30;
  ctx.fillStyle = p.color;
  roundRect(p.x - grow / 2, p.y - grow, PADDLE.w + grow, PADDLE.h + grow * 2, 7);
  ctx.fill();
  if (p.flash > 0) {
    ctx.globalAlpha = p.flash;
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }
  ctx.restore();
}

function drawBall() {
  const b = game.ball;
  if (game.phase === "ending" || game.phase === "over") return;

  // Blink while waiting to serve
  if (game.phase === "serve" && Math.floor(game.timer * 6) % 2 === 1) return;

  const tint = game.lastHitter === 1 ? COLORS.p1 : game.lastHitter === 2 ? COLORS.p2 : COLORS.ball;

  // Motion trail
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = tint;
  const n = b.trail.length;
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / n;
    ctx.globalAlpha = t * 0.35;
    ctx.beginPath();
    ctx.arc(b.trail[i].x, b.trail[i].y, BALL.r * t, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.shadowColor = tint;
  ctx.shadowBlur = 26;
  ctx.fillStyle = COLORS.ball;
  ctx.beginPath();
  ctx.arc(b.x, b.y, BALL.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const pt of game.particles) {
    ctx.globalAlpha = pt.life / pt.max;
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
  }
  ctx.restore();
}

function drawCountdown() {
  let text = null;
  let progress = 0;
  if (game.phase === "countdown" && game.screen === "game") {
    const n = Math.ceil(game.timer / COUNTDOWN_TICK);
    text = String(n);
    progress = 1 - (game.timer % COUNTDOWN_TICK) / COUNTDOWN_TICK;
  } else if (game.goTimer > 0 && !game.demo) {
    text = "GO!";
    progress = 1 - game.goTimer / 0.5;
  }
  if (!text) return;

  const scale = 1 + progress * 0.35;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(scale, scale);
  ctx.globalAlpha = 1 - progress * 0.8;
  ctx.font = '64px "Press Start 2P", monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = 30;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, 0, 4);
  ctx.restore();
}

/* =========================================================
   UI
   ========================================================= */

function showScreen(name) {
  game.screen = name;
  app.dataset.state = name;
  for (const [key, el] of Object.entries(ui.overlays)) el.hidden = key !== name;

  if (name === "paused") $("resumeBtn").focus();
  else if (name === "over") $("rematchBtn").focus();
  else if (name === "game") document.activeElement?.blur();
}

function updateScoreboard(scorer) {
  ui.nameOne.textContent = playerName(1);
  ui.nameTwo.textContent = playerName(2);
  ui.targetLabel.textContent = settings.target;
  ui.scoreOne.textContent = game.scores[0];
  ui.scoreTwo.textContent = game.scores[1];

  if (scorer) {
    const el = scorer === 1 ? ui.scoreOne : ui.scoreTwo;
    el.classList.remove("pop");
    void el.offsetWidth; // restart the animation
    el.classList.add("pop");
  }

  if (isTouch) {
    ui.controlsHint.textContent = settings.mode === "cpu"
      ? "Drag anywhere on the court to move"
      : "Each player drags on their half of the court";
  } else {
    ui.controlsHint.textContent = settings.mode === "cpu"
      ? "W / S or ↑ / ↓ to move · P to pause"
      : "Left: W / S · Right: ↑ / ↓ · P to pause";
  }
}

function setMuted(muted) {
  settings.muted = muted;
  sound.muted = muted;
  ui.soundBtn.classList.toggle("muted", muted);
  ui.soundBtn.setAttribute("aria-pressed", String(muted));
  storage.save(settings);
}

function syncMenu() {
  const form = ui.form;
  form.elements.mode.value = settings.mode;
  form.elements.difficulty.value = settings.difficulty;
  form.elements.target.value = String(settings.target);
  ui.inputOne.value = settings.nameOne;
  ui.inputTwo.value = settings.nameTwo;
  syncModeFields();
}

function syncModeFields() {
  const cpu = ui.form.elements.mode.value === "cpu";
  ui.difficultyField.disabled = !cpu;
  ui.inputTwo.disabled = cpu;
  ui.inputTwo.placeholder = cpu ? "CPU" : "Player 2";
  document.querySelector(".keys-p2").hidden = cpu;
}

ui.form.addEventListener("change", syncModeFields);

ui.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = ui.form.elements;
  settings.mode = f.mode.value;
  settings.difficulty = f.difficulty.value;
  settings.target = Number(f.target.value);
  settings.nameOne = ui.inputOne.value.trim();
  settings.nameTwo = ui.inputTwo.value.trim();
  storage.save(settings);
  sound.unlock();
  startMatch();
});

$("resumeBtn").addEventListener("click", resume);
$("restartBtn").addEventListener("click", startMatch);
$("quitBtn").addEventListener("click", goToMenu);
$("rematchBtn").addEventListener("click", startMatch);
$("menuBtn").addEventListener("click", goToMenu);
$("pauseBtn").addEventListener("click", pause);
ui.soundBtn.addEventListener("click", () => setMuted(!settings.muted));

/* =========================================================
   Input
   ========================================================= */

window.addEventListener("keydown", (e) => {
  sound.unlock();
  if (e.target instanceof HTMLInputElement) return;

  const code = e.code;
  if (["ArrowUp", "ArrowDown", "Space"].includes(code) && game.screen === "game") e.preventDefault();
  keys[code] = true;
  if (e.repeat) return;

  const onButton = e.target instanceof HTMLButtonElement;

  if (code === "KeyM") setMuted(!settings.muted);
  else if (code === "KeyP" || code === "Escape") {
    if (game.screen === "game") pause();
    else if (game.screen === "paused") resume();
    else if (game.screen === "over" && code === "Escape") goToMenu();
  } else if ((code === "Enter" || code === "Space") && !onButton) {
    if (game.screen === "paused") resume();
    else if (game.screen === "over") startMatch();
  }
});

window.addEventListener("keyup", (e) => {
  keys[e.code] = false;
});

function releaseAllInput() {
  for (const code in keys) keys[code] = false;
  game.p1.touchY = null;
  game.p2.touchY = null;
}

window.addEventListener("blur", () => {
  releaseAllInput();
  pause();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    releaseAllInput();
    pause();
  }
});

// Touch / mouse drag: each pointer controls the paddle on its half of the court.
const pointerSide = new Map();

function pointerToCourt(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * W,
    y: ((e.clientY - rect.top) / rect.height) * H,
  };
}

court.addEventListener("pointerdown", (e) => {
  if (game.screen !== "game") return;
  sound.unlock();
  const { x, y } = pointerToCourt(e);
  const side = settings.mode === "cpu" ? 1 : x < W / 2 ? 1 : 2;
  pointerSide.set(e.pointerId, side);
  (side === 1 ? game.p1 : game.p2).touchY = y;
  court.setPointerCapture(e.pointerId);
});

court.addEventListener("pointermove", (e) => {
  const side = pointerSide.get(e.pointerId);
  if (!side) return;
  (side === 1 ? game.p1 : game.p2).touchY = pointerToCourt(e).y;
});

function endPointer(e) {
  const side = pointerSide.get(e.pointerId);
  if (!side) return;
  pointerSide.delete(e.pointerId);
  (side === 1 ? game.p1 : game.p2).touchY = null;
}

court.addEventListener("pointerup", endPointer);
court.addEventListener("pointercancel", endPointer);

/* =========================================================
   Main loop
   ========================================================= */

let lastTime = performance.now();
let accumulator = 0;

function frame(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  const running = game.screen === "game" || game.screen === "menu";
  if (running) {
    accumulator += dt;
    while (accumulator >= STEP) {
      update(STEP);
      accumulator -= STEP;
    }
  } else {
    accumulator = 0;
    if (game.screen === "over") updateEffects(dt); // let the confetti settle
  }

  render();
  requestAnimationFrame(frame);
}

/* =========================================================
   Boot
   ========================================================= */

new ResizeObserver(resizeCanvas).observe(court);
resizeCanvas();
setMuted(Boolean(settings.muted));
syncMenu();
updateScoreboard();
startDemo();
showScreen("menu");
requestAnimationFrame(frame);
