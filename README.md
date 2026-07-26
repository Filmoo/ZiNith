# Zinith

A Minesweeper training app for speedrunners. Web-first, packaged for Android.

## Status

| Phase | State |
|---|---|
| P0 scaffold | done |
| P1 engine — board, RNG, solver tiers 1–4, 3BV/ZiNi/HZiNi | **done, verified** |
| P2 playable — canvas, input, 4 control schemes, timer, ribbon | boots and plays in desktop Chrome; touch schemes need on-device verification |
| P9 release pipeline — tag to APK | done |
| P3–P8 | not started |

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

That second number retires the pre-generated pool described in §4.4 of the
spec — see "Spec deviations" below.

## Spec deviations

1. **No generation pool.** §4.4 calls for an IndexedDB pool of ~20 accepted
   seeds per preset. Measured generation is fast enough to run on the first
   click instead. This also resolves a latent conflict: a board is defined by
   `(seed, firstClick)`, so a pre-generated pool would have had to choose the
   player's opening cell for them. Generation still belongs in a worker as
   insurance against the tail.
2. **`generate.ts` is its own module**, not part of `board.ts`, because
   no-guess generation depends on the solver and `board.ts` must not.
3. **Node's test runner**, not Vitest, for the engine. Keeps §2's "zero
   dependencies, runnable in Node" literally true and makes CI installs
   unnecessary for the test job.

## Verification state

Checked in desktop Chrome against the dev server: the app boots with no console
errors, the layout sizes correctly, the idle grid renders, a first tap generates
a board and cascades, and the timer starts from zero. That pass fixed two
blockers — see git history — and the first click had previously been impossible.

Still unverified, because a desktop browser cannot answer it:

- the four control schemes under real touch (long press, drag-flag, pinch-zoom,
  two-finger chord), and the `longPressMs` default of 180ms
- haptics, which are a Capacitor no-op outside an APK

### Known issue

`Snapshot.efficiency` and `Snapshot.bvs` divide the **whole board's** 3BV by
clicks and elapsed time, so they are only meaningful once a game is won —
mid-game the footer shows nonsense like `15700% IOE`. A live figure needs 3BV
*completed so far*, which nothing tracks yet.
