/**
 * platform — everything Stack says to MagicWeave, and everything it reads back.
 *
 * This replaces the studio's `mw.ts`, which posted to a relay the AI Studio
 * injected per preview session and returned nothing. Two things were wrong with
 * shipping that: a downloaded build has no relay, so `mwEvent` became a total
 * no-op with no way to tell — a dead economy and a working one looked
 * identical — and fire-and-forget throws away the one thing a payout rule
 * returns, which is what it actually paid.
 *
 * Here the credential is a `client` key. It ships inside the build on purpose:
 * every event it sends is a *claim*, the platform caps what a rule will pay on
 * one, and that cap is why the two paying rules carry a WITHIN window. Nothing
 * here can grant currency directly and nothing here can write a score.
 */
import { connect, type MagicweaveClient } from "@magicweave/sdk";

/** The game key in `progression/games/stack.yaml`. */
const GAME = "stack";
const WEEKLY_BOARD = "weekly_tower";
const ALL_TIME_BOARD = "tallest_tower";
const CONTINUE_COST = "stack_continue";
const CURRENCY = "blocks";

export type Status = "connecting" | "online" | "offline";

export interface BoardRow {
  rank: number;
  score: number;
  name: string;
  you: boolean;
}

export interface Snapshot {
  status: Status;
  /** Why we are offline, in words a player can act on. Empty when online. */
  reason: string;
  blocks: number | null;
  bestHeight: number | null;
  totalBlocks: number | null;
  perfectDrops: number | null;
  weekly: BoardRow[];
  weeklyLeague: string | null;
  allTimeRank: number | null;
  /** What the last finished run paid, straight off the rule's own effect. */
  lastEarned: number | null;
  continueCost: number | null;
}

const snap: Snapshot = {
  status: "connecting",
  reason: "",
  blocks: null,
  bestHeight: null,
  totalBlocks: null,
  perfectDrops: null,
  weekly: [],
  weeklyLeague: null,
  allTimeRank: null,
  lastEarned: null,
  continueCost: null,
};

const listeners = new Set<() => void>();

/** Subscribe to snapshot changes; returns an unsubscribe. */
export function onChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function snapshot(): Readonly<Snapshot> {
  return snap;
}

function changed() {
  for (const fn of listeners) fn();
}

function offline(reason: string) {
  snap.status = "offline";
  snap.reason = reason;
  changed();
}

/**
 * The device this player is. `localStorage`, not `sessionStorage`: a guest who
 * closes the tab has to come back as the same player or their tower, their
 * Blocks and their place on the board all belong to somebody else.
 */
function deviceId(): string {
  const KEY = "stack.device";
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // Private browsing with storage denied. A fresh id per load means a fresh
    // guest per load, which is worse than persisting and better than refusing
    // to run.
    return crypto.randomUUID();
  }
}

let mw: MagicweaveClient | null = null;
let runId: string | null = null;

const EDGE = import.meta.env.VITE_MW_EDGE_URL ?? "http://localhost:54321";
const CLIENT_ID = import.meta.env.VITE_MW_CLIENT_ID ?? "";
const CLIENT_SECRET = import.meta.env.VITE_MW_CLIENT_SECRET ?? "";

/** A fresh key per distinct write. Reusing one only ever retries that write. */
function idem(): { header: { "Idempotency-Key": string } } {
  return { header: { "Idempotency-Key": crypto.randomUUID() } };
}

export const ready: Promise<void> = (async () => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    offline("no key was built in");
    return;
  }
  try {
    mw = await connect({
      baseUrl: EDGE,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      signIn: { provider: "guest", identifier: deviceId() },
    });
    snap.status = "online";
    snap.reason = "";
    changed();
    await refresh();
  } catch (err) {
    offline(err instanceof Error ? err.message : "could not reach MagicWeave");
  }
})();

/** Wallet, stats, entry cost and both boards — the whole read path, once. */
export async function refresh(): Promise<void> {
  if (!mw) return;
  const client = mw;
  await Promise.allSettled([
    (async () => {
      const balances = await client.wallet();
      snap.blocks = balances.find((b) => b.currency_key === CURRENCY)?.balance ?? 0;
    })(),
    (async () => {
      const body = await client.api.GET("/v1/stats");
      const stats = body.data?.stats ?? [];
      const at = (key: string) => stats.find((s) => s.key === key)?.value ?? 0;
      snap.bestHeight = at("best_height");
      snap.totalBlocks = at("total_blocks");
      snap.perfectDrops = at("perfect_drops");
    })(),
    (async () => {
      const costs = await client.entryCosts();
      snap.continueCost = costs.find((c) => c.key === CONTINUE_COST)?.amount ?? null;
    })(),
    readBoards(client),
  ]);
  changed();
}

