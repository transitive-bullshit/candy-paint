// The cast: every performer in the video, built from the score's lines for a given chord mode.
// Shared by the looks and the tests so what's rendered is exactly what's verified.

import type { EntranceStyle } from './entrance'
import type { Layout } from './layout'
import { linesFor, type ChordMode } from './lines'
import { MOTION, SpriteMotion, type MotionParams } from './motion'
import { VOICE_ORDER, type Score, type VoiceId } from './score'

export interface Performer {
  voice: VoiceId
  /** 0 for a voice's main performer */
  line: number
  motion: SpriteMotion
}

export interface Cast {
  performers: Performer[]
  /** seconds a performer rides each note (by note index); drives the candy fill */
  ride: Map<number, number>
}

export function buildCast(
  score: Score,
  layout: Layout,
  mode: ChordMode,
  /** motion overrides for each voice's main performer (e.g. an earlier entrance) */
  overrides: Partial<Record<VoiceId, Partial<MotionParams>>> = {},
  /** how the riff's two performers enter the video and land the opening chord */
  entrance?: EntranceStyle
): Cast {
  const performers: Performer[] = []
  const mains = {} as Record<VoiceId, SpriteMotion>
  // lead before sparkle, so in budding mode the sparkle can split off the lead
  const order: VoiceId[] = ['lead', 'riff', 'bass', 'sparkle']
  for (const voice of order) {
    const lines = linesFor(score, voice, mode)
    lines.forEach((line, k) => {
      const base = MOTION[voice]
      let home: SpriteMotion | undefined
      if (mode === 'bud')
        home =
          k > 0 ? mains[voice] : voice === 'sparkle' ? mains.lead : undefined
      const motion = new SpriteMotion(score, layout, voice, line.events, {
        home,
        slot: k,
        entrance:
          entrance && voice === 'riff' && k < 2
            ? { style: entrance, partner: k }
            : undefined,
        params:
          k > 0 ? { radius: base.radius * 0.82 } : (overrides[voice] ?? {})
      })
      if (k === 0) mains[voice] = motion
      performers.push({ voice, line: k, motion })
    })
  }
  performers.sort(
    (a, b) =>
      VOICE_ORDER.indexOf(a.voice) - VOICE_ORDER.indexOf(b.voice) ||
      a.line - b.line
  )

  const ride = new Map<number, number>()
  for (const p of performers) {
    p.motion.events.forEach((e, i) => {
      // every note this performer lands on fills at the pace of its ride
      for (const n of e.notes)
        ride.set(n.index, n === e.target ? p.motion.rideTime(i) : n.d)
    })
  }
  return { performers, ride }
}
