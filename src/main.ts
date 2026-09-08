// STACK — core game logic and render loop
import { stageBox, SHAPE } from "./shape";
import { perfectDrop, runFinished, runStarted } from "./platform";
import { layoutPanel, mountPanel, showSheet } from "./panel";

// ─── canvas setup ────────────────────────────────────────────────────────────
const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

function resize() {
  const box = stageBox(window.innerWidth, window.innerHeight, SHAPE);
  canvas.width = box.width;
  canvas.height = box.height;
  canvas.style.position = "fixed";
  canvas.style.left = box.left + "px";
  canvas.style.top = box.top + "px";
  canvas.style.width = box.width + "px";
  canvas.style.height = box.height + "px";
}
window.addEventListener("resize", () => {
  resize();
  layoutPanel(canvas);
});
resize();

// ─── constants ───────────────────────────────────────────────────────────────
const PERFECT_THRESHOLD = 6;      // px: left-edge offset within this = PERFECT
const BLOCK_H = 28;               // height of each block in world-px
const INITIAL_W = 180;            // starting block width (world-px)
const MIN_W = 14;                 // below this the run ends
const RECOVER_PX = 4;             // width gained on a perfect drop
const BASE_SPEED = 2.8;           // slider speed at height 0 (world-px / frame)
const SPEED_STEP = 0.018;         // extra speed per height level
const MAX_SPEED = 11;
const TOWER_ANCHOR_Y_FRAC = 0.38; // top of the tower sits here (fraction of canvas height)
const FLOOR_BLOCKS = 3;           // pre-seeded solid base blocks
const HUD_H = 72;                 // px reserved for the HUD band

// The slider travels from well off the left of the visible tower to well off
// the right — far enough that a player who taps at the worst moment misses.
const SLIDER_MARGIN = 1.0;        // fraction of INITIAL_W added either side as overshoot

// ─── colour helpers ──────────────────────────────────────────────────────────
function hslForIndex(i: number): string {
  const hue = (i * 9) % 360;
  return `hsl(${hue},80%,62%)`;
}
function flashColor(i: number): string {
  const hue = (i * 9) % 360;
  return `hsl(${hue},95%,82%)`;
}

// ─── types ───────────────────────────────────────────────────────────────────
interface Block {
  x: number;    // left edge, world coords (0 = canvas centre)
  y: number;    // bottom edge, world coords (y increases upward)
  w: number;
  index: number;
}

interface Debris {
  x: number; y: number;
  w: number; h: number;
  vx: number; vy: number;
  angle: number; spin: number;
  color: string;
  life: number; // 1 → 0
}

// ─── game state ──────────────────────────────────────────────────────────────
type Phase = "idle" | "playing" | "over";

let phase: Phase = "idle";
let tower: Block[] = [];
let debris: Debris[] = [];

// Slider lives in world coords: x = left edge, same coord space as blocks.
let sliderX = 0;
let sliderDir = 1;          // 1 = moving right, -1 = moving left
let sliderW = INITIAL_W;
let sliderLeftLimit = 0;    // recomputed each drop
let sliderRightLimit = 0;

let height = 0;             // blocks successfully placed
let perfects = 0;
let combo = 0;
let cameraY = 0;            // world-y shown at the top of the play area
let targetCameraY = 0;
let speed = BASE_SPEED;
let flashTimer = 0;
let sessionStarted = false;

const BEST_KEY = "stack_best_v2";
let bestHeight = parseInt(localStorage.getItem(BEST_KEY) ?? "0", 10);

// Stored so tap handler can hit the retry button

// ─── helpers ─────────────────────────────────────────────────────────────────
function topBlock(): Block {
  return tower[tower.length - 1];
}

/** World-y that places the top of the slider row at TOWER_ANCHOR_Y_FRAC. */
function desiredCameraY(): number {
  // Slider sits one block above the tower top.
  // "top of slider" in world = (tower.length + 1) * BLOCK_H
  // We want toScreen of that = TOWER_ANCHOR_Y_FRAC * canvas.height
  // toScreen(wy) = TOWER_ANCHOR_Y_FRAC * H + (cameraY - wy)
  // => cameraY = (slider top world y)
  return (tower.length + 1) * BLOCK_H;
}

