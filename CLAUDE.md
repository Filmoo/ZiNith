# CLAUDE.md

Orientation for an agent joining this repo cold. Read this, then
[`docs/spec-delta-v1.1.md`](docs/spec-delta-v1.1.md), then the file you are changing.

## What this is

A Minesweeper **training** app for speedrunners — not a Minesweeper game with stats bolted
on. The distinguishing feature is that a real solver grades every move you made after every
game, so the product is the analysis. Web-first, packaged for Android via Capacitor.

Expert (30×16, 99 mines) with no-guess on is the minesweeper.online ranked configuration and
is the **default**, deliberately not an opt-in mode.

## Commands

```bash
npm test           # engine + controller tests. NO npm install needed (see below)
npm run check      # typecheck + tests — what CI gates on, run before pushing
npm run dev        # Vite dev server, localhost:5173
npm run dev:lan    # also bound to LAN IP, for testing real touch on a phone
npm run test:watch # re-run tests on save
npm run typecheck  # tsc --noEmit
npm run bench      # generation + solver timings
```

Node 22+ required. The engine relies on Node's native TypeScript stripping, so **the test
suite runs with zero dependencies installed** — `npm install` is only needed for the UI.
Keep it that way: do not import a third-party module from `/engine` or `/test`.

## Architecture and its layering rules

```
engine/       pure TS. No dependencies, no React, no DOM. Runs in Node, browser, worker.
engine/coach/ the pedagogy layer: names patterns, grades replays, derives curriculum.
src/game/     controller.ts — owns board + replay log. Framework-free on purpose.
src/render/   renderer.ts (canvas) + atlas.ts (pre-rendered sprites) + ribbon.ts.
src/input/    pointer.ts — mouse and touch, routed per event by pointerType.
src/screens/  React: PlayScreen (shell, HUD, frame loop), MenuSheet (settings).
src/settings.ts  Settings type, validated localStorage persistence, theme/pointer hooks.
src/tokens.ts + src/styles.css + src/fonts.css   design system; tokens.ts is what the
              canvas reads, styles.css what the DOM reads — keep the two in sync.
```

Input mapping, which is deliberately two different languages rather than one sniffed per
device (a tablet with a trackpad has both, and the right mapping is whichever was just used):

| | Mouse | Touch |
|---|---|---|
| Open | left | tap |
| Flag | right | long press (`longPressMs`) |
| Chord | middle, both buttons, or left on a number | tap a number, or two-finger tap |

Both open on `pointerdown` per §7.1. Two-button chording still works because chording only
applies to an already-revealed number, and `open()` is a no-op on one — so the left press
cannot consume the cell before the right press arrives.

Live HUD figures are written straight to the DOM by the frame loop via refs. Do not move them
into React state: that re-renders the tree 60 times a second.

## The coach and pedagogy layer (`engine/coach/`)

The solver deliberately does not know pattern names — [`rules.ts`](engine/solver/rules.ts)
says so: tier 2's subset rule subsumes 1-1, 1-2, 1-2-1 and 1-2-2-1, and naming shapes is this
layer's job (§5.4). Three things follow, and they are the load-bearing ideas here:

- **Pattern ids are derived, not matched.** A pattern is the *effective counts* (number minus
  flags placed) of the minimal witness set that proves the deduction, canonicalised against
  its own reverse so a mirrored `2-1` aggregates as `1-2`. Nothing is hand-matched, so a shape
  nobody has named still gets a stable id and still appears in the frequency counts. Adding a
  `PATTERNS` entry only attaches a label, tier and prerequisites to an id that already exists.
  Zero-count witnesses are excluded from the signature: a fully-flagged number is the
  `satisfied` insight, `0-2-3-1` is not a name anyone teaches, and keeping them splinters the
  weak-spot tallies into buckets no lesson can address. Depth still counts every witness.
- **Render patterns with `describePattern`, not `getPattern`.** Ids are derived, so an id with
  no catalogue entry is normal; `getPattern` returns undefined for those and the UI renders
  blanks. `describePattern` always yields a displayable label, tier and blurb.
- **Proof depth is measured.** `minimizeWitnesses` shrinks a proof to what actually proves it,
  and its size *is* §10.1.3's depth. Do not hand-assign difficulty.
- **Grading must not use `solve()`.** Use `provableIn()`. `solve` short-circuits at the
  cheapest productive tier, which is correct for playing and wrong for grading twice over:
  it hides a 1-1 behind a satisfied number, and provability by these rules is not monotone, so
  revealing a cell can dismantle the subset relation that proved something. Both make the
  coach accuse players who were right. `provableIn` unions every tier including the tank; it
  costs one enumeration per move, which is affordable only because the coach runs once per
  game in a worker (§8.2). **Timed play must never call it.**

`CoachClass` is **inferred**, not spec'd — §8.2 says the classification table is "unchanged",
meaning it lives in the base spec, which is missing. It is reconstructed from the fields §8.4
records per move plus §14.3's required "unnecessary guess" query. Reconcile when the base spec
surfaces; the names are cheap to change, the machinery is not.

`npm run patterns` is the §10.1.2 instrumentation. Run it before changing teaching order —
the current catalogue includes `1-3` and `1-4` because they measurably outrank `1-2-1`.

