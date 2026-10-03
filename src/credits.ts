// End credits, laid over the final rise as the camera looks back down the whole painted song.
// Drawn into a canvas each frame and composited after tone mapping (so type stays crisp) but before
// grain and the fade to black (so it sits in the image and leaves with it).

import { Effect } from 'postprocessing'
import * as THREE from 'three'

import type { Score } from './score'

export const CREDITS = {
  title: 'Candy Paint',
  artist: 'Post Malone',
  rows: [
    ['Instrumental cover', 'Molotov Cocktail Piano'],
    ['Music video', 'Travis Fischer'],
    ['Created with', 'Claude Opus 5.5'],
    ['Built with', 'three.js  ·  Transkun  ·  FFmpeg']
  ] as [string, string][]
}

const INK = '#f3ece6'
const GOLD = '#d9b77a'
const MUTED = '#a8979f'

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const easeOut = (s: number) => 1 - (1 - s) ** 3

export class CreditsEffect extends Effect {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly texture: THREE.CanvasTexture
  private readonly start: number
  private drawn = false

  constructor(score: Score) {
    const canvas = document.createElement('canvas')
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    super(
      'CreditsEffect',
      /* glsl */ `
        uniform sampler2D map;
        void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
          vec4 t = texture2D(map, uv);
          outputColor = vec4(mix(inputColor.rgb, t.rgb, t.a), inputColor.a);
        }`,
      {
        uniforms: new Map<string, THREE.Uniform>([
          ['map', new THREE.Uniform(texture)]
        ])
      }
    )
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.texture = texture
    // as the camera finishes swinging around to look back down the song
    this.start = score.barTime(score.data.bars) + 2.8
  }

  static async loadFonts() {
    await Promise.all([
      document.fonts.load('850 120px Archivo'),
      document.fonts.load('500 40px Archivo'),
      document.fonts.load('500 16px "DM Mono"')
    ])
  }

  override setSize(width: number, height: number) {
    this.canvas.width = width
    this.canvas.height = height
    this.drawn = false
  }

  /** opacity and rise for an element that enters `delay` seconds into the credits */
  private enter(t: number, delay: number) {
    const s = easeOut(clamp((t - this.start - delay) / 1.1))
    return { a: s, dy: (1 - s) * 10 }
  }

  draw(t: number) {
    const { ctx, canvas } = this
    const W = canvas.width
    const H = canvas.height
    if (t < this.start) {
      if (this.drawn) {
        ctx.clearRect(0, 0, W, H)
        this.texture.needsUpdate = true
        this.drawn = false
      }
      return
    }
    this.drawn = true
    // scale by the short side; in a tall frame the credits sit in the lower half
    const portrait = H > W
    const u = Math.min(W, H) / 1080
    const x = (portrait ? 90 : 150) * u
    ctx.clearRect(0, 0, W, H)
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'

    // a soft shade on the left so the type reads over any light behind it
    const shade = this.enter(t, 0).a
    const g = portrait
      ? ctx.createLinearGradient(0, H, 0, H * 0.35)
      : ctx.createLinearGradient(0, 0, W * 0.6, 0)
    g.addColorStop(0, `rgba(5, 3, 6, ${0.55 * shade})`)
    g.addColorStop(1, 'rgba(5, 3, 6, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    const titleY = portrait ? H * 0.6 : H * 0.43
    // title: condensed and heavy, like the treatment's display type
    {
      const { a, dy } = this.enter(t, 0.1)
      ctx.globalAlpha = a
      ctx.fillStyle = INK
      ctx.font = `850 ${172 * u}px Archivo`
      ctx.fontStretch = 'extra-condensed'
      ctx.letterSpacing = `${-1 * u}px`
      ctx.fillText(CREDITS.title.toUpperCase(), x - 6 * u, titleY + dy * u)
    }
    {
      const { a, dy } = this.enter(t, 0.45)
      ctx.globalAlpha = a
      ctx.fillStyle = GOLD
      ctx.font = `500 ${40 * u}px Archivo`
      ctx.fontStretch = 'normal'
      ctx.letterSpacing = `${0.5 * u}px`
      ctx.fillText(CREDITS.artist, x, titleY + 62 * u + dy * u)
    }
    // a gold pinstripe, drawn left to right like the staff lines
    const ruleY = titleY + 112 * u
    {
      const s = easeOut(clamp((t - this.start - 0.8) / 1.4))
      ctx.globalAlpha = 0.9
      ctx.fillStyle = GOLD
      ctx.fillRect(x, ruleY, 560 * u * s, Math.max(1, 1.6 * u))
    }
    CREDITS.rows.forEach(([label, value], i) => {
      const { a, dy } = this.enter(t, 1.2 + i * 0.32)
      const y = ruleY + (62 + i * 50) * u + dy * u
      ctx.globalAlpha = a
      ctx.fillStyle = MUTED
      ctx.font = `500 ${15 * u}px "DM Mono"`
      ctx.fontStretch = 'normal'
      ctx.letterSpacing = `${2.6 * u}px`
      ctx.fillText(label.toUpperCase(), x, y)
      ctx.fillStyle = INK
      ctx.font = `500 ${28 * u}px Archivo`
      ctx.letterSpacing = '0px'
      ctx.fillText(value, x + 250 * u, y + 2 * u)
    })
    ctx.globalAlpha = 1
    this.texture.needsUpdate = true
  }
}
