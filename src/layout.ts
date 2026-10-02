// Maps the score onto the stage. The stage is the XZ ground plane: +X is time, -Z is "up the page"
// (higher staves are farther from the camera), +Y is up off the paper.

import type { Note, Score, VoiceId } from './score'

export interface Staff {
  voice: VoiceId
  /** diatonic step of the bottom line */
  base: number
  lines: number
  /** world z of the bottom line */
  z: number
}

export interface LayoutOptions {
  /** world units per sixteenth note */
  unit16: number
  /** world units per diatonic step (half the distance between staff lines) */
  step: number
  /** gap between staves, world units */
  gap: number
  /** note width as a fraction of the staff-line spacing (2 steps) */
  noteWidthFrac: number
  /** gap trimmed off each note's tail so repeated notes read as separate pills */
  tailGap: number
  /** height of a note's top surface, where performers land */
  noteTop: number
}

export const defaultLayout: LayoutOptions = {
  unit16: 0.16,
  step: 0.075,
  gap: 0.55,
  noteWidthFrac: 0.8,
  tailGap: 0.035,
  noteTop: 0.046
}

// Bottom-line step of each staff. Ranges (in steps): sparkle 49-53, lead 40-49, riff 32-38, bass 14-28.
const STAFF_BASE: Record<VoiceId, number> = {
  sparkle: 47,
  lead: 40,
  riff: 31,
  bass: 16
}

export class Layout {
  readonly opts: LayoutOptions
  readonly staves: Record<VoiceId, Staff>
  readonly score: Score

  constructor(score: Score, opts: Partial<LayoutOptions> = {}) {
    this.score = score
    this.opts = { ...defaultLayout, ...opts }
    const { step, gap } = this.opts
    const height = 8 * step
    // stack from the bass (nearest the camera) up the page
    const order: VoiceId[] = ['bass', 'riff', 'lead', 'sparkle']
    const staves = {} as Record<VoiceId, Staff>
    let z = 0.9
    for (const voice of order) {
      staves[voice] = { voice, base: STAFF_BASE[voice], lines: 5, z }
      z -= height + gap
    }
    this.staves = staves
  }

  /** note (pill) width in world units */
  get noteWidth() {
    return 2 * this.opts.step * this.opts.noteWidthFrac
  }

  get noteTop() {
    return this.opts.noteTop
  }

  /** note (pill) length in world units */
  noteLength(n: Note) {
    return Math.max(n.l * this.opts.unit16 - this.opts.tailGap, this.noteWidth)
  }

  /** world x of a position in sixteenths */
  x(s16: number) {
    return s16 * this.opts.unit16
  }

  /** world x of the playhead at time t */
  playheadX(t: number) {
    return this.x(this.score.pos(t))
  }

  /** world z of a diatonic step on a voice's staff */
  z(voice: VoiceId, step: number) {
    const staff = this.staves[voice]
    return staff.z - (step - staff.base) * this.opts.step
  }

  staffTopZ(voice: VoiceId) {
    return this.z(voice, this.staves[voice].base + 8)
  }

  staffCenterZ(voice: VoiceId) {
    return this.z(voice, this.staves[voice].base + 4)
  }

  /** center of a note's head (where a sprite lands) */
  noteHead(n: Note, radius: number) {
    return { x: this.x(n.s) + radius, z: this.z(n.v, n.step) }
  }

  /** ledger line steps needed for a note outside its staff */
  ledgers(n: Note): number[] {
    const { base } = this.staves[n.v]
    const top = base + 8
    const out: number[] = []
    for (let s = base - 2; s >= n.step; s -= 2) out.push(s)
    for (let s = top + 2; s <= n.step; s += 2) out.push(s)
    return out
  }
}
