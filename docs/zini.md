# ZiNi and HZiNi as implemented

§13.2 leaves ZiNi parity with published community values open, and it blocks P1 acceptance.
That item cannot be closed by reasoning — it needs reference boards with known values. This
document exists so that when those numbers turn up, the comparison is a comparison and not an
argument about what the code was supposed to do.

Implementation: `src/engine/metrics.ts`.

## 3BV

Unambiguous, and every implementation agrees.

```
3BV = (number of 8-connected components of zero cells)
    + (number of safe non-zero cells not 8-adjacent to any zero cell)
```

No caveats. If this number ever disagrees with another tool, it is a bug here.

## ZiNi

ZiNi is defined by an algorithm, not by an optimum. "Fewest clicks to clear the board with
chording allowed" is a set-cover problem; nobody computes the true minimum. So the number
depends on the greedy, and two faithful implementations can differ on tie-breaking.

What this one does, each step, until every safe cell is open:

1. **Score every chord.** For a safe numbered cell `c`:
   - `cost` = 1 if `c` is still covered (a click to open it), plus one click per mine
     neighbour not yet flagged, plus 1 for the chord itself.
   - `gain` = covered safe cells the chord would uncover, counting whole openings, plus `c`
     itself if it was covered.
   - Chords that uncover nothing are discarded.
2. **Score the best plain click.** The covered safe cell whose single click uncovers the most
   — openings before isolated numbers. `cost` is 1.
3. **Take the higher `gain - cost`.** Ties go to the plain click.
4. Break-even chords are allowed. Requiring a strict saving stalls the greedy on its opening
   move: on a 3×3 with one central mine it returns 8 (clicking every cell) instead of 5.
5. Ties among chords break on larger `gain`, then lower cell index. Arbitrary, but fixed, so
   the number is deterministic.

Then, because a greedy is myopic and can occasionally finish *above* 3BV — nonsense for a
metric whose point is that chording saves clicks — the whole thing runs a second time with
chording disabled, and the shorter of the two lines is reported. The chord-free pass is
exactly the 3BV line, so `ZiNi <= 3BV` holds by construction rather than by luck.

### Where a disagreement would most likely come from

In rough order of likelihood:

1. **Tie-breaking.** Step 3 prefers the plain click; another implementation may prefer the
   chord. Both are defensible and they give different numbers.
2. **Break-even chords.** Step 4 takes them. An implementation requiring `gain > cost`
   produces larger values.
3. **The chord-free second pass.** Not part of any published description — it is a floor this
   implementation imposes. It only ever lowers the result, and only on boards where the
   greedy misbehaved.
4. **Flag cost.** Flags are counted as clicks here. A no-flag variant would not.

### Closing §13.2

Get published ZiNi values for a few known boards, encode each board as a mine layout in
`src/engine/metrics.test.ts` in the same ASCII form the other tests use, and assert the
value. If they disagree, work down the list above — item 1 first.

## HZiNi

ZiNi assumes a player who already knows where every mine is. HZiNi restricts each move to
what is actually deducible at the time:

- A covered cell may only be opened once the solver has proven it safe.
- A mine may only be flagged once the solver has proven it is a mine.
- A chord is available only when every mine neighbour is proven, since a player cannot flag
  what they have not worked out.

The solver re-runs after every move, which is why this is far slower than ZiNi and why
learning mode does it in a worker (§7.3).

`hzini()` returns `null` when the board cannot be cleared from the given first click without
a guess — there is no human-optimal click count for a board that needs one.

### HZiNi is not necessarily >= ZiNi

It is tempting to assert it, and the test suite deliberately does not. HZiNi solves a
strictly more constrained problem, so the inequality holds for the true optima — but both
numbers come from greedy approximations, and the constrained greedy sometimes stumbles into
a shorter line than the unconstrained one. Asserting the inequality tests the heuristics'
luck.

## What learning mode uses

§7.3 blocks a move only when it is **strictly worse by click count** than the best move
available. That comparison runs against HZiNi cost, never against move identity: the greedy
picks arbitrarily among tied moves, and rejecting a player for choosing a different tied move
— or for opening two independent regions in the other order — would make learning mode
infuriating.
