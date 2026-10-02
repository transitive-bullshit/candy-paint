// Sprite choreography. Each line of each voice has one performer that travels note to note,
// landing exactly on every onset. Motion is a pure function of time and follows the classic
// principles: anticipation (a crouch before take-off, a wind-up before entrances), arcs that scale
// with the flight, hang time at the apex, a fast fall into the beat, squash on impact with
// follow-through, and secondary action (breathing on the beat while waiting through rests).
//
// Held notes are ridden: the performer skates along the note at the leading edge of its candy
// fill, so the fill always has someone pushing it, then hops off the tail to the next note.
// A performer can also have a home (another performer): it then docks inside its home while idle
// and buds off it to play, which is how one voice splits for chords and held notes.

import type { Layout } from './layout'
import type { NoteEvent, Score, VoiceId } from './score'

export interface MotionParams {
  radius: number
  /** hop apex height: base + perSec * flight time, clamped to max */
  hopBase: number
  hopPerSec: number
  hopMax: number
  /** silence after a note longer than this (seconds) makes the sprite leave the paper and hover */
  restGap: number
  /** a bud only merges back into its home when it has nothing to play for this long (seconds) */
  mergeWindow: number
  /**
   * merge only once the home performer settles (onto a held note of a beat or more, or a rest),
   * never while it's mid-run; and if it doesn't settle before the bud is needed, stay split
   */
  settleToMerge: boolean
  hoverY: number
  /** how far ahead of the playhead the sprite hovers */
  hoverLead: number
  /** seconds before the first note that the sprite appears */
  entryLead: number
  /** squash strength on impact */
  impact: number
}

export const MOTION: Record<VoiceId, MotionParams> = {
  lead: {
    radius: 0.05,
    hopBase: 0.05,
    hopPerSec: 0.3,
    hopMax: 0.32,
    restGap: 0.9,
    mergeWindow: 2.6,
    settleToMerge: false,
    hoverY: 0.38,
    hoverLead: 0.22,
    entryLead: 2.67,
    impact: 0.34
  },
  riff: {
    radius: 0.042,
    hopBase: 0.04,
    hopPerSec: 0.26,
    hopMax: 0.26,
    restGap: 0.9,
    mergeWindow: 2.6,
    settleToMerge: false,
    hoverY: 0.3,
    hoverLead: 0.18,
    entryLead: 0.7,
    impact: 0.3
  },
  bass: {
    radius: 0.075,
    hopBase: 0.035,
    hopPerSec: 0.34,
    hopMax: 0.4,
    restGap: 1.1,
    mergeWindow: 2.6,
    settleToMerge: true,
    hoverY: 0.62,
    hoverLead: 0.26,
    entryLead: 10.67,
    impact: 0.48
  },
  sparkle: {
    radius: 0.026,
    hopBase: 0.05,
    hopPerSec: 0.32,
    hopMax: 0.3,
    restGap: 0.9,
    mergeWindow: 2.6,
    settleToMerge: false,
    hoverY: 0.5,
    hoverLead: 0.2,
    entryLead: 2.67,
    impact: 0.25
  }
}

export interface Pose {
  x: number
  y: number
  z: number
  /** + flattens (impact / crouch), applied along the up axis */
  squash: number
  glow: number
  /** 0..1 */
  visible: number
}

export interface MotionOptions {
  params?: Partial<MotionParams>
  /** dock inside this performer while idle, and launch from it (budding) */
  home?: SpriteMotion
  /** line index within the voice, so buds hovering on their own don't stack on each other */
  slot?: number
}

/** longest arc a bud flies between its own notes before it hovers instead */
const BUD_MAX_FLIGHT = 1.0

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const lerp = (a: number, b: number, s: number) => a + (b - a) * s
const smooth = (s: number) => s * s * (3 - 2 * s)
const easeOutCubic = (s: number) => 1 - (1 - s) ** 3
const easeInCubic = (s: number) => s * s * s
const easeInOutSine = (s: number) => 0.5 - 0.5 * Math.cos(Math.PI * s)

interface Stop {
  /** head center, where the performer lands */
  x0: number
  /** tail center, where a full ride ends */
  x1: number
  z: number
  y: number
  /** seconds after the onset that the performer leaves this note */
  depart: number
  /** the note's duration: riding it takes exactly this long, so the performer moves with time */
  dur: number
  /** flight time to the next note (0 for rests and the last note) */
  flight: number
  /** what happens after the note: hop to the next, hover on its own, or dock back into home */
  kind: 'hop' | 'rest' | 'dock'
  /** rest phases (seconds): lift off to hover, wind-up, dive into the next onset */
  lift: number
  antic: number
  dive: number
}

