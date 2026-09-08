/**
 * panel — the platform, on screen.
 *
 * A DOM overlay rather than more canvas drawing: this is a list of numbers and
 * a leaderboard, and hand-plotting text in a 2D context to render a table is
 * how you end up unable to show five rows on a narrow phone.
 *
 * The offline state is the point of this file. The studio's template treated a
 * missing backend as silence, so a build with no key played exactly like a
 * build with a working economy and the player's scores went nowhere. Here it
 * says so, permanently, in the corner.
 */
import { onChange, snapshot, payToContinue, type Snapshot } from "./platform";

const css = `
.mw-badge{position:fixed;z-index:3;display:flex;justify-content:center;
  pointer-events:none;font:500 12px/1.4 system-ui,sans-serif}
.mw-badge span{background:rgba(10,8,30,.82);color:#ffb4a2;border:1px solid rgba(255,180,162,.28);
  border-radius:999px;padding:4px 12px}
.mw-badge.ok span{color:#b2ebf2;border-color:rgba(178,235,242,.24)}
.mw-wallet{position:fixed;z-index:3;pointer-events:none;font:600 13px/1 system-ui,sans-serif;
  color:#ffe082;background:rgba(10,8,30,.82);border-radius:999px;padding:6px 12px}
.mw-sheet{position:fixed;z-index:4;box-sizing:border-box;display:none;flex-direction:column;gap:10px;
  background:rgba(10,8,30,.94);border:1px solid rgba(255,255,255,.09);border-radius:14px;
  padding:14px;color:#e0f7fa;font:400 13px/1.5 system-ui,sans-serif;overflow-y:auto}
.mw-sheet.show{display:flex}
.mw-earn{font:700 15px/1 system-ui,sans-serif;color:#ffe082}
.mw-row{display:flex;justify-content:space-between;gap:12px}
.mw-row .k{color:rgba(255,255,255,.45)}
.mw-h{font:600 11px/1 system-ui,sans-serif;letter-spacing:.09em;text-transform:uppercase;
  color:rgba(255,255,255,.38);margin-top:2px}
.mw-you{color:#ffe082;font-weight:600}
.mw-num{font-variant-numeric:tabular-nums}
.mw-cont{pointer-events:auto;appearance:none;border:0;border-radius:999px;cursor:pointer;
  background:#ffe082;color:#0f0c29;font:700 14px/1 system-ui,sans-serif;padding:11px 16px}
.mw-cont:disabled{background:rgba(255,255,255,.12);color:rgba(255,255,255,.4);cursor:default}
.mw-note{color:rgba(255,255,255,.4);font-size:12px}
`;

let badge: HTMLElement;
let wallet: HTMLElement;
let sheet: HTMLElement;
let onContinue: (() => void) | null = null;

export function mountPanel(): void {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);

  badge = document.createElement("div");
  badge.className = "mw-badge";
  badge.innerHTML = "<span></span>";

  wallet = document.createElement("div");
  wallet.className = "mw-wallet";

  sheet = document.createElement("div");
  sheet.className = "mw-sheet";

  document.body.append(badge, wallet, sheet);
  onChange(render);
  render();
}

/**
 * Where the overlay sits. The canvas is letterboxed to a portrait box that is
 * not the window, so these follow the canvas rather than the viewport — read
 * from the element itself so there is one source of truth for the geometry.
 */
export function layoutPanel(canvas: HTMLCanvasElement): void {
  const r = canvas.getBoundingClientRect();
  // Under the HUD band, not over it: at top:0 the badge covered the HEIGHT,
  // BEST and COMBO labels the band exists to show. HUD_H is canvas pixels and
  // the canvas is drawn 1:1, so the band's height on screen is the same number.
  badge.style.left = `${r.left}px`;
  badge.style.width = `${r.width}px`;
  badge.style.top = `${r.top + 78}px`;
  wallet.style.left = `${r.left + 12}px`;
  wallet.style.top = `${r.top + 78}px`;
  sheet.style.left = `${r.left + 12}px`;
  sheet.style.width = `${r.width - 24}px`;
  // The lane between the canvas's game-over block, which now ends around 0.5,
  // and the RETRY button at 0.9. Sized from the canvas rather than the viewport
  // for the same reason as everything else here: the canvas is letterboxed.
  sheet.style.bottom = `${window.innerHeight - r.bottom + r.height * 0.115}px`;
  sheet.style.maxHeight = `${Math.round(r.height * 0.36)}px`;
}

