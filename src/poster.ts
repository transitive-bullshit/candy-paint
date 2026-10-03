// The intro title: on frame 0 (the thumbnail in most feeds) it sits top left over the riff's two
// performers as they enter. It lingers as a foreground element while the camera starts following
// them, then the camera passes it and it's left behind, sliding out of frame with the scene.

import { Effect } from 'postprocessing'
import * as THREE from 'three'

const INK = '#f3ece6'
const GOLD = '#d9b77a'

export const TITLE = 'Candy Paint'
export const ARTIST = 'Post Malone'

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const smooth = (s: number) => s * s * (3 - 2 * s)

/** where the title sits in the scene (it moves with the world, not the screen) */
export interface TitleAnchor {
  /** pixel position of the title block's top-left corner */
  x: number
  y: number
  /** perspective scale relative to frame 0 */
  scale: number
}

/** The intro title, drawn in screen space; the look decides where it sits each frame. */
export class PosterEffect extends Effect {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly texture: THREE.CanvasTexture
  private drawn = false

  constructor() {
    const canvas = document.createElement('canvas')
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    super(
      'PosterEffect',
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
  }

  override setSize(width: number, height: number) {
    this.canvas.width = width
    this.canvas.height = height
    this.drawn = false
  }

  draw(t: number, anchor: TitleAnchor | null) {
    const { ctx, canvas } = this
    const W = canvas.width
    const H = canvas.height
    // the title leaves with the camera move; a late fade only catches what's still in frame
    const alpha = anchor ? 1 - smooth(clamp((t - 5.2) / 1.0)) : 0
    if (alpha <= 0 || !anchor) {
      if (this.drawn) {
        ctx.clearRect(0, 0, W, H)
        this.texture.needsUpdate = true
        this.drawn = false
      }
      return
    }
    this.drawn = true
    const u = (H / 1080) * anchor.scale
    ctx.clearRect(0, 0, W, H)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    // a soft shade under the title, carried with it
    const cx = anchor.x + 420 * u
    const cy = anchor.y + 120 * u
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 760 * u)
    g.addColorStop(0, `rgba(5, 3, 6, ${0.55 * alpha})`)
    g.addColorStop(1, 'rgba(5, 3, 6, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    ctx.globalAlpha = alpha
    ctx.fillStyle = INK
    ctx.font = `850 ${190 * u}px Archivo`
    ctx.fontStretch = 'extra-condensed'
    ctx.letterSpacing = `${-1 * u}px`
    ctx.fillText(TITLE.toUpperCase(), anchor.x - 6 * u, anchor.y + 160 * u)
    ctx.fillStyle = GOLD
    ctx.font = `500 ${42 * u}px Archivo`
    ctx.fontStretch = 'normal'
    ctx.letterSpacing = `${0.5 * u}px`
    ctx.fillText(`${ARTIST}, instrumental`, anchor.x, anchor.y + 228 * u)
    ctx.globalAlpha = 1
    this.texture.needsUpdate = true
  }
}
