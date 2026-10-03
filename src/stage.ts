// Shared stage geometry built once from the score: note pills (with per-vertex timing attributes so
// shaders can animate them from a single time uniform), staff lines, bar lines and ledger lines.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import type { Layout } from './layout'
import { VOICE_ORDER, type Note, type Score, type VoiceId } from './score'

export interface PillOptions {
  /** pill width as a fraction of the staff-line spacing (2 steps) */
  widthFrac: number
  height: number
  bevel: number
  /** gap trimmed off the tail so repeated notes read as separate pills */
  tailGap: number
  minLength: number
}

export const defaultPill: PillOptions = {
  widthFrac: 0.8,
  height: 0.018,
  bevel: 0.014,
  tailGap: 0.035,
  minLength: 0
}

export const voiceIndex = (v: VoiceId) => VOICE_ORDER.indexOf(v)

function pillGeometry(length: number, width: number, opts: PillOptions) {
  const r = Math.min(width / 2, length / 2) - opts.bevel
  const l = Math.max(length - 2 * opts.bevel, 2 * r + 1e-4)
  const w = Math.max(width - 2 * opts.bevel, 1e-4)
  // three's 2D outline class is named Shape; the variable is the pill's outline
  // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names
  const outline = new THREE.Shape()
  const hw = w / 2
  outline.moveTo(r, -hw)
  outline.lineTo(l - r, -hw)
  outline.absarc(l - r, 0, hw, -Math.PI / 2, Math.PI / 2, false)
  outline.lineTo(r, hw)
  outline.absarc(r, 0, hw, Math.PI / 2, (3 * Math.PI) / 2, false)
  const g = new THREE.ExtrudeGeometry(outline, {
    depth: opts.height,
    bevelEnabled: true,
    bevelThickness: opts.bevel,
    bevelSize: opts.bevel,
    bevelSegments: 4,
    curveSegments: 10
  })
  // shape XY -> world XZ (shape +y -> world -z), extrusion -> world +y
  g.rotateX(-Math.PI / 2)
  g.translate(opts.bevel, opts.bevel, 0)
  return g
}

/** One merged mesh for every note. Attributes: aOnset, aDur, aVel, aVoice, aLocal (0..1 along the pill), aHead. */
export function buildNotes(
  score: Score,
  layout: Layout,
  opts: Partial<PillOptions> = {},
  filter?: (n: Note) => boolean,
  /** seconds a performer rides each note; its fill completes then (defaults to the note's duration) */
  ride?: (n: Note) => number
) {
  const o = { ...defaultPill, ...opts }
  const width = 2 * layout.opts.step * o.widthFrac
  const parts: THREE.BufferGeometry[] = []
  const cache = new Map<string, THREE.BufferGeometry>()
  for (const n of score.notes) {
    if (filter && !filter(n)) continue
    const length = Math.max(
      n.l * layout.opts.unit16 - o.tailGap,
      width,
      o.minLength
    )
    const key = length.toFixed(4)
    let base = cache.get(key)
    if (!base) {
      base = pillGeometry(length, width, o)
      cache.set(key, base)
    }
    const g = base.clone()
    const x0 = layout.x(n.s)
    const z0 = layout.z(n.v, n.step)
    g.translate(x0, 0, z0)
    const count = g.attributes.position!.count
    const pos = g.attributes.position!.array as Float32Array
    const onset = new Float32Array(count).fill(n.t)
    const dur = new Float32Array(count).fill(n.d)
    const vel = new Float32Array(count).fill(n.vel / 127)
    const voice = new Float32Array(count).fill(voiceIndex(n.v))
    const local = new Float32Array(count)
    const head = new Float32Array(count * 3)
    const rideTime = new Float32Array(count).fill(
      Math.max(0.04, ride ? ride(n) : n.d)
    )
    // fraction of the pill that is its head cap: the fill starts there, under the landing
    const fillStart = new Float32Array(count).fill(Math.min(1, width / length))
    for (let k = 0; k < count; k++) {
      local[k] = (pos[k * 3]! - x0) / length
      head[k * 3] = x0 + width / 2
      head[k * 3 + 1] = 0
      head[k * 3 + 2] = z0
    }
    g.setAttribute('aOnset', new THREE.BufferAttribute(onset, 1))
    g.setAttribute('aDur', new THREE.BufferAttribute(dur, 1))
    g.setAttribute('aVel', new THREE.BufferAttribute(vel, 1))
    g.setAttribute('aVoice', new THREE.BufferAttribute(voice, 1))
    g.setAttribute('aLocal', new THREE.BufferAttribute(local, 1))
    g.setAttribute('aHead', new THREE.BufferAttribute(head, 3))
    g.setAttribute('aRide', new THREE.BufferAttribute(rideTime, 1))
    g.setAttribute('aFillStart', new THREE.BufferAttribute(fillStart, 1))
    parts.push(g)
  }
  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  for (const g of cache.values()) g.dispose()
  if (!merged) throw new Error('failed to merge note geometry')
  merged.computeBoundingSphere()
  return merged
}

