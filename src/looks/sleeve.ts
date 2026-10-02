// Look C, "Sleeve": the score as a risograph-printed record sleeve. Flat, top-down, on uncoated
// paper, in three spot inks that multiply where they overlap (fluorescent pink over blue makes the
// candy purple). Notes are printed outlines until played, then flood with ink and settle to a
// halftone tint; performers are ink dots drawn with smear frames, multiples and a cast shadow.
// Editorial type: title, section, bar counter, chord symbols, registration marks.

import {
  BlendFunction,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  Effect
} from 'postprocessing'
import * as THREE from 'three'

import { Layout } from '../layout'
import type { Look, LookContext } from '../look'
import { SpriteMotion } from '../motion'
import { sampleRig } from '../rig'
import { VOICE_ORDER, type VoiceId } from '../score'
import { buildLines, voiceIndex } from '../stage'

const PAPER = new THREE.Color('#efe9dc')
/** riso spot inks */
const INK: Record<VoiceId, THREE.Color> = {
  lead: new THREE.Color('#ff48a4'), // fluorescent pink
  riff: new THREE.Color('#1f63d8'), // medium blue
  bass: new THREE.Color('#5a2d8c'), // pink over blue
  sparkle: new THREE.Color('#ffc21a') // yellow
}
const KEY = new THREE.Color('#29252c')
/** left page margin in device pixels, shared by every ink layer */
const MARGIN = { value: 0 }

/** multiply blending: ink darkens what's under it, like overprinted riso layers */
function inkBlend(mat: THREE.ShaderMaterial) {
  mat.transparent = true
  mat.depthWrite = false
  mat.depthTest = false
  mat.blending = THREE.CustomBlending
  mat.blendEquation = THREE.AddEquation
  mat.blendSrc = THREE.DstColorFactor
  mat.blendDst = THREE.ZeroFactor
  return mat
}

const HALFTONE_GLSL = /* glsl */ `
  // amplitude-modulated dot screen at 45 degrees, in screen pixels
  float halftone(float coverage, float cell) {
    vec2 p = mat2(0.7071, -0.7071, 0.7071, 0.7071) * gl_FragCoord.xy / cell;
    vec2 f = fract(p) - 0.5;
    float r = sqrt(clamp(coverage, 0.0, 1.0)) * 0.62;
    float d = length(f);
    float aa = fwidth(d);
    return 1.0 - smoothstep(r - aa, r + aa, d);
  }
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  // the left margin of the page stays clean for the staff labels
  uniform float uMargin;
  float margin() { return smoothstep(uMargin, uMargin + 36.0, gl_FragCoord.x); }
`

function buildNoteQuads(ctx: LookContext, widthFrac = 0.82) {
  const { score, layout } = ctx
  const w = 2 * layout.opts.step * widthFrac
  const n = score.notes.length
  const pos = new Float32Array(n * 4 * 3)
  const local = new Float32Array(n * 4 * 2)
  const size = new Float32Array(n * 4 * 2)
  const onset = new Float32Array(n * 4)
  const dur = new Float32Array(n * 4)
  const vel = new Float32Array(n * 4)
  const voice = new Float32Array(n * 4)
  const index: number[] = []
  const pad = 0.01
  score.notes.forEach((note, i) => {
    const len = Math.max(note.l * layout.opts.unit16 - 0.035, w)
    const x0 = layout.x(note.s)
    const zc = layout.z(note.v, note.step)
    const corners = [
      [-pad, -w / 2 - pad],
      [len + pad, -w / 2 - pad],
      [len + pad, w / 2 + pad],
      [-pad, w / 2 + pad]
    ]
    corners.forEach(([lx, lz], k) => {
      const j = i * 4 + k
      pos.set([x0 + lx!, 0.001, zc + lz!], j * 3)
      // local coords centered on the pill
      local.set([lx! - len / 2, lz!], j * 2)
      size.set([len / 2, w / 2], j * 2)
      onset[j] = note.t
      dur[j] = note.d
      vel[j] = note.vel / 127
      voice[j] = voiceIndex(note.v)
    })
    const b = i * 4
    index.push(b, b + 2, b + 1, b, b + 3, b + 2)
  })
  const g = new THREE.BufferGeometry()
  g.setIndex(index)
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aLocal', new THREE.BufferAttribute(local, 2))
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 2))
  g.setAttribute('aOnset', new THREE.BufferAttribute(onset, 1))
  g.setAttribute('aDur', new THREE.BufferAttribute(dur, 1))
  g.setAttribute('aVel', new THREE.BufferAttribute(vel, 1))
  g.setAttribute('aVoice', new THREE.BufferAttribute(voice, 1))
  return g
}

