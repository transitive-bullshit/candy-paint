// The director: the storyboard as data. Each shot is a camera framing anchored to a bar of the
// song; the camera eases between shots (or cuts, on the drops), always tracking the playhead.
// Everything is a pure function of song time, like the rest of the engine.

import type { EntranceStyle } from './entrance'
import type { Layout } from './layout'
import type { Score, VoiceId } from './score'

/** what the camera looks at: a staff, or the space between two */
export type Focus = VoiceId | 'mid' | 'low' | 'all' | 'high'

export interface Framing {
  focus: Focus
  /** look-at point ahead of the playhead (world units; negative looks back at what's been played) */
  ahead: number
  /** distance from the look-at point */
  dist: number
  /** degrees around the vertical axis; 0 = straight in from the front of the page, -90 = from the past */
  azimuth: number
  /** degrees above the page */
  elevation: number
  fov: number
  /** depth of field: in-focus range around the look-at point */
  range: number
  /** shift the look-at point across the staves (world z), to make room in the frame */
  pan: number
  /** height of the look-at point above the page */
  height: number
  /**
   * 1 tracks the playhead; 0 holds the camera still on a fixed spot (`ahead` is then an absolute
   * x). Easing between the two starts or stops the camera's travel with a slow in or out.
   */
  track: number
}

export interface Shot {
  id: string
  /** bar where this framing is reached (0-indexed bars, fractional allowed) */
  bar: number
  framing: Framing
  /** hard cut into this framing instead of easing from the previous one */
  cut?: boolean
}

export interface StoryBeat {
  bars: [number, number]
  title: string
  /** what's happening in the music */
  music: string
  /** what the camera and the performers do */
  picture: string
  /** song time (s) for the storyboard frame */
  frame: number
}

const F = (
  focus: Focus,
  dist: number,
  azimuth: number,
  elevation: number,
  fov: number,
  range: number,
  ahead = 0.35,
  pan = 0,
  height = 0.03,
  track = 1
): Framing => ({
  focus,
  ahead,
  dist,
  azimuth,
  elevation,
  fov,
  range,
  pan,
  height,
  track
})

/** the three drops: bass and sparkle arrive, everyone lands together */
export const DROPS = [12, 44, 72]

