// The controls panel (DialKit), closed by default: the video's major dials. The defaults are the
// rendered video; Reset returns to them.

import { createDialKit, createDialRoot } from 'dialkit/vanilla'

import { DEFAULT_TWEAKS, type Tweaks } from '../look'

export type Format = 'auto' | 'landscape' | 'portrait'
export type Quality = 'auto' | 'high' | 'low'

/** choices that need the look rebuilt or the canvas resized, rather than a live update */
export interface Setup {
  format: Format
  chords: string
  intro: string
  quality: Quality
}

export const DEFAULT_SETUP: Setup = {
  format: 'auto',
  chords: 'bud',
  intro: 'skip',
  quality: 'auto'
}

const { palette } = DEFAULT_TWEAKS

// canvas normalizes any CSS color the picker hands back into one three.js can parse
const swatch = document.createElement('canvas').getContext('2d')!
const color = (value: string) => {
  swatch.fillStyle = '#000'
  swatch.fillStyle = value
  return swatch.fillStyle
}

export function createPanel(
  tweaks: Tweaks,
  hooks: { tweak(): void; setup(next: Setup): void }
) {
  createDialRoot({
    position: 'top-right',
    theme: 'dark',
    defaultOpen: false,
    onOpenChange: (open) => document.body.classList.toggle('panel-open', open)
  })
  const kit = createDialKit(
    'Candy Paint',
    {
      Format: {
        type: 'select',
        options: [
          { value: 'auto', label: 'Fit window' },
          { value: 'landscape', label: '16:9' },
          { value: 'portrait', label: '9:16' }
        ],
        default: DEFAULT_SETUP.format
      },
      Camera: {
        type: 'select',
        options: [
          { value: 'director', label: 'Storyboard' },
          { value: 'hero', label: 'Hero' },
          { value: 'wide', label: 'Wide' },
          { value: 'close', label: 'Close' },
          { value: 'low', label: 'Low' }
        ],
        default: DEFAULT_TWEAKS.shot
      },
      Chords: {
        type: 'select',
        options: [
          { value: 'bud', label: 'Budding' },
          { value: 'twins', label: 'Twins' },
          { value: 'single', label: 'Single' }
        ],
        default: DEFAULT_SETUP.chords
      },
      Intro: {
        type: 'select',
        options: [
          { value: 'skip', label: 'Skip' },
          { value: 'arc', label: 'Arc' },
          { value: 'none', label: 'None' }
        ],
        default: DEFAULT_SETUP.intro
      },
      Palette: {
        Lead: { type: 'color', default: palette.lead },
        Riff: { type: 'color', default: palette.riff },
        Bass: { type: 'color', default: palette.bass },
        Sparkle: { type: 'color', default: palette.sparkle },
        _collapsed: true
      },
      Light: {
        Bloom: [DEFAULT_TWEAKS.bloom, 0, 3, 0.01],
        Glow: [DEFAULT_TWEAKS.glow, 0, 3, 0.01],
        Afterglow: [DEFAULT_TWEAKS.ember, 0, 4, 0.01],
        Fog: [DEFAULT_TWEAKS.fog, 0, 3, 0.01],
        Focus: [DEFAULT_TWEAKS.focus, 0, 3, 0.01],
        Grain: [DEFAULT_TWEAKS.grain, 0, 0.2, 0.001],
        Vignette: [DEFAULT_TWEAKS.vignette, 0, 1, 0.01],
        _collapsed: true
      },
      Motion: {
        Size: [DEFAULT_TWEAKS.size, 0.4, 2.5, 0.01],
        Trails: [DEFAULT_TWEAKS.trail, 0, 4, 0.01],
        Drops: [DEFAULT_TWEAKS.impact, 0, 3, 0.01],
        _collapsed: true
      },
      Quality: {
        type: 'select',
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'high', label: 'High' },
          { value: 'low', label: 'Low' }
        ],
        default: DEFAULT_SETUP.quality
      },
      Reset: { type: 'action', label: 'Reset to the video' }
    },
    {
      onAction: (action) => {
        if (action === 'Reset') kit.resetValues()
      }
    }
  )

  let setup = DEFAULT_SETUP
  kit.subscribe((v) => {
    tweaks.shot = v.Camera
    tweaks.palette = {
      lead: color(v.Palette.Lead),
      riff: color(v.Palette.Riff),
      bass: color(v.Palette.Bass),
      sparkle: color(v.Palette.Sparkle)
    }
    tweaks.bloom = v.Light.Bloom
    tweaks.glow = v.Light.Glow
    tweaks.ember = v.Light.Afterglow
    tweaks.fog = v.Light.Fog
    tweaks.focus = v.Light.Focus
    tweaks.grain = v.Light.Grain
    tweaks.vignette = v.Light.Vignette
    tweaks.size = v.Motion.Size
    tweaks.trail = v.Motion.Trails
    tweaks.impact = v.Motion.Drops
    hooks.tweak()
    const next: Setup = {
      format: v.Format as Format,
      chords: v.Chords,
      intro: v.Intro,
      quality: v.Quality as Quality
    }
    if (JSON.stringify(next) === JSON.stringify(setup)) return
    setup = next
    hooks.setup(next)
  })
}
