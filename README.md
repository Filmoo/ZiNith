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
| P4 | Replay capture, solve ribbon, history screen | **done** — persisted, filterable, replay scrubs with coach overlays |
| P5 | Coach: auto-run on game end, grade cache, overlays | **done** — grades cached in IndexedDB, recomputed lazily on `v` change |
| P6 | Metric modes + comparison | not started |
| P7 | Pattern library, frequency instrumentation, drills | catalogue + dual-metric instrumentation done; **drill ladder not built** |
| P8 | Learning mode: blocking, hints, undo | **live hints done**; move blocking and undo not built |
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

`npm run patterns` solves generated expert boards and counts patterns two
different ways, because "how often did I need this" and "how often is this on
the board" are different questions and only the second one is about teaching.

- **firings** — times a pattern was the *irreducible* proof of a move, i.e. no
  cheaper reading existed. This is what the solver attributes, since every
  deduction is minimised to its smallest witness set.
- **seen** — times the shape was present and forcing at least one cell, whether
  or not something cheaper also would have done ([`engine/coach/shapes.ts`](engine/coach/shapes.ts)).

Over 250 boards / 16,296 positions / 72,136 firings / 201,586 occurrences:

| Pattern | Tier | Depth | Firings | Seen | Per position |
|---|---|---|---|---|---|
| 1-1 | 2 | 2 | 2.58% | 22.69% | 2.81 |
| 1-2 | 2 | 2 | 1.00% | 22.48% | 2.78 |
| 1-1-2 | 3 | 3 | 0.02% | 8.69% | 1.07 |
| 1-1-1 | 3 | 3 | 0.03% | 8.16% | 1.01 |
| 1-2-2 | 3 | 3 | 0.00% | 6.95% | 0.86 |
| 1-2-1 | 3 | 3 | 0.05% | 4.15% | 0.51 |
| 1-3 | 2 | 2 | 0.03% | 1.45% | 0.18 |
| 2-2 | 2 | 2 | 0.04% | 1.32% | 0.16 |
| 1-2-2-1 | 3 | 4 | 0.02% | 1.02% | 0.13 |
| 1-4 | 2 | 2 | 0.01% | 0.22% | 0.03 |
| tank | 4 | 5 | 0.33% | — | — |
| global-count | 4 | 1 | 0.20% | — | — |

**This supersedes the previous revision of this section, which was wrong about
what it had measured.** It reported `1-2-1` at 0.04% and concluded the pattern
was "rarer than the tank". The number was right and the conclusion was not:
a 1-2-1 decomposes into two overlapping 1-2 reads plus a satisfied number, each
a strictly smaller proof, so minimal-witness attribution can essentially never
credit it. Measured as a shape it turns up 0.51 times per position — roughly 80×
more often than the firing count suggests, and it is one of the six most common
things on the board.

What that correction settles:

1. **Order the curriculum by `seen`, not by `firings`.** Firings measure what the
   solver could not shortcut. Players recognise gestalts, and reading a whole
   1-2-1 in one glance instead of three subset steps is the skill being trained.
2. **`1-1-2` and `1-2-2` were missing entirely**, and both are seen more often
   than `1-2-1`. Added to the catalogue on that evidence, the same way `1-3` and
   `1-4` were. `1-1-2-1` and `1-1-1-1` are the next candidates.
3. **Single-number reads are not patterns.** `satisfied` and `forced` are ~95% of
   all firings and 0% of shape occurrences — they are how you read one number,
   with no interacting constraints and therefore no depth to teach. They are now
   `PRIMITIVES`, kept so the coach can still *name* a one-number proof, and
   excluded from the catalogue, from teaching order, and from weak-spot
   suggestions. The previous revision argued the opposite and was reasoning from
   the firing count.

Proof depth still matches §10.1.3's own examples exactly: 1-1 is 2, 1-2-1 is 3.
Note that the tail of the generation distribution, not the median, is what §4.4
cares about.

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

## Learning mode

Toggle it in the topbar (◎) or the settings sheet. From the first click the board
marks every cell the solver can prove — green rings for safe, red crosses for
mines — and the footer names the pattern carrying the proof.

It shows *everything* provable rather than one "best move". Optimal is rarely
unique, and §7.3 already flags that trap for move blocking: naming a single cell
would misrepresent a position with four equally good ones. The readout also says
when nothing is provable, which is the one thing a player cannot work out alone —
that the guess in front of them is forced rather than a gap in their reading.

Chord safety is forced on in this mode. Games are recorded and gradeable but
excluded from personal bests, and the flag lives on the replay so it survives
export/import: a time set with every certainty on screen is not comparable to one
set blind.

Not yet built, both from §7.3: non-optimal **move blocking** (which must compare
click *cost*, never move identity, or ties get rejected and the mode becomes
infuriating) and **undo**. Opening a mine in learning mode still ends the game.

## Verification state

Checked in desktop Chromium against the dev server: the app boots with no console
errors, the idle grid renders, a first click generates a board and cascades, and
the timer starts from zero. History rows persist across a reload, the mistake
filter narrows to the right games, replay reconstructs and overlays proofs, and
learning mode is playable end to end by following its own hints — 3BV climbs and
the hint readout changes on every move.

Each pass has found something reasoning did not. The most recent: the play board
had been collapsing to about 240px since the P4 commit, because the wrapper that
hides PlayScreen behind history was a plain auto-height div and `.app` is
`height: 100%`. History and replay are `position: fixed`, so the P4 pass never
looked at the screen that broke.

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

### Known defects

Full list, with the browser-verification pitfalls, is in [`CLAUDE.md`](CLAUDE.md).

Fixed since the previous revision: fonts are now self-hosted and actually
render, and `efficiency`/`bvs` now divide *cleared* 3BV rather than whole-board
3BV, so mid-game IOE is a real percentage instead of `15700%`.

Fixed in P4: `abandon()` now persists on the way out, so starting a new game
mid-play records the abandoned board instead of discarding it.

Still outstanding:

- The touch gestures have never run on a real device. `longPressMs` defaults to
  180ms, which §13.1 flags as a guess needing side-by-side testing against The
  Clean One.
- History and replay have only been driven in desktop Chromium. The row grid is
  eight columns wide and has not been checked at phone width.
- Blurbs for `1-1-2` and `1-2-2` teach the reading rather than a fixed answer,
  because unlike 1-2-1 in a corridor, what those runs force depends on the
  surrounding wall. Worked examples (§10 `worked`) would pin them down.