export const SHOTS: Shot[] = [
  // intro: the riff alone, close and low in the dark
  { id: 'intro', bar: -0.3, framing: F('riff', 2.0, -50, 6, 24, 0.7, 0.25) },
  {
    id: 'intro-drift',
    bar: 3.4,
    framing: F('riff', 2.7, -42, 10, 24, 0.9, 0.3)
  },
  // hook I: the lead drops in; rise to frame lead and riff together
  { id: 'hook1', bar: 5, framing: F('mid', 3.7, -40, 14, 23, 1.1) },
  { id: 'hook1-hold', bar: 8, framing: F('mid', 4.1, -36, 15, 23, 1.2) },
  // the bass appears high above and charges: pull back to reveal it
  { id: 'hook1-reveal', bar: 11, framing: F('low', 5.8, -44, 19, 24, 1.6) },
  // anticipation: the camera inhales on the last beat before the drop
  { id: 'hook1-inhale', bar: 11.85, framing: F('low', 6.6, -46, 22, 24, 1.8) },
  // drop I: cut in close and low as everyone lands
  { id: 'drop1', bar: 12, cut: true, framing: F('low', 4.3, -30, 12, 30, 1.6) },
  { id: 'drop1-cruise', bar: 16, framing: F('all', 5.4, -52, 19, 28, 2.0) },
  { id: 'drop1-out', bar: 19.6, framing: F('all', 5.8, -58, 21, 27, 2.2) },
  // verse I: intimate and low, telephoto, close to the paint
  { id: 'verse1', bar: 20.4, framing: F('lead', 3.4, -62, 8, 20, 0.8) },
  { id: 'verse1-rack', bar: 25, framing: F('mid', 3.6, -52, 10, 20, 0.9) },
  { id: 'verse1-late', bar: 31, framing: F('mid', 3.9, -46, 12, 21, 1.0) },
  // pre-hook: rise and pull back, tension
  { id: 'prehook1', bar: 35.8, framing: F('mid', 5.0, -36, 22, 24, 1.4) },
  // hook II build: a graphic, high angle on the left hand's walk-up
  { id: 'hook2', bar: 37, framing: F('all', 6.2, -22, 36, 27, 2.6) },
  { id: 'hook2-inhale', bar: 43.85, framing: F('all', 7.0, -24, 40, 27, 2.8) },
  // drop II: cut low and fast alongside the staves
  {
    id: 'drop2',
    bar: 44,
    cut: true,
    framing: F('low', 3.1, -74, 6, 32, 1.2, 0.5)
  },
  {
    id: 'drop2-cruise',
    bar: 48,
    framing: F('low', 3.5, -60, 9, 30, 1.3, 0.45)
  },
  { id: 'drop2-out', bar: 51.6, framing: F('mid', 3.9, -50, 11, 26, 1.2) },
  // verse II: calm, then crane up the page to meet the new high motif at bar 56
  { id: 'verse2', bar: 52.6, framing: F('mid', 4.0, -40, 14, 22, 1.1) },
  {
    id: 'verse2-motif',
    bar: 56.2,
    framing: F('high', 3.7, -30, 25, 22, 1.0, 0.3)
  },
  {
    id: 'verse2-motif-hold',
    bar: 59.2,
    framing: F('high', 3.9, -34, 23, 22, 1.1, 0.3)
  },
  // pre-hook II
  { id: 'prehook2', bar: 61, framing: F('mid', 4.6, -45, 16, 24, 1.2) },
  // hook III: a slow push in from wide, building to the last drop
  { id: 'hook3', bar: 64.5, framing: F('all', 5.8, -38, 20, 25, 2.0) },
  { id: 'hook3-push', bar: 71.4, framing: F('mid', 4.2, -40, 17, 25, 1.4) },
  { id: 'hook3-inhale', bar: 71.85, framing: F('mid', 4.8, -42, 20, 25, 1.6) },
  // drop III: the fullest: cut wide and high, then a slow orbit
  { id: 'drop3', bar: 72, cut: true, framing: F('all', 7.0, -42, 26, 30, 2.6) },
  { id: 'drop3-orbit', bar: 79.6, framing: F('all', 7.4, -64, 30, 30, 2.8) },
  // outro: the riff alone again, close, mirroring the intro
  { id: 'outro', bar: 80.6, framing: F('riff', 3.0, -46, 12, 24, 1.0, 0.3) },
  {
    id: 'outro-hold',
    bar: 81.6,
    framing: F('riff', 3.4, -40, 15, 24, 1.1, 0.2)
  },
  // the reveal: rise off the paper and swing around to look back down the whole painted song
  // the score slides to the right half of the frame, leaving the left side for the end credits
  { id: 'reveal', bar: 85.0, framing: F('all', 17, 92, 34, 36, 60, -12, 2.7) }
]

/**
 * Held framings for each intro entrance (ahead is an absolute x while held): where the riff's two
 * performers are on frame 0 and the path they take to the opening chord.
 */
const OPENINGS: Record<EntranceStyle, Framing> = {
  arc: F('riff', 1.75, -48, 9, 26, 0.6, -0.48, -0.05, 0.2, 0),
  skip: F('riff', 1.9, -45, 8, 27, 0.7, -0.45, -0.05, 0.1, 0)
}

/**
 * The same storyboard recomposed for 9:16. In a tall frame the camera mostly sits behind the
 * playhead looking down the score, so time recedes up the screen and performers hop toward the
 * top; full-ensemble moments go high so all four staves fit across the narrow width. Same beats
 * and bars as SHOTS, same cuts on the drops.
 */
