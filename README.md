# Stack

A one-tap tower stacker, in the shape of Ketchapp's *Stack*. A block slides
above the tower, one tap drops it, the overhang is sliced off and the tower
narrows; land flush and it widens again and the combo ticks up. Portrait, one
canvas, no images and no sound.

It was written by the MagicWeave AI Studio, and its whole liveops surface —
currency, stats, leaderboards, shop, entry cost — is
[MagicWeave](https://magicweave.dev) configuration rather than code in this
repo.

## Running it

```sh
npm install
npm run dev
```

With no credentials it plays, and says so: a permanent badge reads **"playing
offline — scores are not saved"**. That is deliberate. The studio's starter
template made a missing backend indistinguishable from a working one — its
`mwEvent` was `if (!relay) return;`, so an exported build reported nothing,
silently, forever. `src/platform.ts` replaces it with the real SDK and an
honest failure state.

To play against a live economy, point it at an environment:

```sh
VITE_MW_EDGE_URL=http://localhost:54321 \
VITE_MW_CLIENT_ID=... \
VITE_MW_CLIENT_SECRET=... \
npm run dev
```

The credential is a **client** key. It ships inside the build on purpose:
every event it sends is a *claim*, and the platform caps what a rule will pay
on a claim — which is why both paying rules carry a `within` window. A client
key cannot grant currency and cannot write a leaderboard score.

In CI the three values come from repository secrets of the same names
(`.github/workflows/pages.yml`); they are never committed.

## What the platform holds

25 documents, published as Release 1.

| kind | documents |
| --- | --- |
| `economy/currencies/` | `blocks` |
| `economy/items/` | four tower skins |
| `economy/shops/yard/` | The Yard, and its four listings |
| `economy/entry_costs/` | `stack_continue` — 25 Blocks to carry on from a fall |
| `progression/stats/` | `best_height`, `total_blocks`, `perfect_drops` |
| `progression/leaderboards/` | `tallest_tower` (all-time), `weekly_tower` (weekly, four leagues) |
| `progression/games/` | `stack` — the session manifest: score field and the board it feeds |
| `rules/event-types/` | `session.started`, `session.finished`, `perfect.drop` |
| `rules/rules/` | the payout curve, the perfect-streak draw, three stat writes |

Two of those are worth reading, because they are the parts a rule language
usually cannot express:

**The payout is a curve, not a rate.** `stack_payout` pays 3 Blocks plus a
banded rate over `data.height` — 1 per block up to 10, then 2, then 4, then 6
past 50 — capped at 600 a run and 5,000 a day. Bands are read in ascending
order and the last one the number reaches applies.

**The perfect bonus is a draw.** `stack_perfect_bonus` pays from a weighted
table (70/25/5 → 2/8/40 Blocks) on any streak of three or more. The pick is
derived from the event id and the rule key, so a retried or redelivered event
lands on the same row every time — a replay cannot re-roll a prize.

The two boards are fed by different paths, on purpose. `tallest_tower` ranks
the `best_height` stat, so a rule writing that stat updates the board. The
weekly board names no stat, so it is fed by a finished *session* submitting its
score — which is what `progression/games/stack.yaml` is for.

## Deploying

`.github/workflows/pages.yml` builds on every push to `main`. Publishing is
gated on a repository variable, because Pages cannot serve from a private
repository on a free plan and an unconditional deploy step turns every push
red:

```sh
# once Pages is actually available for this repository
gh variable set PAGES_ENABLED --body true
```

To make it available: `gh repo edit --visibility public
--accept-visibility-change-consequences`, then
`gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`. Or host
`dist/` on anything static — the build has no server side.

Note that `VITE_MW_EDGE_URL` has to be an address the *player's* browser can
reach. Pointed at `localhost`, a deployed build reaches nobody's platform but
your own machine's, and every visitor gets the offline state — correctly, and
visibly. A hosted edge also has to allow the page's origin: `MW_CORS_ORIGINS`
is an explicit allowlist and never a wildcard.

Vite is configured with `base: "./"`, so `dist/` works from any
subdirectory — including a Pages project URL.

## Layout

    src/main.ts      the game: tower, slider, slicing, camera, HUD
    src/platform.ts  every call to MagicWeave, and everything read back
    src/panel.ts     the platform on screen, including the offline state
    src/shape.ts     the portrait letterbox
    src/tunables.ts  numbers readable from public/tunables.json without a rebuild
                     — slider speed, the perfect window, width recovery, ramp
    vendor/          the v2 SDK, packed from source (see below)

The `@magicweave/sdk` on npm is the **v1** SDK and does not speak to this
platform. The v2 client is workspace-only, so it is vendored here as a tarball
built from source. `npm pack` does not apply the package's `publishConfig`, so
packing it directly yields a tarball whose entry points name `src/` while
shipping only `dist/`; the tarball here has that applied.