/** phase lengths for a rest of the given gap; docked performers skip the wind-up */
function restPhases(gap: number, docked: boolean) {
  return {
    dive: docked ? clamp(gap * 0.2, 0.12, 0.3) : clamp(gap * 0.16, 0.2, 0.48),
    antic: docked ? 0 : clamp(gap * 0.14, 0.14, 0.75),
    lift: Math.min(docked ? 0.3 : 0.55, gap * 0.25)
  }
}

export class SpriteMotion {
  readonly voice: VoiceId
  readonly params: MotionParams
  readonly events: NoteEvent[]
  readonly home?: SpriteMotion
  private readonly slot: number
  private readonly score: Score
  private readonly layout: Layout
  private readonly stops: Stop[]

  constructor(
    score: Score,
    layout: Layout,
    voice: VoiceId,
    events: NoteEvent[],
    opts: MotionOptions = {}
  ) {
    this.score = score
    this.layout = layout
    this.voice = voice
    this.events = events
    this.home = opts.home
    this.slot = opts.slot ?? 0
    this.params = { ...MOTION[voice], ...opts.params }
    const budding = !!this.home
    const r = this.params.radius
    const w = layout.noteWidth
    this.stops = events.map((e, i) => {
      const n = e.target
      const len = layout.noteLength(n)
      const next = events[i + 1]
      const gap = next ? next.t - e.t : Infinity
      const dur = Math.max(0.04, n.d)
      // silence between the end of this note and the next onset
      const idle = gap - Math.min(dur, gap)
      // only real silence takes the performer off the paper; otherwise it hops off near the tail.
      // A bud keeps its own identity through short gaps (a long arc, or hovering on its own) and
      // only merges back into its home when it has nothing to play for a while.
      let kind: Stop['kind']
      if (!budding) kind = idle > this.params.restGap ? 'rest' : 'hop'
      else if (idle > this.params.mergeWindow) kind = 'dock'
      else kind = idle > BUD_MAX_FLIGHT ? 'rest' : 'hop'
      let phases = restPhases(idle, kind === 'dock')
      // wait for the home to settle before merging into it; no settle in time, no merge
      let mergeAt: number | undefined
      if (kind === 'dock' && this.params.settleToMerge && this.home && next) {
        const latest = next.t - phases.dive - phases.lift - 0.35
        mergeAt = this.home.settledAt(e.t + dur - 0.05, latest)
        if (mergeAt === undefined) {
          kind = idle > BUD_MAX_FLIGHT ? 'rest' : 'hop'
          phases = restPhases(idle, false)
        }
      }
      let flight = 0
      let depart: number
      if (kind !== 'hop') {
        // linger on the note's tail until it's time to lift off and arrive as the home settles
        depart =
          mergeAt === undefined
            ? dur
            : Math.max(dur, mergeAt - e.t - phases.lift * 0.6)
      } else {
        flight = clamp(
          Math.max(idle, 0.3 * Math.min(gap, 0.6)),
          0.09,
          budding ? BUD_MAX_FLIGHT : 0.3
        )
        depart = gap - flight
      }
      return {
        x0: layout.x(n.s) + w / 2,
        x1: layout.x(n.s) + Math.max(w / 2, len - w / 2),
        dur,
        z: layout.z(n.v, n.step),
        y: layout.noteTop + r * 0.92,
        depart,
        flight,
        kind,
        ...phases
      }
    })
  }

  /**
   * the first moment in [from, to] when this performer is settled: on a note held a beat or more,
   * or resting off the paper. Undefined if it's busy (mid-run) the whole time.
   */
  settledAt(from: number, to: number): number | undefined {
    const long = this.score.beat * 0.95
    for (
      let i = Math.max(0, this.eventIndex(from));
      i < this.events.length;
      i++
    ) {
      const e = this.events[i]!
      if (e.t > to) break
      const st = this.stops[i]!
      // a held note counts only if at least a beat of it remains: merging into the tail of a note
      // right before a quick run looks rushed
      const at = Math.max(from, e.t)
      if (at <= to && e.t + e.target.d - at >= long) return at
      if (st.kind !== 'hop') {
        const off = e.t + st.depart + st.lift
        if (off <= to && this.events[i + 1] && this.events[i + 1]!.t > from)
          return Math.max(from, off)
      }
    }
    return undefined
  }

  /** seconds over which the note at event i fills: its duration, ridden at the pace of time */
  rideTime(i: number) {
    return this.stops[i]!.dur
  }