export const VERTICAL_SHOTS: Shot[] = [
  { id: 'intro', bar: -0.3, framing: F('riff', 2.4, -82, 13, 40, 1.0, 0.5) },
  {
    id: 'intro-drift',
    bar: 3.4,
    framing: F('riff', 2.8, -78, 15, 40, 1.1, 0.5)
  },
  { id: 'hook1', bar: 5, framing: F('mid', 4.2, -74, 24, 42, 1.4, 0.6) },
  { id: 'hook1-hold', bar: 8, framing: F('mid', 4.6, -72, 26, 42, 1.5, 0.6) },
  {
    id: 'hook1-reveal',
    bar: 11,
    framing: F('low', 6.0, -70, 34, 44, 2.0, 0.7)
  },
  {
    id: 'hook1-inhale',
    bar: 11.85,
    framing: F('low', 6.8, -70, 38, 44, 2.2, 0.7)
  },
  {
    id: 'drop1',
    bar: 12,
    cut: true,
    framing: F('low', 4.6, -84, 18, 46, 1.8, 0.8)
  },
  {
    id: 'drop1-cruise',
    bar: 16,
    framing: F('all', 7.6, -72, 44, 44, 2.6, 0.8)
  },
  { id: 'drop1-out', bar: 19.6, framing: F('all', 8.0, -76, 46, 44, 2.8, 0.8) },
  { id: 'verse1', bar: 20.4, framing: F('lead', 2.6, -84, 12, 38, 0.9, 0.5) },
  { id: 'verse1-rack', bar: 25, framing: F('mid', 3.2, -80, 16, 40, 1.0, 0.5) },
  { id: 'verse1-late', bar: 31, framing: F('mid', 3.6, -76, 18, 40, 1.1, 0.5) },
  { id: 'prehook1', bar: 35.8, framing: F('mid', 5.0, -72, 30, 42, 1.6, 0.6) },
  { id: 'hook2', bar: 37, framing: F('all', 7.0, -60, 55, 44, 3.0, 0.6) },
  {
    id: 'hook2-inhale',
    bar: 43.85,
    framing: F('all', 7.8, -60, 58, 44, 3.2, 0.6)
  },
  {
    id: 'drop2',
    bar: 44,
    cut: true,
    framing: F('low', 3.0, -88, 8, 48, 1.4, 0.9)
  },
  {
    id: 'drop2-cruise',
    bar: 48,
    framing: F('low', 3.6, -84, 12, 46, 1.5, 0.8)
  },
  { id: 'drop2-out', bar: 51.6, framing: F('mid', 4.0, -80, 16, 42, 1.4, 0.6) },
  { id: 'verse2', bar: 52.6, framing: F('mid', 4.0, -78, 20, 40, 1.2, 0.5) },
  {
    id: 'verse2-motif',
    bar: 56.2,
    framing: F('high', 3.6, -80, 26, 40, 1.1, 0.5)
  },
  {
    id: 'verse2-motif-hold',
    bar: 59.2,
    framing: F('high', 3.8, -78, 26, 40, 1.2, 0.5)
  },
  { id: 'prehook2', bar: 61, framing: F('mid', 4.6, -74, 24, 42, 1.4, 0.6) },
  { id: 'hook3', bar: 64.5, framing: F('all', 7.2, -72, 42, 44, 2.6, 0.7) },
  {
    id: 'hook3-push',
    bar: 71.4,
    framing: F('mid', 4.6, -76, 26, 42, 1.6, 0.6)
  },
  {
    id: 'hook3-inhale',
    bar: 71.85,
    framing: F('mid', 5.2, -76, 30, 42, 1.8, 0.6)
  },
  {
    id: 'drop3',
    bar: 72,
    cut: true,
    framing: F('all', 8.2, -68, 50, 46, 3.0, 0.8)
  },
  {
    id: 'drop3-orbit',
    bar: 79.6,
    framing: F('all', 8.6, -86, 56, 46, 3.2, 0.8)
  },
  { id: 'outro', bar: 80.6, framing: F('riff', 3.0, -82, 14, 40, 1.0, 0.4) },
  {
    id: 'outro-hold',
    bar: 81.6,
    framing: F('riff', 3.4, -78, 18, 40, 1.1, 0.3)
  },
  // looking back down the song from past its end: the near part of the frame is empty lacquer,
  // which leaves the lower half for the credits
  { id: 'reveal', bar: 85.0, framing: F('all', 15, 92, 42, 40, 60, -14) }
]