async function readBoards(client: MagicweaveClient): Promise<void> {
  const weekly = await client.api.GET("/v1/leaderboards/{leaderboard}", {
    params: { path: { leaderboard: WEEKLY_BOARD }, query: { limit: 5 } },
  });
  const board = weekly.data;
  if (board) {
    snap.weeklyLeague = board.league ?? null;
    snap.weekly = (board.entries ?? []).map((e) => ({
      rank: e.rank,
      score: e.score,
      // Absent when the player never set one — render the id's head, not a
      // placeholder that reads like a real name.
      name: e.display_name ?? `player ${e.player_id.slice(0, 4)}`,
      you: e.player_id === client.playerId,
    }));
  }
  const allTime = await client.api.GET("/v1/leaderboards/{leaderboard}", {
    params: { path: { leaderboard: ALL_TIME_BOARD }, query: { limit: 1 } },
  });
  // null for a player who has never been ranked. Not an error and not last
  // place, so it renders as an absence rather than a number.
  snap.allTimeRank = allTime.data?.standing?.rank ?? null;
}

/**
 * A run begins.
 *
 * Two calls, and they are not the same thing. The event is what the rules
 * watch; the session is what `progression/games/stack.yaml` governs — how long
 * a run may stay open, which field of its outcome is the score, and which board
 * that score is submitted to. Only the session feeds `weekly_tower`.
 */
export async function runStarted(): Promise<void> {
  if (!mw) return;
  const client = mw;
  snap.lastEarned = null;
  changed();
  await Promise.allSettled([
    client.report({ event_id: crypto.randomUUID(), type: "session.started", data: {} }),
    (async () => {
      const started = await client.api.POST("/v1/sessions", {
        params: idem(),
        body: { game: GAME },
      });
      runId = started.data?.id ?? null;
    })(),
  ]);
}

/** A flush landing. The bonus rule only looks at streaks of three or more. */
export async function perfectDrop(combo: number): Promise<void> {
  if (!mw) return;
  try {
    const accepted = await mw.report({
      event_id: crypto.randomUUID(),
      type: "perfect.drop",
      data: { combo },
    });
    applyEffects(accepted.effects);
  } catch {
    // A dropped bonus must not interrupt a run. The balance re-reads on finish.
  }
}

export async function runFinished(height: number, perfects: number): Promise<void> {
  if (!mw) return;
  const client = mw;
  const outcome = { height, perfects };
  const results = await Promise.allSettled([
    client.report({ event_id: crypto.randomUUID(), type: "session.finished", data: outcome }),
    runId
      ? client.api.POST("/v1/sessions/{sessionId}/finish", {
          // No Idempotency-Key here, unlike the start: this call's identity is
          // the session id, so sending it twice finishes one run once.
          params: { path: { sessionId: runId } },
          body: { outcome },
        })
      : Promise.resolve(null),
  ]);
  runId = null;
  const reported = results[0];
  if (reported.status === "fulfilled") {
    // What the payout rule actually paid, this round trip — after its curve and
    // after the day's cap. Reading the wallet instead would show the number but
    // not that this run earned it.
    const paid = reported.value.effects
      .filter((e) => e.currency_key === CURRENCY)
      .reduce((sum, e) => sum + (e.delta ?? 0), 0);
    snap.lastEarned = paid;
    applyEffects(reported.value.effects);
  }
  await refresh();
}

/**
 * Pay to carry on from where the tower fell.
 *
 * `economy/entry_costs/stack_continue.yaml` names the price; this call names
 * only what is being entered, so the number is a release decision rather than
 * something the build could argue with. Returns false when they cannot afford
 * it, which the platform decides — not this function.
 */
export async function payToContinue(): Promise<boolean> {
  if (!mw) return false;
  try {
    await mw.charge({ cost: CONTINUE_COST, entry_id: crypto.randomUUID() });
    await refresh();
    return true;
  } catch {
    await refresh();
    return false;
  }
}

function applyEffects(effects: readonly { currency_key?: string; balance_after?: number }[]) {
  for (const e of effects) {
    if (e.currency_key === CURRENCY && typeof e.balance_after === "number") {
      snap.blocks = e.balance_after;
    }
  }
  changed();
}