/** Compute slider travel limits so it goes safely past the top block edges. */
function computeSliderLimits() {
  const top = topBlock();
  const overshoot = INITIAL_W * SLIDER_MARGIN + sliderW;
  sliderLeftLimit = top.x - overshoot;
  sliderRightLimit = top.x + top.w + overshoot - sliderW;
}

function ws(wy: number): number {
  return TOWER_ANCHOR_Y_FRAC * canvas.height + (cameraY - wy);
}

/** Left screen-x for a world block. */
function bsx(wx: number): number {
  return canvas.width / 2 + wx;
}

// ─── init ─────────────────────────────────────────────────────────────────────
function initGame() {
  tower = [];
  debris = [];
  height = 0;
  perfects = 0;
  combo = 0;
  speed = BASE_SPEED;
  flashTimer = 0;
  sessionStarted = false;
  sliderW = INITIAL_W;

  // Solid base
  for (let i = 0; i < FLOOR_BLOCKS; i++) {
    tower.push({ x: -INITIAL_W / 2, y: i * BLOCK_H, w: INITIAL_W, index: i });
  }

  computeSliderLimits();
  sliderX = (sliderLeftLimit + sliderRightLimit) / 2;
  sliderDir = 1;
  cameraY = desiredCameraY();
  targetCameraY = cameraY;
  phase = "idle";
}

// ─── drop ─────────────────────────────────────────────────────────────────────
function drop() {
  if (phase === "over") return;

  if (!sessionStarted) {
    void runStarted();
    sessionStarted = true;
  }
  // The starting tap only starts the run. update() freezes the slider while
  // the phase is "idle", so dropping in the same call released the block from
  // wherever it was parked — off the end of the tower — and every first tap
  // ended the run at height 0.
  if (phase === "idle") {
    phase = "playing";
    return;
  }

  const top = topBlock();

  // Compute overlap in world coords
  const ol = Math.max(sliderX, top.x);
  const or_ = Math.min(sliderX + sliderW, top.x + top.w);
  const ow = or_ - ol;

  if (ow <= 0) {
    // Complete miss
    endRun();
    return;
  }

  // Perfect: left edge within threshold AND the slider is at least as wide as the top block
  // (prevents a very narrow slider from counting as perfect when it happens to align)
  const leftDiff = Math.abs(sliderX - top.x);
  const perfect = leftDiff <= PERFECT_THRESHOLD && sliderW >= top.w;

  let newX: number;
  let newW: number;

  if (perfect) {
    newX = top.x;
    newW = Math.min(INITIAL_W, top.w + RECOVER_PX);
    combo++;
    perfects++;
    flashTimer = 20;
    void perfectDrop(combo);
  } else {
    newX = ol;
    newW = ow;
    combo = 0;

    // Spawn debris for each sliced-off side
    const worldBlockY = tower.length * BLOCK_H; // bottom of the new block
    const color = hslForIndex(tower.length);

    const leftSlice = sliderX < top.x ? top.x - sliderX : 0;
    const rightSlice = (sliderX + sliderW) > (top.x + top.w) ? (sliderX + sliderW) - (top.x + top.w) : 0;

    if (leftSlice > 0) {
      debris.push({
        x: sliderX, y: worldBlockY,
        w: leftSlice, h: BLOCK_H,
        vx: -2 - Math.random(),
        vy: 1 + Math.random(),
        angle: 0, spin: -(0.04 + Math.random() * 0.08),
        color, life: 1,
      });
    }
    if (rightSlice > 0) {
      debris.push({
        x: top.x + top.w, y: worldBlockY,
        w: rightSlice, h: BLOCK_H,
        vx: 2 + Math.random(),
        vy: 1 + Math.random(),
        angle: 0, spin: 0.04 + Math.random() * 0.08,
        color, life: 1,
      });
    }
  }

  // Tower-too-thin check after slicing
  if (newW < MIN_W) {
    endRun();
    return;
  }

  height++;
  tower.push({ x: newX, y: tower.length * BLOCK_H, w: newW, index: tower.length });

  speed = Math.min(MAX_SPEED, BASE_SPEED + height * SPEED_STEP);

  // Prep next slider
  sliderW = newW;
  computeSliderLimits();
  // Start from the opposite side to keep the player guessing
  if (sliderDir > 0) {
    sliderX = sliderRightLimit;
    sliderDir = -1;
  } else {
    sliderX = sliderLeftLimit;
    sliderDir = 1;
  }

  targetCameraY = desiredCameraY();
}