const VERTICAL_OPENINGS: Record<EntranceStyle, Framing> = {
  arc: F('riff', 2.0, -84, 12, 40, 0.8, -0.4, 0, 0.14, 0),
  skip: F('riff', 2.9, -80, 14, 42, 1.0, -0.4, 0, 0.12, 0)
}

export const STORY: StoryBeat[] = [
  {
    bars: [0, 4],
    title: 'Intro',
    music:
      'The riff alone: the A to E arpeggio loop, with held notes under it.',
    picture:
      "Frame 0 is the title over the riff's two performers skipping in across the lacquer like stones; they land the opening chord together at 0:00.70. The title holds while the camera starts following them, then is left behind. Close on the riff through the intro: one performer skates the held notes while its partner plays the other part.",
    frame: 0
  },
  {
    bars: [4, 12],
    title: 'Hook I',
    music:
      'The lead enters with the falling hook melody. The left hand is still silent.',
    picture:
      'The lead drops in on the downbeat; the camera rises to hold lead and riff. From bar 8 the bass performer hangs high above the score, glowing brighter as the drop nears. Pull back to reveal it.',
    frame: 27.6
  },
  {
    bars: [12, 20],
    title: 'Drop I',
    music:
      'Left-hand octaves arrive like an 808, and the melody doubles at the octave.',
    picture:
      'Everyone winds up on the last beat and dives in together. Hard cut close and low, camera punch, shockwave across the lacquer. The sparkle buds off the lead. Then a slow cruise out to all four staves.',
    frame: 33.05
  },
  {
    bars: [20, 32],
    title: 'Verse I',
    music: 'The lead turns to repeated notes; the bass walks single roots.',
    picture:
      'Telephoto, low, close to the paint, with the lead in focus and the bass soft in the foreground. Racks down to the riff and bass halfway through.',
    frame: 64.3
  },
  {
    bars: [32, 36],
    title: 'Pre-hook',
    music: 'The verse winds down into the second hook.',
    picture: 'The camera rises and pulls back. Tension before the build.',
    frame: 93.0
  },
  {
    bars: [36, 44],
    title: 'Hook II',
    music:
      'The left hand walks up E, G#, A into every bar, so this hook climbs from the start.',
    picture:
      'A high, graphic angle that reads the structure. The bass performer rides its held E while a bud plays the walk-up.',
    frame: 104.6
  },
  {
    bars: [44, 52],
    title: 'Drop II',
    music: 'The full hook again.',
    picture:
      'Hard cut low and fast, almost alongside the staves, so the performers rush past the lens. A second shockwave.',
    frame: 118.6
  },
  {
    bars: [52, 60],
    title: 'Verse II',
    music:
      'The one new idea in the song: a high E, D#, C#, B motif from bar 57.',
    picture:
      'Calm, then the camera cranes up the page to meet the motif as the lead climbs.',
    frame: 152.0
  },
  {
    bars: [60, 64],
    title: 'Pre-hook',
    music: 'Into the last hook.',
    picture: 'Back down and wider, settling.',
    frame: 163.5
  },
  {
    bars: [64, 72],
    title: 'Hook III',
    music: 'Soft hook, then the walk-up build.',
    picture:
      'A slow push in from wide, closer and closer, then an inhale on the last beat.',
    frame: 186.0
  },
  {
    bars: [72, 80],
    title: 'Drop III',
    music: 'The fullest statement of the hook.',
    picture:
      'Cut wide and high for the biggest shockwave, then a slow orbit over the whole cast.',
    frame: 196.2
  },
  {
    bars: [80, 83],
    title: 'Outro',
    music: 'The riff alone again, then the piano rings out.',
    picture:
      'Close on the riff, mirroring the intro. Then the camera rises off the paper and swings around to look back down the song: every painted note relights like a city at night, and it fades to black with the last ring.',
    frame: 229.0
  }
]

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const smooth = (s: number) => s * s * (3 - 2 * s)
const smoother = (s: number) => s * s * s * (s * (s * 6 - 15) + 10)
const lerp = (a: number, b: number, s: number) => a + (b - a) * s

