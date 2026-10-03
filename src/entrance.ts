// How the riff's two performers enter the video: on screen from frame 0 (they're in the
// thumbnail), and landing exactly on the opening chord. Pure functions of time, like all motion.
//
// - arc: fly in from off the left on an ordinary hop, the same arc they use everywhere else in the
//   song; already mid-flight on frame 0, the partner launching a moment later
// - skip: skip across the lacquer like stones, staggered, bounces shrinking into the chord

export type EntranceStyle = 'arc' | 'skip'

export const ENTRANCES: EntranceStyle[] = ['arc', 'skip']

export interface EntrancePose {
  x: number
  y: number
  z: number
  squash: number
  glow: number
  /** size relative to the performer's radius (for performers still forming) */
  size: number
}

interface Point {
  x: number
  y: number
  z: number
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const lerp = (a: number, b: number, s: number) => a + (b - a) * s
const smooth = (s: number) => s * s * (3 - 2 * s)
const easeInOutSine = (s: number) => 0.5 - 0.5 * Math.cos(Math.PI * s)

/**
 * @param partner 0 for the voice's main performer, 1 for its partner; partners are staggered
 * @param t song time, 0 <= t <= first onset
 * @param first the first onset, when the performer must touch down on `land`
 * @param surface height of a performer resting on the bare lacquer
 */
export function entrancePose(
  style: EntranceStyle,
  partner: number,
  t: number,
  first: number,
  land: Point,
  surface: number
): EntrancePose {
  const side = partner ? 1 : -1
  switch (style) {
    case 'arc': {
      // one long hop launched from off the left before the video starts (the partner a moment
      // later and from a little closer), shaped exactly like the performers' hops in the song:
      // horizontal slow in/out, a flat-topped arc for a long flight, a late drop into the beat
      const launch = -0.38 + 0.1 * partner
      const flight = first - launch
      const from = {
        x: land.x - 1.3 + 0.13 * partner,
        y: surface,
        z: land.z + 0.12 * side
      }
      const s = clamp((t - launch) / flight)
      const height = 0.19 + Math.abs(land.z - from.z) * 0.3
      const hang = 2 + clamp((flight - 0.12) / 0.2) * 1.6
      return {
        x: lerp(from.x, land.x, lerp(s, smooth(s), 0.35)),
        y: lerp(from.y, land.y, s) + height * (1 - Math.abs(2 * s - 1) ** hang),
        z: lerp(from.z, land.z, easeInOutSine(s)),
        squash: 0,
        glow: 0.55 + 0.25 * smooth(clamp((s - 0.7) / 0.3)),
        size: 1
      }
    }
    case 'skip': {
      // skipping across the lacquer from the left, already mid-skip on frame 0
      const head = 0.18 - 0.06 * partner
      const span = first * (1 + head)
      const u = clamp((t + first * head) / span)
      const contacts = [0, 0.45, 0.76, 1]
      const heights = [0.16, 0.1, 0.05]
      let k = 0
      while (k < 2 && u > contacts[k + 1]!) k++
      const c0 = contacts[k]!
      const c1 = contacts[k + 1]!
      const s = (u - c0) / (c1 - c0)
      // touches the bare lacquer on each skip, the last arc lands on the note itself
      const base = k < 2 ? surface : lerp(surface, land.y, s)
      const since = (u - c0) * span
      return {
        x: lerp(land.x - 1.2 - 0.15 * partner, land.x, u),
        y: base + heights[k]! * 4 * s * (1 - s),
        z: lerp(land.z + 0.15 * side, land.z, smooth(u)),
        squash: k > 0 ? 0.22 * Math.exp(-since / 0.05) : 0,
        glow: 0.8,
        size: 1
      }
    }
  }
}
