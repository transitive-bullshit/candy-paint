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
}

export interface Look {
  /** advance every animated element to song time t (seconds) */
  update(t: number): void
  render(): void
  setSize(width: number, height: number): void
}

export type LookFactory = (ctx: LookContext) => Promise<Look>

/** Candy paint palette: each voice gets its own candy over a metallic base. */
export const CANDY: Record<VoiceId, string> = {
  lead: '#ff2a4f', // candy apple red: the vocal line
  riff: '#2f6bff', // candy blue: the loop (the single's blue iris, Post's blue candy Explorer)
  bass: '#8a3dff', // candy purple: the low end, a nod to screwed-up Houston
  sparkle: '#ffc45c' // gold flake
}