export interface CameraState {
  position: [number, number, number]
  target: [number, number, number]
  fov: number
  range: number
  /** 0..1 fade from/to black */
  fade: number
  /** fog density */
  fog: number
  /** multiplier on the painted notes' afterglow */
  ember: number
  /** bloom intensity */
  bloom: number
  /** 0..1 strength of the drop shockwave, with its age in seconds */
  shock: { age: number; strength: number } | null
}

export class Director {
  private readonly score: Score
  private readonly layout: Layout

  private readonly shots: Shot[]

  /**
   * @param entrance with an intro entrance, open on the riff's performers (a held framing that
   * suits how they enter), then follow them closely through the intro before the hook
   */
  /**
   * @param entrance with an intro entrance, open on the riff's performers (a held framing that
   * suits how they enter), then follow them closely through the intro before the hook
   * @param vertical compose for a 9:16 frame (VERTICAL_SHOTS) instead of 16:9
   */
  constructor(
    score: Score,
    layout: Layout,
    entrance?: EntranceStyle,
    vertical = false
  ) {
    this.score = score
    this.layout = layout
    const shots = vertical ? VERTICAL_SHOTS : SHOTS
    if (!entrance) {
      this.shots = shots
      return
    }
    this.shots = [
      {
        id: `enter-${entrance}`,
        bar: -0.27,
        framing: (vertical ? VERTICAL_OPENINGS : OPENINGS)[entrance]
      },
      // the camera starts to travel once they've landed, and stays close on the riff
      {
        id: 'follow-land',
        bar: 0.3,
        framing: vertical
          ? F('riff', 2.3, -82, 13, 40, 0.9, 0.4)
          : F('riff', 1.5, -44, 11, 24, 0.5, 0.12)
      },
      {
        id: 'follow-track',
        bar: 2.6,
        framing: vertical
          ? F('riff', 2.6, -80, 14, 40, 1.0, 0.45)
          : F('riff', 1.9, -40, 12, 24, 0.6, 0.15)
      },
      ...shots.filter((s) => s.id !== 'intro' && s.id !== 'intro-drift')
    ]
  }

  private focusZ(f: Focus) {
    const L = this.layout
    const c = (v: VoiceId) => L.staffCenterZ(v)
    switch (f) {
      case 'mid':
        return (c('riff') + c('lead')) / 2
      case 'low':
        return (c('riff') + c('bass')) / 2 - 0.1
      case 'high':
        return (c('lead') + c('sparkle')) / 2 + 0.15
      case 'all':
        return (c('bass') + c('sparkle')) / 2
      default:
        return c(f)
    }
  }

  /** world x a framing looks at: ahead of the playhead when tracking, a fixed spot when held */
  private lookX(f: Framing, px: number) {
    return lerp(f.ahead, px + f.ahead, f.track)
  }

