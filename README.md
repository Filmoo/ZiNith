# Zinith

A Minesweeper training app for speedrunners. Web-first, packaged for Android.

A real solver grades every move after every game, so the analysis is the product.
Expert (30×16, 99 mines) with no-guess on is the minesweeper.online ranked
configuration, and it is the default rather than an opt-in mode.

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — orientation, layering rules, known traps. Start here.
- [`docs/spec-delta-v1.1.md`](docs/spec-delta-v1.1.md) — authoritative planning
  document: revised phases (§12), home/history (§14), drill ladder (§10.3).
  The **base build spec is not in this repository**; only this delta is tracked.

## Status

Phases follow §12 of the spec delta.

| Phase | Content | State |
|---|---|---|
| P0 | Scaffold | done |
| P1 | Engine — board, RNG, solver tiers 1–4, 3BV/ZiNi/HZiNi | **done, test-verified** |
| P2 | Playable — canvas, input, control schemes | done for mouse and touch; gestures need on-device tuning |
| P3 | Presets + no-guess pool | preset table done; **pool not built** |
| P4 | Replay capture, solve ribbon, history screen | ribbon done; **no persistence — history is empty every reload** |
| P5 | Coach: auto-run on game end, grade cache, overlays | **done** — post-game panel, worker-graded |
| P6 | Metric modes + comparison | not started |
| P7 | Pattern library, frequency instrumentation, drills | library screen + instrumentation done; **drill ladder (§10.3) not built** |
| P8 | Learning mode: blocking, hints, undo | **done** — live overlay, move-blocking, undo |
| P9 | Android via Capacitor | pipeline done; export/import must precede shipping (§15) |
| P10 | Cloud sync | not started |

## Requirements

Node 22 or newer. The engine uses Node's native TypeScript stripping, so
**engine tests need no `npm install` at all**:

```bash
npm test          # engine + controller tests, zero dependencies
npm install       # only needed for the UI
npm run dev       # Vite dev server
```

## Development loop

| Command | Use |
|---|---|
| `npm run dev` | Vite dev server on <http://localhost:5173>, HMR on save |
| `npm run dev:lan` | same, also bound to your LAN IP — open it on your phone to test real touch |
| `npm run test:watch` | re-runs engine/controller tests on save |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check` | typecheck + tests, i.e. what CI gates on |
| `npm run bench` | generation and solver timings |

The productive split is **logic in Node, feel in the browser**. Anything about
rules, solving or metrics belongs in `/engine` or `/src/game` and is provable
with `npm run test:watch` in a second terminal — no browser needed. Only the
things that genuinely need pixels or fingers (renderer, gestures, haptics) have
to be checked in `npm run dev`.

For touch work, `npm run dev:lan` is much faster than building an APK: Vite
prints a `Network:` URL, you open it on your phone on the same Wi-Fi, and HMR
still applies. Reserve the tag-to-APK pipeline for verifying the packaged build,
not for iterating. Note that haptics come from the Capacitor plugin and are a
no-op in a browser, so vibration is the one thing only a real APK can confirm.

Before pushing, run `npm run check`.

## Getting an APK

Push a tag. That is the whole workflow:

```bash
git tag v0.2.0
git push origin v0.2.0
```

`.github/workflows/release.yml` then runs the tests, builds the web bundle,
adds the Android platform via Capacitor, assembles the APK, and attaches it to
the GitHub release. `versionName` comes from the tag, `versionCode` from the run
number.

### Signing

Without secrets the workflow still produces a **debug APK**, so the pipeline
works from day one. For a release-signed build, create a keystore and add four
repository secrets:

```bash
keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias zinith
base64 -w0 release.jks     # paste into ANDROID_KEYSTORE_BASE64
```

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | base64 of `release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | `zinith` |
| `ANDROID_KEY_PASSWORD` | key password |

Keystores are gitignored. Losing one means you can never update the app under
the same package name, so back it up outside the repo.

## Architecture

`/engine` is pure TypeScript with no dependencies and no React — it runs in
Node, in the browser, and in a Web Worker. `/src/game/controller.ts` owns the
board and replay log and is deliberately framework-free, so the rules are
testable headlessly; React only subscribes to it.

## Measured facts

Recorded on this codebase rather than assumed:

- **Solver soundness**: 10,000 boards, 21,532 stalls audited, zero unsound calls.
- **No-guess generation, expert (30×16, 99 mines), n=400**: p50 8ms, p90 26ms,
  p99 53ms, max 115ms, worst case 49 attempts.

### Pattern frequency (§10.1.2)

`npm run patterns` solves generated expert boards and counts which patterns
actually carry the solve, so teaching order is derived rather than asserted.
Over 250 boards / ~73,000 firings:

| Pattern | Tier | Depth | Share |
|---|---|---|---|
| satisfied | 1 | 1 | 54.97% |
| forced | 1 | 1 | 40.40% |
| 1-1 | 2 | 2 | 2.86% |
| 1-2 | 2 | 2 | 1.02% |
| tank | 4 | 5 | 0.31% |
| global-count | 4 | 1 | 0.16% |
| 2-2 | 2 | 2 | 0.04% |
| 1-2-1 | 3 | 3 | 0.04% |
| 1-2-2-1 | 3 | 4 | 0.01% |

