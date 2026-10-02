// Splits each voice into monophonic lines, the way a pianist's fingers divide a part: a line never
// has two notes sounding at once, so one performer per line can land on every note and stay on a
// held note for as long as it sounds. Line 0 is the voice's main line (its top note, or the root
// for the bass); other lines carry chord tones and notes struck while another is held.

import type { NoteEvent, Score, VoiceId } from './score'

export type ChordMode = 'single' | 'twins' | 'bud'

export interface Line {
  voice: VoiceId
  /** 0 is the main performer of the voice */
  index: number
  events: NoteEvent[]
}

/** overlaps shorter than this (in sixteenths) are treated as legato, not as a held note */
const LEGATO_TOLERANCE = 1

/** how many performers a voice may split into; past this, the longest-held note is let go early */
export const MAX_LINES: Record<VoiceId, number> = {
  riff: 3,
  lead: 2,
  bass: 2,
  sparkle: 1
}

export function separateLines(score: Score, voice: VoiceId): Line[] {
  const lines: { end: number; pitch: number; events: NoteEvent[] }[] = []
  for (const group of score.events[voice]) {
    // main line takes the top note (the root for the bass); the rest fill in by proximity
    const order =
      voice === 'bass' ? [...group.notes] : [...group.notes].reverse()
    const used: number[] = []
    for (const n of order) {
      const free = lines
        .map((line, i) => ({ line, i }))
        .filter(
          ({ line, i }) =>
            !used.includes(i) && line.end - LEGATO_TOLERANCE <= n.s
        )
      let pick: number | undefined
      if (!used.length && free.some((f) => f.i === 0)) pick = 0
      else if (free.length) {
        // always the lowest free line: bud k then exists exactly while the voice needs k+1
        // performers, so a bud only idles (and merges back) when the music thins out, instead of
        // two buds trading notes and taking turns merging
        pick = Math.min(...free.map((f) => f.i))
      } else if (lines.length < MAX_LINES[voice]) {
        lines.push({ end: 0, pitch: n.p, events: [] })
        pick = lines.length - 1
      } else {
        // every finger is busy: the one that has held its note longest lets go (its performer
        // leaves that note early, since a line's ride always ends before its next onset)
        const busy = lines
          .map((line, i) => ({ line, i }))
          .filter(({ i }) => !used.includes(i))
        pick = busy.reduce<number | undefined>(
          (best, f) =>
            best === undefined ||
            f.line.events.at(-1)!.s < lines[best]!.events.at(-1)!.s
              ? f.i
              : best,
          undefined
        )
      }
      if (pick === undefined) {
        // more chord tones than performers: struck by the first performer's landing
        lines[used[0]!]!.events.at(-1)!.notes.push(n)
        continue
      }
      const line = lines[pick]!
      line.events.push({ t: n.t, s: n.s, notes: [n], target: n })
      line.end = n.s + n.l
      line.pitch = n.p
      used.push(pick)
    }
  }
  return lines.map((line, index) => ({ voice, index, events: line.events }))
}

/** One line per voice that lands on each chord's target note (the original single-performer model). */
export function singleLines(score: Score, voice: VoiceId): Line[] {
  return [{ voice, index: 0, events: score.events[voice] }]
}

export function linesFor(
  score: Score,
  voice: VoiceId,
  mode: ChordMode
): Line[] {
  return mode === 'single'
    ? singleLines(score, voice)
    : separateLines(score, voice)
}
