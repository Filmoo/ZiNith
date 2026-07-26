# Zinith — Spec Delta v1.1

Changes arising from the design Q&A. Sections below **replace** their counterparts in the
build spec; new sections are marked NEW. Everything not listed here is unchanged.

> **Repository note.** The base build spec (the document these sections amend) is not yet
> checked in — only this delta is. Where the delta is silent, implementation follows the
> conventions of minesweeper.online and records the assumption in code comments. Commit the
> base spec to `docs/spec.md` when available.

---

## Resolved decisions

| # | Decision | Resolution |
|---|---|---|
| 1 | Launch surface | Home screen: PBs, trend line, game history |
| 2 | No-guess scope | Default for all play; toggleable off |
| 3 | Coach timing | Auto after every game; live only in learning mode |
| 4 | Ranked mode | **Removed.** Its rules become the baseline for timed play |
| 5 | Curriculum | Fixed order + coach-driven suggestion, free browse always |
| 6 | PB pools | Split on flag/no-flag × no-guess/guess |
| 7 | Chord safety warning | On in learning, off in play |
| 8 | Drill format | Escalating: position → mini → full |
| 9 | Drill gates | Coupled to format: accuracy → speed → free |
| 10 | Curriculum entry | Self-select |
| 11 | Learning mode | Separate from drills; full boards, hints, undo |
| 12 | Move blocking | Any non-optimal move (see caveat in §7.3) |
| 13 | Trend line | 3BV/s + accuracy + efficiency |
| 14 | Backup | Export/import, then cloud sync |
| 15 | Pattern ordering | Derived from tier, frequency, proof depth |

---

## §4.2 Presets (replaces)

| Preset | Dims | Mines | Density |
|---|---|---|---|
| Beginner | 9×9 | 10 | 12.3% |
| Intermediate | 16×16 | 40 | 15.6% |
| Expert | 30×16 | 99 | 20.6% |
| Custom | user | user | — |

The Ranked preset is gone. Expert under default settings *is* the minesweeper.online ranked
configuration — that is the point of the app, so it should not be a mode you have to opt into.

---

## §4.4 No-guess generation (amended)

No-guess is the default for **every preset**, not just competitive play. This promotes the
pre-generated pool from optimization to load-bearing infrastructure:

- Pool covers all four presets. Beginner and Intermediate accept in milliseconds; Expert is
  the only expensive one and deserves the deepest pool (~20 seeds; Beginner can hold 5).
- Refill on idle, pop on "new game", background top-up after every pop.
- If the Expert pool empties, show the generating state — never a frozen board.

**Guess boards** remain available behind a settings toggle. When enabled, generation skips
the solver check entirely and is instant, so no pool is needed. Games played this way write
to a separate PB pool (§14.2) and are visually marked in history.

---

## §4.5 Standard play rules (replaces "Ranked session rules")

These now govern all timed play, not a special mode:

- No-guess by default.
- No undo, no board reset mid-game.
- Result written to stats whether won or lost.

The "board hidden until the timer starts" rule is dropped — it only made sense as a
session-integrity measure for a ranked mode that no longer exists.

Learning mode (§P8) is the only surface where these relax.

---

## §7.3 Anti-frustration (replaces)

- **Chord safety warning:** on by default in learning mode and drills, off in timed play.
  A misflagged chord flashes instead of detonating when the warning is active.
- **Undo:** learning mode only, never in timed play.
- **Non-optimal move blocking (learning mode):** the move is rejected with a brief shake and
  the hint system offers a nudge.

> **Caveat that must be handled or learning mode will be infuriating.** "Optimal" is rarely
> unique. The HZiNi greedy algorithm picks one path among several of equal click cost, and
> its choice is arbitrary among ties. Blocking must therefore compare *cost*, not identity:
> reject a move only if it is **strictly worse** than the best available move by click count.
> All tied moves are accepted. Order of independent openings must never be penalised.

Blocking requires a solver call before every move, so learning mode pre-solves in a worker
on each state change and caches the result. Latency is acceptable here — it is the one mode
where §7.2's rules do not apply.

---

## §8.2 The coach (amended)

The coach runs **automatically on every completed game**, in a worker, immediately on game
end. Classification table is unchanged.

Live coaching — overlays, blocking, hints — appears only in learning mode and drills. Timed
play never invokes the solver mid-game.

---

## §8.4 Grade cache (NEW)

Coach output is cached, not recomputed on replay open.

```ts
interface CachedGrades {
  replayId: string
  v: 1                    // bump to invalidate on solver change
  grades: Array<{
    moveIndex: number
    class: CoachClass
    betterMove?: number
    deduction?: Deduction
    patternId?: string
    costClicks: number
    costMs: number
  }>
  summary: { accuracy: number; hesitationMs: number; clicksLost: number }
}
```

Roughly 3–8KB per expert game on top of the ~2KB replay. Ten thousand games sits well under
100MB, so **retention is unlimited — no pruning policy.**

The `v` field matters: any solver or coach change invalidates cached grades. Recompute lazily
on next open rather than migrating the whole history at once.

---

## §10 Pattern library (amended)

### 10.1 Teaching order, derived

Do not hand-author the order. Compute it:

