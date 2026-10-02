// The curated score (data/score.json) and time helpers. Everything downstream is a pure function
// of song time in seconds, so any frame can be rendered independently.

export type VoiceId = 'sparkle' | 'lead' | 'riff' | 'bass'

export const VOICE_ORDER: VoiceId[] = ['sparkle', 'lead', 'riff', 'bass']

export interface RawNote {
  /** MIDI pitch */
  p: number
  v: VoiceId
  /** onset, in sixteenths from bar 0 */
  s: number
  /** length, in sixteenths */
  l: number
  vel: number
  /** diatonic staff position in E major, counted from E0 (7 per octave) */
  step: number
}

export interface Section {
  id: string
  label: string
  start: number
  end: number
}

export interface ScoreData {
  title: string
  bpm: number
  t0: number
  sixteenth: number
  bars: number
  duration: number
  key: string
  sections: Section[]
  harmony: (string | null)[]
  /** one chord per bar: the IV-I loop, 'A' or 'E' */
  chords: string[]
  notes: RawNote[]
}

export interface Note extends RawNote {
  index: number
  /** onset in seconds */
  t: number
  /** duration in seconds */
  d: number
}

/** Notes of one voice that start together. A sprite lands on one chord per event. */
export interface NoteEvent {
  t: number
  s: number
  notes: Note[]
  /** the note the sprite lands on */
  target: Note
}

export class Score {
  readonly data: ScoreData
  readonly notes: Note[]
  readonly events: Record<VoiceId, NoteEvent[]>

  constructor(data: ScoreData) {
    this.data = data
    this.notes = data.notes.map((n, index) => ({
      ...n,
      index,
      t: this.time(n.s),
      d: n.l * data.sixteenth
    }))

    const events = {} as Record<VoiceId, NoteEvent[]>
    for (const voice of VOICE_ORDER) {
      const byOnset = new Map<number, Note[]>()
      for (const n of this.notes) {
        if (n.v !== voice) continue
        const group = byOnset.get(n.s)
        if (group) group.push(n)
        else byOnset.set(n.s, [n])
      }
      events[voice] = [...byOnset.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([s, notes]) => {
          // bass lands on its root (lowest), everything else on the top voice
          const sorted = [...notes].sort((a, b) => a.p - b.p)
          const target = voice === 'bass' ? sorted[0]! : sorted.at(-1)!
          return { t: this.time(s), s, notes: sorted, target }
        })
    }
    this.events = events
  }

  get sixteenth() {
    return this.data.sixteenth
  }

  get beat() {
    return this.data.sixteenth * 4
  }

  get bar() {
    return this.data.sixteenth * 16
  }

  /** seconds for a position in sixteenths */
  time(s16: number) {
    return this.data.t0 + s16 * this.data.sixteenth
  }

  /** position in sixteenths (fractional) for a time in seconds */
  pos(t: number) {
    return (t - this.data.t0) / this.data.sixteenth
  }

  barTime(bar: number) {
    return this.time(bar * 16)
  }

  sectionAt(t: number): Section {
    const bar = this.pos(t) / 16
    const { sections } = this.data
    return (
      sections.find((s) => bar >= s.start && bar < s.end) ??
      sections.at(bar < 0 ? 0 : -1)!
    )
  }
}

export async function loadScore(url = '/data/score.json'): Promise<Score> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`failed to load score: ${res.status}`)
  return new Score((await res.json()) as ScoreData)
}