  /** index of the last event at or before t, -1 if none */
  private eventIndex(t: number) {
    const ev = this.events
    if (!ev.length || t < ev[0]!.t) return -1
    let lo = 0
    let hi = ev.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (ev[mid]!.t <= t) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  private hopHeight(flight: number, dz: number) {
    const p = this.params
    return (
      Math.min(p.hopMax, p.hopBase + p.hopPerSec * (flight + 0.06)) +
      Math.abs(dz) * 0.3
    )
  }

  /** where the sprite floats while it waits: inside its home performer, or ahead of the playhead */
  private hover(t: number, docked = !!this.home) {
    if (docked && this.home) {
      const h = this.home.pose(t)
      return { x: h.x, y: h.y, z: h.z, visible: h.visible }
    }
    const p = this.params
    // breathe on the half note: secondary action that keeps the waiting performer alive
    const bob =
      0.022 *
      Math.sin((2 * Math.PI * (t - this.score.data.t0)) / (2 * this.score.beat))
    return {
      x: this.layout.playheadX(t) + p.hoverLead - 0.1 * this.slot,
      // a bud waiting between its own notes stays low, close to its staff, rather than flying off
      y: (this.home ? p.hoverY * 0.5 : p.hoverY) + bob + 0.04 * this.slot,
      z: this.layout.staffCenterZ(this.voice) - 0.05,
      visible: 1
    }
  }

  /** squash after landing on event i, u seconds later: a damped spring (follow-through) */
  private impactSquash(i: number, u: number, strength: number) {
    if (u < 0) return 0
    const vel = this.events[i]!.target.vel
    const amp = this.params.impact * strength * (0.55 + vel / 127)
    return amp * Math.exp(-u / 0.085) * Math.cos((u * 2 * Math.PI) / 0.2)
  }

  /** how hard the sprite arrived on event i */
  private impactStrength(i: number) {
    if (i <= 0) return 1
    const prev = this.stops[i - 1]!
    if (prev.kind !== 'hop') return 1.15
    return clamp(this.hopHeight(prev.flight, 0) / this.params.hopMax, 0.35, 1)
  }

  /** on the note at event i, u seconds after its onset: skate along it while it fills */
  private onNote(i: number, u: number) {
    const st = this.stops[i]!
    // skate at the leading edge of the fill, which advances with time across the note
    const f = clamp(u / st.dur)
    const vel = this.events[i]!.target.vel
    const flash = Math.exp(-u / 0.12) * (vel / 90)
    // a little weight while skating on long notes
    const skate = st.dur > 0.25 && u < st.dur ? 0.05 * Math.sin(Math.PI * f) : 0
    return {
      x: lerp(st.x0, st.x1, f),
      y: st.y,
      z: st.z,
      squash: this.impactSquash(i, u, this.impactStrength(i)) + skate,
      glow: 0.55 + flash,
      visible: 1
    }
  }

  /** a bud is inside (or emerging from / returning to) its home only around a dock */
  private docking(t: number) {
    const i = this.eventIndex(t)
    if (i < 0 || i === this.events.length - 1) return true
    const st = this.stops[i]!
    return st.kind === 'dock' && t >= this.events[i]!.t + st.depart
  }

  pose(t: number): Pose {
    const pose = this.rawPose(t)
    // crossing paths mid-flight isn't a merge: only fade a bud while it docks
    if (!this.home || !this.docking(t)) return pose
    // budding: hidden while docked inside home, emerging as it separates
    const h = this.home.pose(t)
    const d = Math.hypot(pose.x - h.x, pose.y - h.y, pose.z - h.z)
    const r = this.params.radius
    pose.visible *= smooth(clamp((d - r * 0.2) / (r * 1.6)))
    return pose
  }

  private rawPose(t: number): Pose {
    const p = this.params
    const ev = this.events
    const i = this.eventIndex(t)

    // before the first note: wait in the wings (or inside home), then make an entrance
    if (i < 0) {
      const first = ev[0]!
      const appear = first.t - p.entryLead
      const visible = this.home
        ? 1
        : smooth(clamp((t - appear) / Math.min(1.2, p.entryLead * 0.5)))
      const head = this.stops[0]!
      const rest = this.rest(t, -Infinity, first.t, -1, {
        x: head.x0,
        y: head.y,
        z: head.z
      })
      return { ...rest, visible: visible * rest.visible }
    }

    const st = this.stops[i]!
    const u = t - ev[i]!.t
    const next = ev[i + 1]

    // after the last note: ride it out, lift off, fade away
    if (!next) {
      if (u < st.depart) return this.onNote(i, u)
      const end = this.onNote(i, st.depart)
      const lift = smooth(clamp((u - st.depart) / 0.8))
      const h = this.hover(t)
      return {
        x: lerp(end.x, h.x, lift),
        y: lerp(end.y, h.y + (this.home ? 0 : 0.3), lift),
        z: lerp(end.z, h.z, lift),
        squash: 0,
        glow: 0.5,
        visible: this.home
          ? h.visible
          : 1 - smooth(clamp((u - st.depart - 1) / 2.5))
      }
    }

    if (st.kind !== 'hop') {
      const end = this.onNote(i, st.depart)
      return this.rest(t, ev[i]!.t, next.t, i, end)
    }

    // hop: skate the note, crouch at the tail, then arc to the next onset
    if (u < st.depart) {
      const on = this.onNote(i, u)
      // anticipation: a small crouch right before take-off
      on.squash += 0.1 * smooth(clamp((u - (st.depart - 0.06)) / 0.06))
      return on
    }
    const from = this.onNote(i, st.depart)
    const to = this.stops[i + 1]!
    const s = (u - st.depart) / st.flight
    const h = this.hopHeight(st.flight, to.z - from.z)
    const ex = lerp(s, smooth(s), 0.35)
    // longer flights hang near the apex (suspense) and drop late into the beat
    const hang = 2 + clamp((st.flight - 0.12) / 0.2) * 1.6
    const arc = 1 - Math.abs(2 * s - 1) ** hang
    return {
      x: lerp(from.x, to.x0, ex),
      y: lerp(from.y, to.y, s) + h * arc,
      z: lerp(from.z, to.z, easeInOutSine(s)),
      squash: 0,
      glow: 0.55 + 0.25 * smooth(clamp((s - 0.7) / 0.3)),
      visible: 1
    }
  }

  /**
   * A rest between notes: lift off to hover (or dock at home), breathe, then wind up and dive to
   * land on the next onset.
   */
  private rest(
    t: number,
    t0: number,
    t1: number,
    i: number,
    from: { x: number; y: number; z: number }
  ): Pose {
    const st = i >= 0 ? this.stops[i]! : null
    // before its first note a bud waits inside its home; after that it depends on the gap
    const docked = st ? st.kind === 'dock' : !!this.home
    const { dive, antic, lift } = st ?? restPhases(t1 - t0, docked)
    const u = t - t0

    // far from both neighbors, drift up and dim so the waiting sprite doesn't crowd the frame
    const away =
      st && !docked ? smooth(clamp((Math.min(u, t1 - t) - 2.2) / 2.5)) : 0
    const hv = this.hover(t, docked)
    hv.y += 0.6 * away

    const tDive = t1 - dive
    const tAntic = tDive - antic
    // wind-up: rise and pull back against the direction of the dive
    const windup = docked ? { x: 0, y: 0 } : { x: -0.07, y: 0.09 }

    if (st && u < st.depart) return this.onNote(i, u)
    if (st && u < st.depart + lift) {
      const s = easeOutCubic((u - st.depart) / lift)
      return {
        x: lerp(from.x, hv.x, s),
        y: lerp(from.y, hv.y, s),
        z: lerp(from.z, hv.z, s),
        squash: -0.08 * Math.sin(Math.PI * s),
        glow: 0.5,
        visible: 1
      }
    }
    if (t < tAntic) {
      return {
        x: hv.x,
        y: hv.y,
        z: hv.z,
        squash: 0,
        glow: 0.45 - 0.2 * away,
        visible: (1 - away) * (docked ? 1 : hv.visible)
      }
    }
    if (t < tDive) {
      const s = easeInOutSine((t - tAntic) / antic)
      return {
        x: hv.x + windup.x * s,
        y: hv.y + windup.y * s,
        z: hv.z,
        // coil: crouch harder as the entrance approaches
        squash: 0.22 * s,
        glow: 0.45 + 0.6 * s,
        visible: 1
      }
    }
    // dive: accelerate into the beat
    const a = this.hover(tDive, docked)
    const to = this.stops[this.eventIndex(t1)]!
    const s = (t - tDive) / dive
    return {
      x: lerp(a.x + windup.x, to.x0, smooth(s)),
      y:
        lerp(a.y + windup.y, to.y, docked ? easeInOutSine(s) : easeInCubic(s)) +
        (docked ? 0.08 * Math.sin(Math.PI * s) : 0),
      z: lerp(a.z, to.z, easeInOutSine(s)),
      squash: docked ? 0 : 0.22 * (1 - s) ** 2,
      glow: 1.05,
      visible: 1
    }
  }
}