function endRun() {
  phase = "over";
  if (height > bestHeight) {
    bestHeight = height;
    localStorage.setItem(BEST_KEY, String(bestHeight));
  }
  void runFinished(height, perfects);
  // The sheet reads the platform, so it opens with the game-over screen and
  // fills in as the calls land rather than waiting for all of them.
  showSheet(true, resumeFromFall);
}

/**
 * Carry on from where the tower fell, having paid for it.
 *
 * The tower, the height and the perfect count all stand — only the run's end
 * is undone. Re-announcing session.started would tell the rules a second run
 * began, so it does not: the paid continue is the same run continuing, and the
 * finished-run payout happens once, when it finally ends.
 */
function resumeFromFall() {
  showSheet(false, null);
  sliderW = Math.max(topBlock().w, MIN_W);
  computeSliderLimits();
  sliderX = (sliderLeftLimit + sliderRightLimit) / 2;
  sliderDir = 1;
  combo = 0;
  targetCameraY = desiredCameraY();
  phase = "playing";
}

// ─── update ───────────────────────────────────────────────────────────────────
function update() {
  // Smooth camera scroll
  cameraY += (targetCameraY - cameraY) * 0.1;

  if (phase !== "playing") return;

  sliderX += sliderDir * speed;

  if (sliderX >= sliderRightLimit) {
    sliderX = sliderRightLimit;
    sliderDir = -1;
  } else if (sliderX <= sliderLeftLimit) {
    sliderX = sliderLeftLimit;
    sliderDir = 1;
  }

  if (flashTimer > 0) flashTimer--;

  // Debris physics (world coords — y goes up, gravity pulls down = negative vy)
  for (const d of debris) {
    d.x += d.vx;
    d.y += d.vy;
    d.vy -= 0.35;
    d.angle += d.spin;
    d.life -= 0.022;
  }
  debris = debris.filter(d => d.life > 0);
}

