# Zinith

A minesweeper trainer. Play, then get graded: the solver replays your game, tells you which
moves were forced, which were guesses you did not need to take, and what it would have cost
you to play it perfectly.

`docs/spec-delta-v1.1.md` is the authoritative spec in this repo. The base build spec it
amends is **not checked in** — where the delta is silent, follow minesweeper.online
conventions and leave a comment recording the assumption.

## Layout

```
src/engine/   Pure TypeScript. No DOM, no React — it runs in web workers.
src/ui/       React. Rendering, input, screens.
docs/         Spec.
```

The engine boundary is load-bearing. Solver and coach both run off the main thread (§7.2,
§8.2), so nothing under `src/engine` may import from `src/ui` or touch `window`.

## Commands

```
npm run dev        vite dev server
npm test           vitest, single run
npm run typecheck  tsc --noEmit
npm run build      typecheck + production bundle
```

## Conventions

- Boards are flat typed arrays indexed `y * width + x`. Never arrays of arrays — the solver
  is hot and allocation shows up in the Expert generation loop.
- Neighbours come from `topology(w, h)`, which caches per board size.
- All randomness goes through `src/engine/rng.ts` with an explicit seed. Replays reconstruct
  the board from `(seed, spec, firstClick)`, so an unseeded `Math.random()` anywhere in
  generation silently breaks replay (§14.3).
- Solver conclusions carry their witness set. Proof depth = witness count (§10.1), so
  dropping witnesses to save a few bytes breaks the derived teaching order.

## Phase status

P0 scaffold and P1 engine are in progress. See `docs/spec-delta-v1.1.md` §12 for the
phase table. P9 (Android via Capacitor) has no Android SDK in CI yet.
