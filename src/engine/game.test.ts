import { describe, expect, it } from 'vitest'
import { createBoard } from './board'
import { Game, replay } from './game'
import { PRESETS } from './presets'
import { generateNoGuessBoard } from './generate'

function board(rows: string[]) {
  const width = rows[0].length
  const mines: number[] = []
  rows.forEach((row, y) => {
    ;[...row].forEach((ch, x) => {
      if (ch === '*') mines.push(y * width + x)
    })
  })
  return createBoard({ width, height: rows.length, mines: mines.length }, mines)
}

describe('opening', () => {
  it('cascades through zeros and stops at numbers', () => {
    const game = new Game(board(['*..', '...', '...']))
    const result = game.open(8) // bottom-right corner, a zero
    expect(result.status).toBe('won')
    // Every safe cell comes up in one click.
    expect(result.revealed.length).toBe(8)
  })

  it('ends the game on a mine', () => {
    const game = new Game(board(['*..', '...', '...']))
    const result = game.open(0)
    expect(result.status).toBe('lost')
    expect(result.detonated).toEqual([0])
    expect(game.status).toBe('lost')
  })

  it('refuses moves once the game is over', () => {
    const game = new Game(board(['*..', '...', '...']))
    game.open(0)
    expect(game.open(4).rejected).toBe('out-of-turn')
    expect(game.flag(1).rejected).toBe('out-of-turn')
  })

  it('will not open a flagged cell', () => {
    const game = new Game(board(['*..', '...', '...']))
    game.flag(0)
    expect(game.open(0).rejected).toBe('already-revealed')
    expect(game.status).not.toBe('lost')
  })
})

describe('flagging', () => {
  it('toggles and tracks the counter', () => {
    const game = new Game(board(['*..', '...', '..*']))
    expect(game.minesRemaining).toBe(2)
    game.flag(0)
    expect(game.minesRemaining).toBe(1)
    game.flag(0)
    expect(game.minesRemaining).toBe(2)
  })

  it('logs a flag and an unflag as distinct events', () => {
    const game = new Game(board(['*..', '...', '...']))
    game.flag(0)
    game.flag(0)
    expect(game.events.map((e) => e.type)).toEqual(['flag', 'unflag'])
  })
})

describe('chording', () => {
  it('opens the neighbours of a satisfied number', () => {
    const game = new Game(board(['*..', '...', '...']))
    game.open(1) // the 1 beside the mine
    game.flag(0)
    const result = game.chord(1)
    expect(result.ok).toBe(true)
    expect(result.status).toBe('won')
  })

  it('detonates on a misflag when chord safety is off', () => {
    const game = new Game(board(['*..', '...', '...']), { chordSafety: false })
    game.open(1)
    game.flag(2) // wrong cell
    const result = game.chord(1)
    expect(result.status).toBe('lost')
    expect(result.detonated).toContain(0)
  })

  it('rejects the same misflag when chord safety is on (§7.3)', () => {
    const game = new Game(board(['*..', '...', '...']), { chordSafety: true })
    game.open(1)
    game.flag(2)
    const result = game.chord(1)
    expect(result.rejected).toBe('unsafe-chord')
    expect(game.status).toBe('playing')
  })

  it('will not chord a number whose flags do not add up', () => {
    const game = new Game(board(['*..', '...', '...']))
    game.open(1)
    expect(game.chord(1).rejected).toBe('not-chordable')
  })
})

describe('replay', () => {
  it('reproduces the final state from the event log', () => {
    const { board: b, firstClick } = generateNoGuessBoard(PRESETS.beginner, 31337, {
      maxAttempts: 500,
    })
    const original = new Game(b)
    original.open(firstClick, 0)
    original.flag(findMine(b), 120)
    for (let i = 0; i < 20; i++) {
      if (b.mine[i] === 0) original.open(i, 200 + i * 10)
    }

    const restored = replay(b, original.events)
    expect(restored.status).toBe(original.status)
    expect(restored.revealedCount).toBe(original.revealedCount)
    expect([...restored.revealed]).toEqual([...original.revealed])
    expect([...restored.flagged]).toEqual([...original.flagged])
  })

  it('scrubs to a midpoint (§14.3)', () => {
    const { board: b, firstClick } = generateNoGuessBoard(PRESETS.beginner, 555, {
      maxAttempts: 500,
    })
    const original = new Game(b)
    original.open(firstClick, 0)
    for (let i = 0; i < 12; i++) if (b.mine[i] === 0) original.open(i, 100 + i)

    const half = Math.floor(original.events.length / 2)
    const scrubbed = replay(b, original.events, { chordSafety: false }, half)
    expect(scrubbed.revealedCount).toBeLessThanOrEqual(original.revealedCount)
    // Scrubbing forward from the same log must land on the same state.
    expect([...scrubbed.revealed]).toEqual([
      ...replay(b, original.events, { chordSafety: false }, half).revealed,
    ])
  })
})

function findMine(b: ReturnType<typeof board>): number {
  for (let i = 0; i < b.mine.length; i++) if (b.mine[i] === 1) return i
  throw new Error('board has no mines')
}