export interface LineOptions {
  /** line thickness (world units, in the ground plane) */
  width: number
  height: number
  /** extend staff lines this far before bar 0 and after the end */
  margin: number
  /** start the staff lines here instead (world x), e.g. at a system bracket */
  start?: number
}

export const defaultLines: LineOptions = {
  width: 0.006,
  height: 0.002,
  margin: 6
}

function box(
  x0: number,
  x1: number,
  z: number,
  w: number,
  h: number,
  depthAlongZ = true
) {
  const g = depthAlongZ
    ? new THREE.BoxGeometry(x1 - x0, h, w)
    : new THREE.BoxGeometry(w, h, x1 - x0)
  if (depthAlongZ) g.translate((x0 + x1) / 2, h / 2, z)
  return g
}

/** Staff lines, bar lines and ledger lines, each tagged with aVoice and aKind (0 staff, 1 bar, 2 ledger). */
export function buildLines(
  score: Score,
  layout: Layout,
  opts: Partial<LineOptions> = {},
  voices: VoiceId[] = VOICE_ORDER
) {
  const o = { ...defaultLines, ...opts }
  const parts: THREE.BufferGeometry[] = []
  const tag = (
    g: THREE.BufferGeometry,
    voice: VoiceId,
    kind: number,
    x: number
  ) => {
    const n = g.attributes.position!.count
    g.setAttribute(
      'aVoice',
      new THREE.BufferAttribute(new Float32Array(n).fill(voiceIndex(voice)), 1)
    )
    g.setAttribute(
      'aKind',
      new THREE.BufferAttribute(new Float32Array(n).fill(kind), 1)
    )
    // time at which this element is "reached" by the playhead (bar lines / ledgers flash then)
    g.setAttribute(
      'aTime',
      new THREE.BufferAttribute(new Float32Array(n).fill(x), 1)
    )
    parts.push(g)
  }
  const xStart = o.start ?? layout.x(0) - o.margin
  const xEnd = layout.x(score.data.bars * 16) + o.margin
  const ledgerLen = 2 * layout.opts.step * 1.5

  for (const voice of voices) {
    const staff = layout.staves[voice]
    for (let k = 0; k < staff.lines; k++) {
      const z = layout.z(voice, staff.base + 2 * k)
      tag(box(xStart, xEnd, z, o.width, o.height), voice, 0, -1)
    }
    const zTop = layout.staffTopZ(voice)
    const zBot = staff.z
    for (let bar = 0; bar <= score.data.bars; bar++) {
      const x = layout.x(bar * 16) - layout.opts.unit16 * 0.5
      const g = new THREE.BoxGeometry(
        o.width * 1.1,
        o.height,
        zBot - zTop + o.width
      )
      g.translate(x, o.height / 2, (zTop + zBot) / 2)
      tag(g, voice, 1, score.barTime(bar))
    }
  }
  const seen = new Set<string>()
  for (const n of score.notes) {
    if (!voices.includes(n.v)) continue
    for (const s of layout.ledgers(n)) {
      const x0 = layout.x(n.s) - ledgerLen * 0.18
      const key = `${n.v}:${n.s}:${s}`
      if (seen.has(key)) continue
      seen.add(key)
      tag(
        box(x0, x0 + ledgerLen, layout.z(n.v, s), o.width, o.height),
        n.v,
        2,
        n.t
      )
    }
  }
  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  if (!merged) throw new Error('failed to merge line geometry')
  return merged
}

/** Impacts (sprite landings) near time t, newest last, for ripples and light flashes. */
export interface Impact {
  voice: VoiceId
  t: number
  x: number
  z: number
  vel: number
}

export function recentImpacts(
  score: Score,
  layout: Layout,
  t: number,
  window: number,
  voices: VoiceId[] = VOICE_ORDER
) {
  const out: Impact[] = []
  for (const voice of voices) {
    const ev = score.events[voice]
    // binary search for the first event after t - window
    let lo = 0
    let hi = ev.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (ev[mid]!.t < t - window) lo = mid + 1
      else hi = mid
    }
    for (let i = lo; i < ev.length && ev[i]!.t <= t; i++) {
      // every note of a chord is struck, so each gets its own ripple
      for (const n of ev[i]!.notes) {
        out.push({
          voice,
          t: n.t,
          x: layout.x(n.s) + layout.noteWidth / 2,
          z: layout.z(n.v, n.step),
          vel: n.vel / 127
        })
      }
    }
  }
  return out.sort((a, b) => a.t - b.t)
}