1. **Prerequisites** — the existing DAG field; topological sort is the hard constraint.
2. **Frequency** — run the solver over ~5,000 generated expert boards, count which named
   patterns fire. Common before rare. This is a P7 tooling task built on the P1 solver, and
   it replaces folklore with data.
3. **Proof depth** — minimum witness count in the deduction. 1-1 is depth 2, 1-2-1 is depth
   3, tank endgames are deep. An objective difficulty number that falls out of the solver.

Sort: tier → frequency descending → depth ascending, subject to the prerequisite DAG.

### 10.2 Recommended next

Two inputs, shown as two distinct cards:

- **Next in course** — the derived order above, from your self-selected entry point.
- **Your weak spot** — highest **miss rate over a rolling window** of the last 20 games,
  where miss rate = misses ÷ opportunities and an opportunity is any position where the
  solver found that pattern available. Rate over a window rather than a raw count, so the
  suggestion decays as you improve instead of lagging behind your learning curve.

Suppress the weak-spot card below ~5 opportunities in the window — the sample is too small
to be a real signal.

Everything is browsable at any time. Self-select entry means an experienced player drops
straight into tier 2 without grinding "satisfied number."

### 10.3 Drill ladder

Format and gate advance together. Three rungs per pattern:

| Rung | Board | Gate to advance |
|---|---|---|
| 1. Recognition | Single position, one correct click | N correct in a row |
| 2. Flow | 8×8 mini board, pattern appears 2–3× | Speed target |
| 3. Application | Full preset board seeded with the pattern | Free practice, no gate |

Difficulty *within* a rung rises by adding decoys — near-miss shapes that do not apply —
then time pressure. Rung 3 is unlocked, not required; it exists for grinding.

A pattern is "learned" when rung 2 is cleared. That flag feeds the weak-spot logic: a
learned pattern with a rising miss rate gets re-suggested.

---

## §14 Home and history (NEW)

### 14.1 Home

Three zones, in order down the page:

1. **Personal bests** per preset, standard pool only, display type, tabular figures.
2. **Trend line** — 3BV/s, accuracy and efficiency over time. Three series, drawn from the
   canonical number palette (1 blue / 2 green / 3 red). Window selector: 20 / 100 / all games.
3. **New game** and **history** entry points.

### 14.2 PB pools

Four pools per preset: flag/no-flag × no-guess/guess. Only the standard pool
(flags allowed, no-guess) appears on home; the rest sit behind a filter on the stats screen,
or the display becomes unreadable.

### 14.3 History

Every game, unpruned, newest first. Each row: date, preset, time, 3BV/s, accuracy, result,
and a pool marker for non-standard settings.

Filters: preset, result, pool, and **by mistake class** — "show me every game with an
unnecessary guess" is the highest-value query here.

Any row opens the full replay: scrubber, solve ribbon, coach overlays, next-mistake jump.
Scrubbing to an arbitrary move must be instant, which it is — the board reconstructs from
the seed and the event log replays in microseconds.

---

## §15 Data portability (NEW)

**Phase A — export/import.** A single JSON file containing all replays, PBs, and curriculum
progress. Grades are excluded and recomputed on import, since they are derivable. Manual,
local, no account. This must ship before Android (§P9), because a Play Store install is
exactly where people lose local data.

**Phase B — cloud sync.** Google sign-in, last-write-wins per replay ID (replays are
append-only and immutable, so genuine conflicts only affect PBs and progress).

> Sync is the one feature that breaks "everything is local." It needs auth, a backend or
> Firebase, and a privacy policy for the Play listing. Treat it as its own phase after
> Android ships, and do not let it creep into earlier work.

---

## §12 Phases (revised)

| Phase | Content | Change |
|---|---|---|
| P0 | Scaffold | — |
| P1 | Engine: board, RNG, solver, metrics | — |
| P2 | Playable: canvas, input, control schemes | + chord safety toggle |
| P3 | Presets + no-guess pool | Pool now covers all presets; ranked removed |
| P4 | Replay capture, solve ribbon, **history screen** | History moved earlier |
| P5 | Coach: auto-run on game end, **grade cache**, overlays | Now automatic |
| P6 | Metric modes + comparison | — |
| P7 | Pattern library, **frequency instrumentation**, drill ladder | + derived ordering |
| P8 | Learning mode: blocking, hints, undo | — |
| P9 | Android via Capacitor | Preceded by export/import |
| P10 | Cloud sync | NEW |

---

## §13 Still open (revised)

**Resolved:** ranked session length (mode removed), chord safety default, no-flag PB tracking.

**Still open:**

1. **Long-press threshold** — 180ms is still a guess. Needs side-by-side device testing
   against The Clean One at P2.
2. **ZiNi greedy validation** — still needs published reference values for a few known
   boards to confirm the implementation matches community numbers. Blocks P1 acceptance.
3. **Drill speed targets** — the rung-2 gate needs concrete numbers, and they cannot be
   guessed. Instrument first: measure your own time-to-recognition on each pattern during
   normal play, set the gate at some percentile of that.
4. **Decoy generation** — placing a near-miss shape that genuinely does not apply, without
   accidentally making the board unsolvable, is a harder generation problem than placing the
   pattern itself. May need its own constraint-repair step.
5. **Cloud sync provider** — Firebase is fastest to build; a small self-hosted endpoint is
   cheaper long-term and avoids a dependency. Decide at P10, not before.