function noteInkMaterial() {
  return inkBlend(
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uInks: { value: VOICE_ORDER.map((v) => INK[v]) },
        uKey: { value: KEY },
        uPx: { value: 0.004 },
        uMargin: MARGIN
      },
      vertexShader: /* glsl */ `
        attribute vec2 aLocal; attribute vec2 aSize; attribute float aOnset; attribute float aDur; attribute float aVel; attribute float aVoice;
        varying vec2 vLocal; varying vec2 vSize; varying float vOnset; varying float vDur; varying float vVel; varying float vVoice;
        void main() {
          vLocal = aLocal; vSize = aSize; vOnset = aOnset; vDur = aDur; vVel = aVel; vVoice = aVoice;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uInks[4]; uniform vec3 uKey; uniform float uPx;
        varying vec2 vLocal; varying vec2 vSize; varying float vOnset; varying float vDur; varying float vVel; varying float vVoice;
        ${HALFTONE_GLSL}
        float sdPill(vec2 p, vec2 b) {
          float r = b.y;
          vec2 q = abs(p) - b + r;
          return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
        }
        void main() {
          vec3 ink = uInks[int(vVoice + 0.5)];
          float age = uTime - vOnset;
          float hit = step(0.0, age);
          // ink spreads a hair on impact (dot gain), then settles
          float spread = hit * exp(-age / 0.12) * 0.012 * (0.5 + vVel);
          float d = sdPill(vLocal, vSize + spread);
          float aa = fwidth(d) * 0.75;
          float shape = 1.0 - smoothstep(-aa, aa, d);
          float outline = 1.0 - smoothstep(uPx * 0.5 - aa, uPx * 0.5 + aa, abs(d));
          // fill progress along the pill while the note sounds
          float u = (vLocal.x + vSize.x) / (2.0 * vSize.x);
          float fill = hit * clamp(0.2 + age / max(vDur, 0.06), 0.0, 1.0);
          float filled = shape * (1.0 - smoothstep(fill - 0.02, fill, u)) * hit;
          // solid while sounding, then a printed halftone tint that stays on the page
          float release = smoothstep(vDur, vDur + 0.9, age);
          float solid = mix(1.0, halftone(0.55, 5.0), release);
          float a = max(filled * solid, outline * mix(0.55, 0.0, filled)) * margin();
          vec3 col = mix(uKey, ink, hit);
          gl_FragColor = vec4(mix(vec3(1.0), col, a), 1.0);
        }`
    })
  )
}

function lineInkMaterial() {
  return inkBlend(
    new THREE.ShaderMaterial({
      uniforms: { uKey: { value: KEY }, uMargin: MARGIN },
      vertexShader: /* glsl */ `
        attribute float aKind;
        varying float vKind;
        void main() { vKind = aKind; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uKey;
        uniform float uMargin;
        varying float vKind;
        void main() {
          float a = vKind > 0.5 && vKind < 1.5 ? 0.45 : 0.8;
          a *= step(uMargin, gl_FragCoord.x);
          gl_FragColor = vec4(mix(vec3(1.0), uKey, a), 1.0);
        }`
    })
  )
}