/** Show the platform sheet on the game-over screen, and nowhere else. */
export function showSheet(show: boolean, continueFn: (() => void) | null): void {
  onContinue = continueFn;
  sheet.classList.toggle("show", show);
  render();
}

function num(v: number | null): string {
  return v === null ? "—" : v.toLocaleString();
}

function render(): void {
  const s = snapshot();
  paintBadge(s);
  paintWallet(s);
  if (sheet.classList.contains("show")) paintSheet(s);
}

function paintBadge(s: Snapshot): void {
  const span = badge.firstElementChild as HTMLElement;
  badge.classList.toggle("ok", s.status === "online");
  if (s.status === "connecting") {
    span.textContent = "connecting…";
    badge.style.display = "flex";
  } else if (s.status === "offline") {
    // Permanent and specific. A player who sees this knows their tower is
    // theirs alone, and a developer who sees it knows which of the three
    // strings is missing.
    span.textContent = `playing offline — scores are not saved (${s.reason})`;
    badge.style.display = "flex";
  } else {
    badge.style.display = "none";
  }
}

function paintWallet(s: Snapshot): void {
  if (s.blocks === null) {
    wallet.style.display = "none";
    return;
  }
  wallet.style.display = "block";
  wallet.innerHTML = `▦ <span class="mw-num">${s.blocks.toLocaleString()}</span>`;
}

function paintSheet(s: Snapshot): void {
  if (s.status === "connecting") {
    sheet.innerHTML = `<div class="mw-note">Still connecting — this run will not be recorded if it does not.</div>`;
    return;
  }
  if (s.status !== "online") {
    const why = s.reason ? ` ${s.reason}.` : "";
    sheet.innerHTML = `<div class="mw-note">Offline — this run was not recorded.${why}</div>`;
    return;
  }
  const rows = s.weekly.length
    ? s.weekly
        .map(
          (r) =>
            `<div class="mw-row${r.you ? " mw-you" : ""}"><span>${r.rank}. ${escape(r.name)}</span><span class="mw-num">${r.score}</span></div>`,
        )
        .join("")
    : `<div class="mw-note">No towers on the board yet this week. Yours will be the first.</div>`;

  const canContinue = s.continueCost !== null && (s.blocks ?? 0) >= s.continueCost;
  sheet.innerHTML = `
    ${s.lastEarned !== null ? `<div class="mw-earn">+${s.lastEarned} Blocks this run</div>` : ""}
    <div class="mw-h">You</div>
    <div class="mw-row"><span class="k">Best tower</span><span class="mw-num">${num(s.bestHeight)}</span></div>
    <div class="mw-row"><span class="k">Blocks stacked, all time</span><span class="mw-num">${num(s.totalBlocks)}</span></div>
    <div class="mw-row"><span class="k">Perfect drops</span><span class="mw-num">${num(s.perfectDrops)}</span></div>
    <div class="mw-row"><span class="k">All-time rank</span><span class="mw-num">${s.allTimeRank === null ? "unranked" : `#${s.allTimeRank}`}</span></div>
    <div class="mw-h">This week${s.weeklyLeague ? ` · ${escape(s.weeklyLeague)}` : ""}</div>
    ${rows}`;

  if (s.continueCost !== null && onContinue) {
    const btn = document.createElement("button");
    btn.className = "mw-cont";
    btn.disabled = !canContinue;
    btn.textContent = canContinue
      ? `Continue — ${s.continueCost} Blocks`
      : `Continue costs ${s.continueCost} Blocks`;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      if (await payToContinue()) onContinue?.();
    });
    sheet.append(btn);
  }
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
