# Zinith

A Minesweeper training app for speedrunners. Web-first, packaged for Android.

## Status

| Phase | State |
|---|---|
| P0 scaffold | done |
| P1 engine — board, RNG, solver tiers 1–4, 3BV/ZiNi/HZiNi | **done, verified** |
| P2 playable — canvas, input, 4 control schemes, timer, ribbon | code complete, needs on-device verification |
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

## Not yet verified

The canvas renderer, gesture layer and React shell were written without a
browser available. They typecheck by inspection only — the first `npm run dev`
may need fixes. Everything under `/engine` and `/src/game` is test-verified.