Two things this measurement settled, both against folklore:

1. **Tier 1 is 95% of the game.** Everything famous is a rounding error by
   comparison, which argues for drilling recognition speed on satisfied/forced
   rather than treating them as a beginner formality.
2. **`1-2-1` is rarer than the tank** — and `1-3` and `1-4` both fire more often
   than `1-2-2-1` while being *shallower* proofs. They were added to the
   catalogue on that evidence. Proof depth matches §10.1.3's own examples
   exactly: 1-1 is 2, 1-2-1 is 3.

Note that the tail of that distribution, not the median, is what §4.4 cares
about.

## Spec deviations

1. **`generate.ts` is its own module**, not part of `board.ts`, because
   no-guess generation depends on the solver and `board.ts` must not.
2. **Node's test runner**, not Vitest, for the engine. Keeps §2's "zero
   dependencies, runnable in Node" literally true and makes CI installs
   unnecessary for the test job.

### Superseded deviation: the generation pool

An earlier revision of this README argued that the measured generation speed
above **retired** the pre-generated pool of §4.4, generating on the first click
instead. **Spec delta v1.1 reverses that**, and the delta wins: no-guess is now
the default for every preset rather than for competitive play only, which
promotes the pool from an optimization to load-bearing infrastructure. The
per-preset depths are already encoded as `poolTarget` in
[`engine/presets.ts`](engine/presets.ts) (5 / 10 / 20).

The underlying tension is real and still has to be handled: a board is defined
by `(seed, firstClick)`, so a pool cannot pre-commit the player's opening cell.
A pooled *seed* must therefore be validated against the actual first click, with
the generating state shown if the Expert pool runs dry.

## Verification state

Checked in desktop Chrome against the dev server: the app boots with no console
errors, the layout sizes correctly, the idle grid renders, a first tap generates
a board and cascades, and the timer starts from zero. That pass fixed two
blockers — see git history — and the first click had previously been impossible.

Still unverified, because a desktop browser cannot answer it:

- the four control schemes under real touch (long press, drag-flag, pinch-zoom,
  two-finger chord), and the `longPressMs` default of 180ms
- haptics, which are a Capacitor no-op outside an APK

## Controls

Mouse and touch are separate mappings, chosen per event from `pointerType`
rather than sniffed once per device — a tablet with a trackpad has both.

| | Mouse | Touch |
|---|---|---|
| Open | Left click | Tap |
| Flag | **Right click** | Long press |
| Chord | Middle click, both buttons, or left click on a number | Tap a number, or two-finger tap |
| Zoom | — | Pinch |
| New game | <kbd>N</kbd> | — |

The four touch schemes (`standard`, `flag-first`, `no-flag`, `drag-flag`), the
long-press threshold, and left-click chording are all in the settings sheet.

## Learning mode and the pattern library

**Learn** and **Patterns** are real sections now, not just Play with a gear icon.

- **Learn** (§7.3, §P8) runs a `LearningGame` — the same `Game` timed play uses,
  gated twice over. First on provability: guessing while a certainty exists is
  rejected. Then on **measured click cost**, which is the half that teaches speed.
  Opening eight cells one at a time when a single chord clears them is correct and
  still wrong, and the block says so precisely: *"Costs 3 extra clicks. Chord the
  6-cell group instead — it saves 4 clicks."* Flagging mines no chord will ever use
  is rejected the same way. Every genuinely tied line is accepted, because regret is
  measured per move rather than compared against one arbitrary "optimal" path.

  The hint names the move and its price first (*"Chord — clears 6 cells in one click,
  saves 4 clicks · 71 clicks left"*), then the pattern that proves it. Undo rebuilds
  the board from the seed and replays every event but the last, so there is no
  separate undo stack. Hints can be switched off in settings: wrong and wasteful
  moves are still blocked, which turns it into recognition practice.
- **Patterns** is the library, browsable at any time (§10.2): every catalogued
  pattern, grouped by tier, in the same derived order the curriculum uses, seeded
  from the real §10.1.2 measurement below rather than a second invented ranking.
  A pattern id is rendered as coloured digit chips — the id already *is* the
  effective-count signature, so this reads the proof directly.

### Known defects

Full list, with the browser-verification pitfalls, is in [`CLAUDE.md`](CLAUDE.md).

Fixed since the previous revision: fonts are now self-hosted and actually
render, and `efficiency`/`bvs` now divide *cleared* 3BV rather than whole-board
3BV, so mid-game IOE is a real percentage instead of `15700%`.

Still outstanding:

- The touch gestures have never run on a real device. `longPressMs` defaults to
  180ms, which §13.1 flags as a guess needing side-by-side testing against The
  Clean One.
- `abandon()` marks a replay as abandoned but nothing persists it, so starting a
  new game mid-play still discards the record in practice, and `weakSpot` has no
  history to draw a rolling window from — it is written and tested, but every
  session starts with an empty sample until P4 lands persistence.
- The drill ladder (§10.3) is not built. Learning mode always shows the hint; a
  drill would hide it to test recognition speed instead, which is a distinct
  mode, not a setting on this one.