  /** the framing at time t (eased between shots, cuts jump), with the x it looks at */
  framing(t: number): Framing & { x: number } {
    const px = this.layout.playheadX(t)
    const bar = this.score.pos(t) / 16
    const shots = this.shots
    const i = shots.findIndex((s) => s.bar > bar)
    const hold = (f: Framing) => ({ ...f, x: this.lookX(f, px) })
    if (i === -1) return hold(shots.at(-1)!.framing)
    if (i === 0) return hold(shots[0]!.framing)
    const next = shots[i]!
    const prev = shots[i - 1]!
    if (next.cut) return hold(prev.framing)
    const s = smoother(clamp((bar - prev.bar) / (next.bar - prev.bar)))
    const a = prev.framing
    const b = next.framing
    return {
      focus: s < 0.5 ? a.focus : b.focus,
      ahead: lerp(a.ahead, b.ahead, s),
      dist: lerp(a.dist, b.dist, s),
      azimuth: lerp(a.azimuth, b.azimuth, s),
      elevation: lerp(a.elevation, b.elevation, s),
      fov: lerp(a.fov, b.fov, s),
      range: lerp(a.range, b.range, s),
      pan: lerp(a.pan, b.pan, s),
      height: lerp(a.height, b.height, s),
      track: lerp(a.track, b.track, s),
      // blend where each framing looks, so going from held to tracking is a slow start
      x: lerp(this.lookX(a, px), this.lookX(b, px), s)
    }
  }

  /** focus z, eased the same way as the framing so racks are smooth */
  private focusAt(t: number) {
    const bar = this.score.pos(t) / 16
    const shots = this.shots
    const i = shots.findIndex((s) => s.bar > bar)
    if (i <= 0)
      return this.focusZ(shots[i === -1 ? shots.length - 1 : 0]!.framing.focus)
    const next = shots[i]!
    const prev = shots[i - 1]!
    if (next.cut) return this.focusZ(prev.framing.focus)
    const s = smoother(clamp((bar - prev.bar) / (next.bar - prev.bar)))
    return lerp(
      this.focusZ(prev.framing.focus),
      this.focusZ(next.framing.focus),
      s
    )
  }

  /** @param impact scales the drops' punch-in and shake (1 = as storyboarded) */
  state(t: number, impact = 1): CameraState {
    const fr = this.framing(t)
    const target: [number, number, number] = [
      fr.x,
      fr.height,
      this.focusAt(t) + fr.pan
    ]
    const az = (fr.azimuth * Math.PI) / 180
    const el = (fr.elevation * Math.PI) / 180
    let position: [number, number, number] = [
      target[0] + fr.dist * Math.cos(el) * Math.sin(az),
      target[1] + fr.dist * Math.sin(el),
      target[2] + fr.dist * Math.cos(el) * Math.cos(az)
    ]
    let fov = fr.fov

    // drops: a punch in and a short, decaying shake
    let shock: CameraState['shock'] = null
    for (const d of DROPS) {
      const age = t - this.score.barTime(d)
      if (age < 0 || age > 2.5) continue
      shock = { age, strength: 1 }
      const k = Math.exp(-age / 0.28)
      fov -= 2.4 * k * impact
      const amp = 0.035 * k * impact
      position = [
        position[0] + amp * Math.sin(age * 41),
        position[1] + amp * Math.sin(age * 37 + 1.3),
        position[2] + amp * Math.sin(age * 29 + 2.1)
      ]
    }

    const dur = this.score.data.duration
    const fade =
      smooth(clamp(t / 0.6)) * (1 - smooth(clamp((t - (dur - 2.0)) / 1.9)))
    // the reveal: fog lifts and every painted note relights as the camera rises
    const reveal = smooth(clamp((t - this.score.barTime(82)) / 6))
    const inHook = DROPS.some((d) => {
      const bar = this.score.pos(t) / 16
      return bar >= d && bar < d + 8
    })
    return {
      position,
      target,
      fov,
      range: fr.range,
      fade,
      fog: lerp(0.07, 0.012, reveal),
      ember: lerp(1, 5, reveal),
      bloom: inHook ? 1.3 : 1.1,
      shock
    }
  }
}
