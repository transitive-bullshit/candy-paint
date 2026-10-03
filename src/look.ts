import type * as THREE from 'three'

import type { Layout } from './layout'
import type { Score, VoiceId } from './score'

export interface LookContext {
  renderer: THREE.WebGLRenderer
  score: Score
  layout: Layout
  width: number
  height: number
  /** named camera framing for stills, e.g. "hero", "wide" */
  shot: string
  /** extra page parameters for experiments (e.g. chords=bud) */
  query: URLSearchParams
  /** live adjustments (the web player), read every frame; omitted for renders */
  tweaks?: Tweaks
}

export interface Look {
  /** advance every animated element to song time t (seconds) */
  update(t: number): void
  render(): void
  setSize(width: number, height: number): void
  /** release GPU resources before the look is replaced */
  dispose?(): void
}

export type LookFactory = (ctx: LookContext) => Promise<Look>

/** Candy paint palette: each voice gets its own candy over a metallic base. */
export const CANDY: Record<VoiceId, string> = {
  lead: '#ff2a4f', // candy apple red: the vocal line
  riff: '#2f6bff', // candy blue: the loop (the single's blue iris, Post's blue candy Explorer)
  bass: '#8a3dff', // candy purple: the low end, a nod to screwed-up Houston
  sparkle: '#ffc45c' // gold flake
}

/** Live adjustments from the web player. The defaults reproduce the rendered video exactly. */
export interface Tweaks {
  palette: Record<VoiceId, string>
  /** 'director' follows the storyboard; the others are the fixed framings */
  shot: string
  /** multipliers, 1 = as rendered */
  bloom: number
  glow: number
  ember: number
  fog: number
  focus: number
  size: number
  trail: number
  /** punch-in, shake, flash and shockwave on the drops */
  impact: number
  /** absolute amounts */
  grain: number
  vignette: number
}

export const DEFAULT_TWEAKS: Tweaks = {
  palette: { ...CANDY },
  shot: 'director',
  bloom: 1,
  glow: 1,
  ember: 1,
  fog: 1,
  focus: 1,
  size: 1,
  trail: 1,
  impact: 1,
  grain: 0.035,
  vignette: 0.72
}
