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
| P2 | Playable — canvas, input, control schemes | plays in desktop Chrome; needs design and control work |
| P3 | Presets + no-guess pool | preset table done; **pool not built** |
| P4 | Replay capture, solve ribbon, history screen | not started |
| P5 | Coach: auto-run on game end, grade cache, overlays | not started |
| P6 | Metric modes + comparison | not started |
| P7 | Pattern library, frequency instrumentation, drills | not started |
| P8 | Learning mode: blocking, hints, undo | not started |
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

### Known defects

Full list, with the browser-verification pitfalls, is in [`CLAUDE.md`](CLAUDE.md).
The two that matter most:

1. **No fonts are loaded.** `index.html` declares no `@font-face` and no font
   link, yet the design system asks for Archivo Expanded / Inter Tight / IBM Plex
   Mono and `atlas.ts` requests IBM Plex Mono for the canvas digits. All three
   silently fall back to `system-ui`, so the design has never actually been
   rendered as specified. Fonts must be self-hosted — the Android build is
   offline, so a CDN link would fail there.
2. **`Snapshot.efficiency` and `Snapshot.bvs` are wrong mid-game.** Both divide
   the *whole board's* 3BV by clicks and elapsed time, so they are meaningful
   only on a finished game; the footer currently shows nonsense like
   `15700% IOE`. A live figure needs 3BV *completed so far*, which nothing
   tracks yet.

### Outstanding UI work

The play screen is functional but not production quality, and this is the next
body of work: there is no menu beyond a single "New game" button, and the
desktop control scheme requires a long press to flag instead of a right click.
Mouse and touch need separate schemes selected by pointer type — left/right/middle
click on desktop, the existing gesture set on touch.