Rules that are load-bearing, not stylistic:

- **`/engine` must stay dependency-free and DOM-free.** This is what makes the rules
  testable headlessly and is why `npm test` needs no install.
- **`board.ts` must not depend on the solver.** No-guess generation does, which is exactly
  why `generate.ts` is a separate module.
- **The controller is framework-free.** React subscribes to it. Game state does not live in
  React. If you find yourself putting rules in a component, you are in the wrong file.
- A board is defined by `(seed, firstClick)`. Both are needed to reconstruct it — this is
  why a pre-generated pool cannot pick the opening cell for the player.

## The spec

`docs/spec-delta-v1.1.md` is the authoritative planning document and holds the revised
phase list (§12), the home/history design (§14), and the drill ladder (§10.3).

**The base build spec is not in this repository.** Source files cite it throughout (`§4.3`,
`§5.4`, `§7.1`, `§7.4`, `§8.3`, `§11`, `§13.1`), but only the delta is tracked. Where they
disagree, the delta wins. Where the delta is silent, ask the owner — do not reconstruct the
base spec from the code and then treat your reconstruction as authoritative.

## Where the project actually stands

| Phase | State |
|---|---|
| P0 scaffold | done |
| P1 engine — board, RNG, solver tiers 1–4, 3BV/ZiNi/HZiNi | done, test-verified |
| P2 playable — canvas, input, control schemes | done for mouse and touch; touch gestures still need on-device tuning |
| P3 presets + no-guess pool | preset table done; **pool not built** |
| P4–P8, P10 | not started |
| P9 release pipeline — tag to APK | done (export/import must precede shipping, §15) |

Verified by measurement on this codebase, not assumed:

- Solver soundness: 10,000 boards, 21,532 stalls audited, zero unsound calls.
- No-guess expert generation, n=400: p50 8ms, p90 26ms, p99 53ms, max 115ms, 49 attempts
  worst case.

## Traps and known defects

Things that will waste your time if you do not know them:

1. **The sprite atlas caches baked glyphs, so webfonts must be awaited.** `buildAtlas` draws
   digits into a bitmap and caches it per (cell size, theme). If it runs before IBM Plex Mono
   arrives, the digits stay in the fallback face forever. `PlayScreen` loads exactly
   `ATLAS_FONTS` and then calls `renderer.invalidateAtlas()`. Preserve that if you touch
   either file.
2. **Fonts are self-hosted and latin-only, on purpose.** `src/fonts.css` hand-declares the
   faces rather than importing Fontsource's entrypoints, which pull Cyrillic/Greek/Vietnamese
   too. `unicode-range` makes those free on the web but not in the APK, where Vite bundles
   every referenced file. Never switch to a CDN link: the Android build has no network.
3. **`dexie` and `comlink` are dependencies with zero imports.** They were added for the
   P3/P4 pool, history, and worker work that does not exist yet. Their presence is not
   evidence that persistence or workers are wired up — nothing is, and there are no workers.
4. **`PresetId` includes `'custom'` but `PRESETS` excludes it.** Custom boards are typed for
   but unimplemented; `Record<Exclude<PresetId, 'custom'>, Preset>` is deliberate.
5. **Haptics use `navigator.vibrate`, not `@capacitor/haptics` yet.** The dependency is
   installed but unimported — `src/platform/haptics.ts` is a placeholder to be swapped at P9
   without touching callers. So vibration *does* work in a mobile browser (Android Chrome via
   `npm run dev:lan`) and does nothing on desktop.
6. **A `Theme` carries its own number palette.** Dark mode cannot reuse the light one:
   canonical "7" is `#000000`, invisible on a dark cell. `LIGHT_THEME`/`DARK_THEME` bundle
   the palette with the surface colours so the atlas cannot pick the wrong pair.
7. **Timed play must never call the solver mid-game** (§8.2). The coach runs on game end, in
   a worker. Live overlays belong to learning mode and drills only.
8. **Stored settings are parsed field by field, never spread.** `localStorage` is untrusted
   input; one bad value reaching the board config bricks the app on load with no user-visible
   way to recover. See `parse()` in `src/settings.ts`.

### If you verify UI in a browser

Driving the canvas with synthetic `PointerEvent`s works but is easy to get wrong:

- Reuse of a pointer id that was never released makes the *next* tap register as a pinch,
  because `pointers.size` reaches 2. Symptoms look like phantom clicks and flags.
- `setPointerCapture` throws for a pointer id the browser does not consider active, and the
  exception is swallowed inside `dispatchEvent`, so `onDown` silently aborts.
- If a human's mouse is over the preview pane, real `isTrusted: true` events interleave with
  yours. Confirm suspicious state with an idle sample before believing it.

## Conventions

- TypeScript throughout, ES modules, explicit `.ts`/`.tsx` in import specifiers (required by
  Node's stripping mode).
- Comments explain *why*, and cite spec sections (`§7.2`) where a rule comes from one.
- Tests use Node's built-in runner, not Vitest — a deliberate choice to keep §2's
  "zero dependencies, runnable in Node" literally true.
- Run `npm run check` before pushing.