/** a stretched ink dot: the quad is deformed on the CPU; the shader draws a circle in local space */
function dotMaterial(color: THREE.Color, coverage = 1) {
  return inkBlend(
    new THREE.ShaderMaterial({
      uniforms: {
        uInk: { value: color },
        uCoverage: { value: coverage },
        uOpacity: { value: 1 },
        uMargin: MARGIN
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uInk; uniform float uCoverage; uniform float uOpacity;
        varying vec2 vUv;
        ${HALFTONE_GLSL}
        void main() {
          float d = length(vUv) - 1.0;
          float aa = fwidth(d);
          float a = (1.0 - smoothstep(-aa, aa, d)) * uOpacity * margin();
          a *= uCoverage >= 0.99 ? 1.0 : halftone(uCoverage, 4.0);
          gl_FragColor = vec4(mix(vec3(1.0), uInk, a), 1.0);
        }`
    })
  )
}

function paperMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uPaper: { value: PAPER }, uMargin: MARGIN },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uPaper;
      varying vec3 vW;
      ${HALFTONE_GLSL}
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
      }
      void main() {
        // uncoated stock: soft mottling plus short fibers
        float mottle = vnoise(vW.xz * 2.0) * 0.5 + vnoise(vW.xz * 7.0) * 0.5;
        float fiber = vnoise(vec2(vW.x * 60.0, vW.z * 260.0)) * vnoise(vec2(vW.x * 210.0, vW.z * 50.0));
        vec3 c = uPaper * (0.985 + 0.03 * mottle) - 0.045 * smoothstep(0.55, 0.9, fiber);
        gl_FragColor = vec4(c, 1.0);
      }`
  })
}

/** Riso print finish: ink grain (speckle where ink is thin), slight misregistration of the pink. */
class RisoEffect extends Effect {
  constructor() {
    super(
      'RisoEffect',
      /* glsl */ `
      float h12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 paper = vec3(${PAPER.r.toFixed(4)}, ${PAPER.g.toFixed(4)}, ${PAPER.b.toFixed(4)});
        // misregistration: the pink drum is a hair off
        vec3 shifted = texture2D(inputBuffer, uv + vec2(0.0009, -0.0006)).rgb;
        vec3 c = inputColor.rgb;
        c.g = min(c.g, mix(c.g, shifted.g, 0.85));
        float ink = clamp(1.0 - dot(c, vec3(0.333)) / dot(paper, vec3(0.333)), 0.0, 1.0);
        float n = h12(floor(uv * resolution));
        float n2 = h12(floor(uv * resolution * 0.5) + 7.0);
        // riso ink is grainy: some paper shows through solids
        c = mix(c, paper, ink * 0.18 * step(0.72, n) * (0.5 + n2));
        outputColor = vec4(c, inputColor.a);
      }`,
      { blendFunction: BlendFunction.NORMAL }
    )
  }
}

interface Performer {
  voice: VoiceId
  motion: SpriteMotion
  dots: THREE.Mesh[]
  shadow: THREE.Mesh
  trail: THREE.Points
}

const SCREEN_LIFT = 0.75

export async function createSleeve(input: LookContext): Promise<Look> {
  // a tighter page than the 3D looks: staves closer together, like an engraved score
  const ctx = { ...input, layout: new Layout(input.score, { gap: 0.36 }) }
  const { renderer, score, layout } = ctx
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.SRGBColorSpace
  await Promise.all([
    document.fonts.load('80px Anton'),
    document.fonts.load('16px "DM Mono"'),
    document.fonts.load('500 16px "DM Mono"')
  ])

  const scene = new THREE.Scene()
  scene.background = PAPER.clone()
  const viewW = 10.4
  const aspect = ctx.width / ctx.height
  const viewH = viewW / aspect
  const camera = new THREE.OrthographicCamera(
    -viewW / 2,
    viewW / 2,
    viewH / 2,
    -viewH / 2,
    0.1,
    50
  )
  camera.up.set(0, 0, -1)
  const zTop = layout.staffTopZ('sparkle')
  const zBot = layout.staves.bass.z
  const zCenter = (zTop + zBot) / 2 - 0.02

  const songLength = layout.x(score.data.bars * 16) + 40
  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(songLength, 40),
    paperMaterial()
  )
  paper.rotation.x = -Math.PI / 2
  paper.position.set(songLength / 2 - 20, -0.01, zCenter)
  paper.renderOrder = -10
  scene.add(paper)

  const lines = new THREE.Mesh(
    buildLines(score, layout, { width: 0.0075, height: 0.001 }),
    lineInkMaterial()
  )
  lines.renderOrder = 1
  scene.add(lines)
  const noteMat = noteInkMaterial()
  const notes = new THREE.Mesh(buildNoteQuads(ctx), noteMat)
  notes.frustumCulled = false
  notes.renderOrder = 2
  scene.add(notes)

  const quad = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2)
  const performers: Performer[] = VOICE_ORDER.map((voice) => {
    const motion = new SpriteMotion(score, layout, voice, score.events[voice])
    // multiples: the current dot plus two halftone echoes a frame or two behind (smear frames)
    const dots = [1, 0.45, 0.22].map((cov, k) => {
      const m = new THREE.Mesh(quad, dotMaterial(INK[voice], cov))
      m.matrixAutoUpdate = false
      m.renderOrder = 6 - k
      m.frustumCulled = false
      scene.add(m)
      return m
    })
    const shadow = new THREE.Mesh(quad, dotMaterial(KEY, 0.28))
    shadow.matrixAutoUpdate = false
    shadow.renderOrder = 3
    shadow.frustumCulled = false
    scene.add(shadow)
    const trailGeo = new THREE.BufferGeometry()
    trailGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(24 * 3), 3)
    )
    trailGeo.setAttribute(
      'aSize',
      new THREE.BufferAttribute(new Float32Array(24), 1)
    )
    const trailMat = inkBlend(
      new THREE.ShaderMaterial({
        uniforms: { uInk: { value: INK[voice] } },
        vertexShader: /* glsl */ `
          attribute float aSize;
          void main() { gl_PointSize = aSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uInk;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            float a = 1.0 - smoothstep(0.8, 1.0, d);
            gl_FragColor = vec4(mix(vec3(1.0), uInk, a * 0.9), 1.0);
          }`
      })
    )
    const trail = new THREE.Points(trailGeo, trailMat)
    trail.frustumCulled = false
    trail.renderOrder = 4
    scene.add(trail)
    return { voice, motion, dots, shadow, trail }
  })

  // editorial overlay, drawn per frame into a canvas and multiplied onto the print
  const hud = document.createElement('canvas')
  const hudCtx = hud.getContext('2d')!
  const hudTex = new THREE.CanvasTexture(hud)
  hudTex.colorSpace = THREE.SRGBColorSpace
  const hudScene = new THREE.Scene()
  const hudCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const hudMat = inkBlend(
    new THREE.ShaderMaterial({
      uniforms: { tHud: { value: hudTex } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `uniform sampler2D tHud; varying vec2 vUv; void main() { vec4 t = texture2D(tHud, vUv); gl_FragColor = vec4(mix(vec3(1.0), t.rgb / max(t.a, 1e-4), t.a), 1.0); }`
    })
  )
  hudScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), hudMat))

  const composer = new EffectComposer(renderer, { multisampling: 4 })
  composer.addPass(new RenderPass(scene, camera))
  const hudPass = new RenderPass(hudScene, hudCam)
  hudPass.clear = false
  composer.addPass(hudPass)
  composer.addPass(new EffectPass(camera, new RisoEffect(), new SMAAEffect()))

  const playFrac = 0.34
  const toScreen = (x: number, z: number) => {
    const sx =
      ((x - (camera.position.x + camera.left)) / (camera.right - camera.left)) *
      hud.width
    const sy =
      ((z - (camera.position.z - camera.top)) / (camera.top - camera.bottom)) *
      hud.height
    return [sx, sy] as const
  }
  const css = (c: THREE.Color) => `#${c.getHexString()}`

  const drawHud = (t: number) => {
    const W = hud.width
    const H = hud.height
    const u = W / 1920
    hudCtx.clearRect(0, 0, W, H)
    const section = score.sectionAt(t)
    const bar = Math.max(0, Math.floor(score.pos(t) / 16))

    // title block
    hudCtx.fillStyle = css(INK.lead)
    hudCtx.font = `${86 * u}px Anton`
    hudCtx.textBaseline = 'alphabetic'
    hudCtx.fillText('CANDY PAINT', 64 * u, 128 * u)
    hudCtx.fillStyle = css(KEY)
    hudCtx.font = `500 ${15 * u}px "DM Mono"`
    hudCtx.fillText(
      'POST MALONE  /  PIANO  /  90 BPM  /  E MAJOR  /  IV—I',
      68 * u,
      160 * u
    )

    // section + counter, top right
    hudCtx.textAlign = 'right'
    hudCtx.fillStyle = css(INK.riff)
    hudCtx.font = `${58 * u}px Anton`
    hudCtx.fillText(
      section.label.replace(/ \(.*\)/, '').toUpperCase(),
      W - 64 * u,
      112 * u
    )
    hudCtx.fillStyle = css(KEY)
    hudCtx.font = `500 ${15 * u}px "DM Mono"`
    const part = section.id.endsWith('-drop') ? 'FULL  /  ' : ''
    hudCtx.fillText(
      `${part}BAR ${String(bar + 1).padStart(2, '0')} / ${score.data.bars}`,
      W - 66 * u,
      142 * u
    )
    hudCtx.textAlign = 'left'

    // system bracket joining the staves, where the page margin ends
    const [, yTop] = toScreen(0, layout.staffTopZ('sparkle'))
    const [, yBot] = toScreen(0, layout.staves.bass.z)
    const bx = (150 - 8) * u
    hudCtx.fillStyle = css(KEY)
    hudCtx.fillRect(bx, yTop, 5 * u, yBot - yTop)
    hudCtx.fillRect(bx, yTop, 14 * u, 2 * u)
    hudCtx.fillRect(bx, yBot - 2 * u, 14 * u, 2 * u)

    // staff labels in the left margin
    hudCtx.font = `500 ${12 * u}px "DM Mono"`
    for (const v of VOICE_ORDER) {
      const [, sy] = toScreen(0, layout.staffCenterZ(v))
      hudCtx.fillStyle = css(INK[v])
      hudCtx.fillRect(64 * u, sy - 4 * u, 8 * u, 8 * u)
      hudCtx.fillStyle = css(KEY)
      hudCtx.fillText(v.toUpperCase(), 80 * u, sy + 4 * u)
    }

    // chord symbols over the bass staff at each bar (the song is a two-chord loop: A to E)
    for (let b = bar - 4; b <= bar + 5; b++) {
      if (b < 0 || b >= score.data.bars) continue
      const root = score.data.chords[b]!
      const [sx, sy] = toScreen(
        layout.x(b * 16) + 0.03,
        layout.staffTopZ('bass') - 0.07
      )
      if (sx < 150 * u || sx > W - 60 * u) continue
      hudCtx.fillStyle = css(KEY)
      hudCtx.font = `${24 * u}px Anton`
      hudCtx.fillText(root, sx, sy)
      hudCtx.font = `500 ${11 * u}px "DM Mono"`
      hudCtx.fillText(root === 'A' ? 'IV' : 'I', sx + 18 * u, sy)
    }

    // playhead rule with registration marks
    const px = playFrac * W
    hudCtx.strokeStyle = css(KEY)
    hudCtx.lineWidth = 1 * u
    hudCtx.globalAlpha = 0.35
    hudCtx.beginPath()
    hudCtx.moveTo(px, 214 * u)
    hudCtx.lineTo(px, H - 132 * u)
    hudCtx.stroke()
    hudCtx.globalAlpha = 1
    for (const y of [200 * u, H - 118 * u]) {
      hudCtx.beginPath()
      hudCtx.arc(px, y, 9 * u, 0, Math.PI * 2)
      hudCtx.moveTo(px - 15 * u, y)
      hudCtx.lineTo(px + 15 * u, y)
      hudCtx.moveTo(px, y - 15 * u)
      hudCtx.lineTo(px, y + 15 * u)
      hudCtx.stroke()
    }

    // ink swatches, bottom left, like a print color bar
    VOICE_ORDER.forEach((v, i) => {
      hudCtx.fillStyle = css(INK[v])
      hudCtx.fillRect((64 + i * 26) * u, H - 76 * u, 20 * u, 20 * u)
    })
    hudCtx.fillStyle = css(KEY)
    hudCtx.font = `500 ${12 * u}px "DM Mono"`
    hudCtx.fillText(
      `${t.toFixed(2).padStart(6, '0')}s`,
      (64 + 4 * 26 + 10) * u,
      H - 61 * u
    )
    hudTex.needsUpdate = true
  }

  const m4 = new THREE.Matrix4()
  const placeDot = (
    mesh: THREE.Mesh,
    x: number,
    z: number,
    r: number,
    vx: number,
    vz: number,
    squash: number,
    stretchK: number
  ) => {
    const speed = Math.hypot(vx, vz)
    const stretch = Math.min(0.9, speed * stretchK)
    const dx = speed > 1e-4 ? vx / speed : 1
    const dz = speed > 1e-4 ? vz / speed : 0
    // 2D tensor in the page plane (x, z); squash flattens along screen-vertical (z)
    let a = 1 + stretch * dx * dx
    let b = stretch * dx * dz
    let d = 1 + stretch * dz * dz - Math.max(-0.4, Math.min(0.6, squash))
    const det = Math.max(1e-3, a * d - b * b)
    const k = r / Math.sqrt(det)
    a *= k
    b *= k
    d *= k
    m4.set(a, 0, b, x, 0, 1, 0, 0.002, b, 0, d, z, 0, 0, 0, 1)
    mesh.matrix.copy(m4)
    mesh.matrixWorldNeedsUpdate = true
  }

  const look: Look = {
    update(t) {
      const px = layout.playheadX(t)
      camera.position.set(px + viewW * (0.5 - playFrac), 10, zCenter)
      camera.lookAt(camera.position.x, 0, zCenter)
      camera.updateMatrixWorld()
      noteMat.uniforms.uTime!.value = t
      noteMat.uniforms.uPx!.value = 0.0045

      for (const p of performers) {
        const r = p.motion.params.radius * 1.15
        p.dots.forEach((dot, k) => {
          const tk = t - k * (1 / 45)
          const st = sampleRig(p.motion, tk)
          // the hop height lifts the dot up the page
          const zScreen = st.pos.z - st.pos.y * SCREEN_LIFT
          const vzScreen = st.vel.z - st.vel.y * SCREEN_LIFT
          placeDot(
            dot,
            st.pos.x,
            zScreen,
            r,
            st.vel.x,
            vzScreen,
            st.pose.squash,
            0.11
          )
          const fast = Math.min(1, Math.hypot(st.vel.x, vzScreen) / 2.5)
          ;(dot.material as THREE.ShaderMaterial).uniforms.uOpacity!.value =
            st.pose.visible * (k === 0 ? 1 : fast)
          dot.visible = st.pose.visible > 0.01
          if (k === 0) {
            // cast shadow on the page shrinks as the dot rises
            const lift = Math.min(1, st.pos.y / 0.6)
            placeDot(
              p.shadow,
              st.pos.x + 0.02,
              st.pos.z + 0.012,
              r * (1.05 - 0.55 * lift),
              0,
              0,
              0.45,
              0
            )
            ;(
              p.shadow.material as THREE.ShaderMaterial
            ).uniforms.uOpacity!.value = st.pose.visible * (1 - 0.6 * lift)
            p.shadow.visible = dot.visible
          }
        })
        // dotted motion path over the last half second
        const pos = p.trail.geometry.attributes
          .position as THREE.BufferAttribute
        const size = p.trail.geometry.attributes.aSize as THREE.BufferAttribute
        for (let i = 0; i < 24; i++) {
          const pose = p.motion.pose(t - 0.06 - i * 0.026)
          pos.setXYZ(i, pose.x, 0.002, pose.z - pose.y * SCREEN_LIFT)
          size.setX(
            i,
            pose.visible *
              (1 - i / 24) *
              5.5 *
              (renderer.domElement.width / 1920)
          )
        }
        pos.needsUpdate = true
        size.needsUpdate = true
      }
      drawHud(t)
    },
    render() {
      composer.render()
    },
    setSize(w, h) {
      const H = viewW / (w / h)
      camera.top = H / 2
      camera.bottom = -H / 2
      camera.updateProjectionMatrix()
      composer.setSize(w, h)
      hud.width = Math.round(w * renderer.getPixelRatio())
      hud.height = Math.round(h * renderer.getPixelRatio())
      MARGIN.value = (150 * hud.width) / 1920
    }
  }
  look.setSize(ctx.width, ctx.height)
  return look
}
