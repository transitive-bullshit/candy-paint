import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { Layout } from '../src/layout'
import { buildCast } from '../src/cast'
import { Score, VOICE_ORDER, type ScoreData, type VoiceId } from '../src/score'

// A tiny synthetic score: quick hops, a long rest, and a chord, for every voice.
function fixture(): ScoreData {
  const notes: ScoreData['notes'] = []
  const steps: Record<VoiceId, number> = {
    sparkle: 50,
    lead: 44,
    riff: 35,
    bass: 17
  }
  for (const v of VOICE_ORDER) {
    for (const s of [0, 1, 2, 4, 8, 40, 41])
      notes.push({ p: 60, v, s, l: 1, vel: 64, step: steps[v] + (s % 3) })
    notes.push({ p: 64, v, s: 41, l: 2, vel: 64, step: steps[v] + 5 })
  }
  return {
    title: 'fixture',
    bpm: 90,
    t0: 0.5,
    sixteenth: 60 / 90 / 4,
    bars: 4,
    duration: 12,
    key: 'E major',
    sections: [{ id: 'all', label: 'All', start: 0, end: 4 }],
    harmony: [],
    chords: ['A', 'E', 'A', 'E'],
    notes
  }
}

function checkScore(score: Score) {
  const layout = new Layout(score)
  for (const mode of ['single', 'twins', 'bud'] as const) {
    const { performers } = buildCast(score, layout, mode)
    const landed = new Set<number>()
    for (const { voice, line, motion } of performers) {
      const r = motion.params.radius
      motion.events.forEach((e) => {
        // the performer touches down exactly on the onset, on the head of the note it plays
        const p = motion.pose(e.t)
        const n = e.target
        expect(p.x).toBeCloseTo(layout.x(n.s) + layout.noteWidth / 2, 6)
        expect(p.y).toBeCloseTo(layout.noteTop + r * 0.92, 6)
        expect(p.z).toBeCloseTo(layout.z(n.v, n.step), 6)
        expect(p.visible).toBeGreaterThan(0.5)
        for (const struck of e.notes) landed.add(struck.index)
      })
      // no teleports: at 240 fps a performer never moves more than a short hop per frame
      const first = motion.events[0]!.t - motion.params.entryLead
      const last = motion.events.at(-1)!.t + 2
      let prev = motion.pose(first)
      for (let t = first; t < last; t += 1 / 240) {
        const p = motion.pose(t)
        const step = Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z)
        expect(
          step,
          `${mode} ${voice}#${line} jumped ${step.toFixed(3)} at t=${t.toFixed(3)}`
        ).toBeLessThan(0.12)
        prev = p
      }
    }
    // a bud keeps its identity through short gaps: it only merges back into its home (and so
    // disappears inside it) when it has nothing to play for longer than the merge window
    const merged: string[] = []
    for (const { motion } of mode === 'bud' ? performers : []) {
      if (!motion.home) continue
      motion.events.slice(0, -1).forEach((e, i) => {
        const next = motion.events[i + 1]!
        const idle = next.t - e.t - Math.min(e.target.d, next.t - e.t)
        if (idle > motion.params.mergeWindow) return
        for (let k = 1; k < 8; k++) {
          const t = e.t + ((next.t - e.t) * k) / 8
          if (motion.pose(t).visible <= 0.5)
            merged.push(
              `${motion.voice} during a ${idle.toFixed(2)}s gap at t=${t.toFixed(2)}`
            )
        }
      })
    }
    expect(merged).toEqual([])

    // every note is struck by some performer's landing
    expect(landed.size).toBe(score.notes.length)
  }
}

describe('sprite motion', () => {
  it('lands on every onset and moves continuously (fixture)', () => {
    expect(() => checkScore(new Score(fixture()))).not.toThrow()
  })

  // the real score is derived from the (uncommitted) audio, so this runs only where it exists
  it('lands on every onset and moves continuously (song)', ({ skip }) => {
    if (!existsSync('data/score.json')) skip()
    const data = JSON.parse(
      readFileSync('data/score.json', 'utf8')
    ) as ScoreData
    expect(() => checkScore(new Score(data))).not.toThrow()
  }, 60_000)
})