// ─── draw ─────────────────────────────────────────────────────────────────────
function draw() {
  const W = canvas.width;
  const H = canvas.height;

  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0f0c29");
  bg.addColorStop(1, "#24243e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // ── tower blocks ──
  for (const b of tower) {
    // block screen top = ws(b.y + BLOCK_H)   (bottom of next block = top of this block in screen)
    const sy = ws(b.y + BLOCK_H);
    if (sy > H + BLOCK_H * 2 || sy + BLOCK_H < HUD_H) continue;

    const sx = bsx(b.x);
    const isTopBlock = b.index === tower.length - 1;

    ctx.save();
    if (isTopBlock && flashTimer > 0) {
      ctx.fillStyle = flashColor(b.index);
      ctx.shadowColor = flashColor(b.index);
      ctx.shadowBlur = 20;
    } else {
      ctx.fillStyle = hslForIndex(b.index);
    }
    ctx.fillRect(sx, sy, b.w, BLOCK_H - 2);

    // Top-face highlight
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(sx, sy, b.w, 5);

    // Left-face shade
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(sx, sy + 5, 4, BLOCK_H - 7);

    ctx.restore();
  }

  // ── active slider ──
  if (phase !== "over") {
    const sliderWorldBottom = tower.length * BLOCK_H;
    const sy = ws(sliderWorldBottom + BLOCK_H);
    if (sy < H + BLOCK_H && sy > HUD_H - BLOCK_H) {
      const sx = bsx(sliderX);
      ctx.save();
      ctx.fillStyle = hslForIndex(tower.length);
      ctx.shadowColor = hslForIndex(tower.length);
      ctx.shadowBlur = 12;
      ctx.fillRect(sx, sy, sliderW, BLOCK_H - 2);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(sx, sy, sliderW, 5);
      ctx.restore();
    }
  }

  // ── debris ──
  for (const d of debris) {
    const sy = ws(d.y + d.h);
    const sx = bsx(d.x + d.w / 2);
    ctx.save();
    ctx.globalAlpha = Math.max(0, d.life * d.life); // fade out fast at end
    ctx.translate(sx, sy + d.h / 2);
    ctx.rotate(d.angle);
    ctx.fillStyle = d.color;
    ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
    ctx.restore();
  }

  // ── HUD ──
  drawHUD(W);

  // ── overlays ──
  if (phase === "over") {
    drawGameOver(W, H);
  } else if (phase === "idle") {
    drawIdleHint(W, H);
  }
}

function drawHUD(W: number) {
  ctx.save();
  ctx.fillStyle = "rgba(10,8,30,0.82)";
  ctx.fillRect(0, 0, W, HUD_H);

  const labelSz = Math.round(W * 0.031);
  const valueSz = Math.round(W * 0.07);
  const xs = [W * 0.2, W * 0.5, W * 0.8];
  const labels = ["HEIGHT", "BEST", "COMBO"];
  const values = [
    String(height),
    String(bestHeight),
    combo > 0 ? `×${combo}` : "–",
  ];

  for (let i = 0; i < 3; i++) {
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.42)";
    ctx.font = `${labelSz}px system-ui,sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(labels[i], xs[i], 10);

    ctx.fillStyle = (i === 2 && combo > 0) ? flashColor(height + 5) : "#e0f7fa";
    ctx.font = `bold ${valueSz}px system-ui,sans-serif`;
    ctx.fillText(values[i], xs[i], 10 + labelSz + 3);
  }
  ctx.restore();
}

function drawIdleHint(W: number, H: number) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = `bold ${Math.round(W * 0.056)}px system-ui,sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("TAP TO START", W / 2, H * 0.75);
  ctx.restore();
}

function drawGameOver(W: number, H: number) {
  ctx.save();
  ctx.fillStyle = "rgba(10,8,30,0.9)";
  ctx.fillRect(0, 0, W, H);

  const midY = H * 0.42;

  // Title
  ctx.fillStyle = "#b2ebf2";
  ctx.font = `bold ${Math.round(W * 0.11)}px system-ui,sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("STACK", W / 2, H * 0.2);

  // Score
  ctx.fillStyle = "#e0f7fa";
  ctx.font = `bold ${Math.round(W * 0.2)}px system-ui,sans-serif`;
  ctx.fillText(String(height), W / 2, midY);

  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = `${Math.round(W * 0.042)}px system-ui,sans-serif`;
  ctx.fillText("BLOCKS HIGH", W / 2, midY + Math.round(W * 0.12));

  // Perfects
  ctx.fillStyle = flashColor(height + 10);
  ctx.font = `bold ${Math.round(W * 0.068)}px system-ui,sans-serif`;
  ctx.fillText(
    `${perfects} PERFECT${perfects !== 1 ? "S" : ""}`,
    W / 2, midY + Math.round(W * 0.22),
  );

  // New best banner
  if (height > 0 && height >= bestHeight) {
    ctx.fillStyle = "#ffe082";
    ctx.font = `bold ${Math.round(W * 0.048)}px system-ui,sans-serif`;
    ctx.fillText("✦ NEW BEST ✦", W / 2, midY + Math.round(W * 0.34));
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.font = `${Math.round(W * 0.036)}px system-ui,sans-serif`;
    ctx.fillText(`best  ${bestHeight}`, W / 2, midY + Math.round(W * 0.34));
  }

  // Retry button
  const btnW = W * 0.58;
  const btnH = H * 0.072;
  const btnX = (W - btnW) / 2;
  const btnY = H * 0.79;

  ctx.fillStyle = "#b2ebf2";
  ctx.beginPath();
  ctx.roundRect(btnX, btnY, btnW, btnH, btnH / 2);
  ctx.fill();

  ctx.fillStyle = "#0f0c29";
  ctx.font = `bold ${Math.round(W * 0.054)}px system-ui,sans-serif`;
  ctx.fillText("RETRY", W / 2, btnY + btnH / 2);

  ctx.restore();
}

// ─── input ────────────────────────────────────────────────────────────────────
function handleTap() {
  if (phase === "over") {
    // Any tap restarts; retry button is just visual affordance. The sheet has
    // its own button and swallows its own clicks, so a tap that reaches the
    // canvas is a tap on the game.
    showSheet(false, null);
    initGame();
    return;
  }
  drop();
}

// Anywhere on the canvas. The pointer's position was scaled into canvas
// pixels here to hit-test the retry button, but every tap on the game-over
// screen already restarts, so the position never decided anything.
canvas.addEventListener("pointerdown", () => {
  handleTap();
});

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    handleTap();
  }
});

// ─── loop ─────────────────────────────────────────────────────────────────────
let last = 0;
function loop(ts: number) {
  if (last === 0) last = ts;
  last = ts;
  update();
  draw();
  requestAnimationFrame(loop);
}

mountPanel();
layoutPanel(canvas);
initGame();
requestAnimationFrame(loop);
