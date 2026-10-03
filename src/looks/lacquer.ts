// Look A, "Candy Lacquer": the score is pinstriped onto a black-cherry candy finish at night. Notes
// start as dark smoked glass and flood with candy paint when a performer lands on them; long notes
// fill like a gauge over their duration. Performers are hot pearls of light whose glow rakes across
// the clearcoat. Gold pinstripes, studio strip reflections, metal flake, shallow focus.

import {
  BloomEffect,
  DepthOfFieldEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  BlendFunction,
  Effect
} from 'postprocessing'
import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'

import { DEFAULT_TWEAKS, type Look, type LookContext } from '../look'
import { buildCast } from '../cast'
import { CreditsEffect } from '../credits'
import { ENTRANCES, type EntranceStyle } from '../entrance'
import { PosterEffect, type TitleAnchor } from '../poster'
import { Director, DROPS } from '../director'
import type { ChordMode } from '../lines'
import type { SpriteMotion } from '../motion'
import {
  deformMatrix,
  radialTexture,
  sampleRig,
  Trail,
  trailMaterial
} from '../rig'
import { VOICE_ORDER, type VoiceId } from '../score'
import { buildLines, buildNotes, recentImpacts } from '../stage'

function flakeNormalMap(size = 512, cell = 3, seed = 7) {
  let s = seed
  const rand = () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
  const data = new Uint8Array(size * size * 4)
  const cells = Math.ceil(size / cell)
  const nx: number[] = []
  const ny: number[] = []
  for (let i = 0; i < cells * cells; i++) {
    // mostly upward-facing flakes with random tilt, so only some catch the light at a time
    const a = rand() * Math.PI * 2
    const r = rand() ** 0.7 * 0.9
    nx.push(Math.cos(a) * r)
    ny.push(Math.sin(a) * r)
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ci = Math.floor(y / cell) * cells + Math.floor(x / cell)
      const i = (y * size + x) * 4
      const fx = nx[ci]!
      const fy = ny[ci]!
      const fz = Math.sqrt(Math.max(0, 1 - fx * fx - fy * fy))
      data[i] = Math.round((fx * 0.5 + 0.5) * 255)
      data[i + 1] = Math.round((fy * 0.5 + 0.5) * 255)
      data[i + 2] = Math.round((fz * 0.5 + 0.5) * 255)
      data[i + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = 8
  tex.needsUpdate = true
  return tex
}

/** A night "studio": long overhead strip lights (warm), a cool rim and a faint magenta neon. */
function environment(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#020103')
  const strip = (
    w: number,
    h: number,
    color: string,
    intensity: number,
    pos: [number, number, number],
    rot: [number, number, number]
  ) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(intensity),
        side: THREE.DoubleSide
      })
    )
    m.position.set(...pos)
    m.rotation.set(...rot)
    scene.add(m)
  }
  // soft night sky: a dark dome with a faint warm city glow at the horizon
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(30, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vDir; void main() {
        float h = vDir.y;
        vec3 c = mix(vec3(0.05, 0.025, 0.03), vec3(0.004, 0.004, 0.012), smoothstep(-0.05, 0.5, h));
        c += vec3(0.16, 0.07, 0.04) * exp(-pow(h / 0.08, 2.0)) * 0.6;
        gl_FragColor = vec4(c, 1.0);
      }`
    })
  )
  scene.add(dome)
  // a few long thin strips ahead of the camera: these are the classic streaks across a car hood
  strip(60, 0.18, '#ffd9b0', 1.5, [8, 3.2, -6], [Math.PI / 2.6, 0, 0])
  strip(60, 0.1, '#ffe8d0', 1.2, [8, 5.5, -3], [Math.PI / 2.2, 0, 0])
  strip(60, 0.08, '#9cc2ff', 1.6, [8, 2.2, -10], [Math.PI / 3, 0, 0])
  strip(60, 0.12, '#ff5aa8', 0.9, [8, 1.2, 9], [-Math.PI / 3, 0, 0])
  const pmrem = new THREE.PMREMGenerator(renderer)
  const env = pmrem.fromScene(scene, 0.02).texture
  pmrem.dispose()
  return env
}

const ROUGHNESS_LOD = 4.2

class GroundReflection {
  readonly reflector: Reflector
  constructor(width: number, height: number) {
    const shader = {
      name: 'LacquerReflection',
      uniforms: {
        color: { value: null },
        tDiffuse: { value: null },
        textureMatrix: { value: null },
        uLod: { value: ROUGHNESS_LOD },
        uStrength: { value: 0.55 }
      },
      vertexShader: /* glsl */ `
        uniform mat4 textureMatrix;
        varying vec4 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = textureMatrix * vec4(position, 1.0);
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uLod;
        uniform float uStrength;
        varying vec4 vUv;
        varying vec3 vWorld;
        void main() {
          vec2 uv = vUv.xy / vUv.w;
          // clearcoat is glassy: a sharp reflection plus a soft halo from the blurred mips
          vec3 sharp = textureLod(tDiffuse, uv, 0.6).rgb;
          vec3 soft = textureLod(tDiffuse, uv, uLod).rgb;
          vec3 c = mix(sharp, soft, 0.62);
          vec3 v = normalize(cameraPosition - vWorld);
          float fres = 0.04 + 0.96 * pow(1.0 - clamp(v.y, 0.0, 1.0), 5.0);
          float a = clamp(uStrength * (0.35 + 0.65 * fres), 0.0, 1.0);
          gl_FragColor = vec4(c * a, 1.0);
        }`
    }
    this.reflector = new Reflector(new THREE.PlaneGeometry(width, height), {
      textureWidth: 1024,
      textureHeight: 1024,
      clipBias: 0.002,
      shader
    })
    const rt = this.reflector.getRenderTarget()
    rt.texture.generateMipmaps = true
    rt.texture.minFilter = THREE.LinearMipmapLinearFilter
    rt.texture.type = THREE.HalfFloatType
    const mat = this.reflector.material as THREE.ShaderMaterial
    mat.transparent = true
    mat.blending = THREE.AdditiveBlending
    mat.depthWrite = false
    this.reflector.rotation.x = -Math.PI / 2
    this.reflector.position.y = 0.0004
    this.reflector.renderOrder = -1
  }

  setSize(w: number, h: number) {
    this.reflector
      .getRenderTarget()
      .setSize(Math.round(w * 0.75), Math.round(h * 0.75))
  }
}

function noteMaterial(env: THREE.Texture, palette: Record<VoiceId, string>) {
  const uniforms = {
    uTime: { value: 0 },
    uColors: { value: VOICE_ORDER.map((v) => new THREE.Color(palette[v])) },
    uEmber: { value: 1 }
  }
  const mat = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    metalness: 0.7,
    roughness: 0.26,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMap: env,
    envMapIntensity: 1.1
  })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        attribute float aOnset;
        attribute float aDur;
        attribute float aVel;
        attribute float aVoice;
        attribute float aLocal;
        attribute float aRide;
        attribute float aFillStart;
        uniform float uTime;
        varying float vOnset;
        varying float vDur;
        varying float vVel;
        varying float vVoice;
        varying float vLocal;
        varying float vRide;
        varying float vFillStart;`
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vOnset = aOnset; vDur = aDur; vVel = aVel; vVoice = aVoice; vLocal = aLocal; vRide = aRide; vFillStart = aFillStart;
        float age = uTime - aOnset;
        // keys give a little under the performer's weight, then spring back
        float press = age >= 0.0 ? exp(-age / 0.09) * (0.4 + aVel) : 0.0;
        transformed.y -= 0.007 * press * smoothstep(0.0, 0.02, transformed.y);`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uTime;
        uniform float uEmber;
        uniform vec3 uColors[4];
        varying float vOnset;
        varying float vDur;
        varying float vVel;
        varying float vVoice;
        varying float vLocal;
        varying float vRide;
        varying float vFillStart;`
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec3 candy = uColors[int(vVoice + 0.5)];
        float age = uTime - vOnset;
        float hit = step(0.0, age);
        // candy floods from the head along the pill, pushed by the performer riding it
        float fill = hit * (vFillStart + clamp(age / vRide, 0.0, 1.0) * (1.0 - vFillStart));
        float filled = hit * (1.0 - smoothstep(fill - 0.04, fill + 0.02, vLocal));
        vec3 primer = vec3(0.012, 0.010, 0.014) + candy * 0.012;
        diffuseColor.rgb = mix(primer, candy * 0.75, filled);`
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        float flash = hit * exp(-age / 0.14) * (0.55 + vVel);
        float sounding = hit * (1.0 - smoothstep(vDur, vDur + 0.6, age));
        float approach = (1.0 - hit) * smoothstep(-0.28, 0.0, age);
        // after it sounds, the paint keeps a low ember so the score accumulates color
        float ember = hit * mix(0.12, 0.035, smoothstep(0.0, 6.0, age - vDur)) * uEmber;
        totalEmissiveRadiance += candy * (flash * 6.0 * filled + sounding * filled * 0.55 + ember * filled + approach * 0.3);`
      )
  }
  return { mat, uniforms }
}

function lineMaterial() {
  const uniforms = { uTime: { value: 0 } }
  const mat = new THREE.MeshStandardMaterial({
    color: '#d9b77a',
    metalness: 1,
    roughness: 0.28,
    emissive: '#3a2a12',
    emissiveIntensity: 1
  })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aKind;
        attribute float aTime;
        varying float vKind;
        varying float vTime;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvKind = aKind; vTime = aTime;`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        varying float vKind;
        varying float vTime;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float a = uTime - vTime;
        // bar lines glint as the playhead crosses them
        float glint = vKind > 0.5 && vKind < 1.5 && a >= 0.0 ? exp(-a / 0.12) : 0.0;
        totalEmissiveRadiance *= vKind > 0.5 ? 0.6 : 1.0;
        totalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * glint * 0.7;`
      )
  }
  return { mat, uniforms }
}

function rippleMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color() },
      uAge: { value: 0 },
      uStrength: { value: 1 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uAge;
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float rad = 1.0 - exp(-uAge / 0.22);
        float ring = exp(-pow((r - rad) / 0.05, 2.0));
        float fade = exp(-uAge / 0.35) * uStrength;
        float core = exp(-pow(r / 0.25, 2.0)) * exp(-uAge / 0.08);
        float a = (ring * 0.7 + core) * fade;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
}

/** A hot pearl: white-hot core, candy-colored fresnel rim. */
function pearlMaterial(color: THREE.Color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uGlow: { value: 0.5 },
      uOpacity: { value: 1 }
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uGlow;
      uniform float uOpacity;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.5);
        vec3 core = mix(vec3(1.0, 0.97, 0.94), uColor, 0.42) * (1.1 + 1.7 * uGlow);
        vec3 rim = uColor * (1.5 + 2.4 * uGlow);
        gl_FragColor = vec4(mix(core, rim, f) * uOpacity, uOpacity);
      }`,
    transparent: true
  })
}

/** Fade to and from black, applied after tone mapping. */
class FadeEffect extends Effect {
  constructor() {
    super(
      'FadeEffect',
      'uniform float uFade; void mainImage(const in vec4 c, const in vec2 uv, out vec4 o) { o = vec4(c.rgb * uFade, c.a); }',
      {
        uniforms: new Map([['uFade', new THREE.Uniform(1)]])
      }
    )
  }
  set fade(v: number) {
    this.uniforms.get('uFade')!.value = v
  }
}

interface Performer {
  voice: VoiceId
  line: number
  motion: SpriteMotion
  body: THREE.Mesh
  bodyMat: THREE.ShaderMaterial
  halo: THREE.Sprite
  light: THREE.PointLight
  trail: Trail
  trailMat: THREE.ShaderMaterial
  color: THREE.Color
}

export async function createLacquer(ctx: LookContext): Promise<Look> {
  const { renderer, score, layout } = ctx
  // live adjustments from the web player; renders always get the defaults
  const tweaks = () => ctx.tweaks ?? DEFAULT_TWEAKS
  const palette = tweaks().palette
  // type is drawn into canvases (credits, intro title): fonts must be ready first
  await CreditsEffect.loadFonts()
  // the intro: frame 0 is a title over the riff's two performers,
  // who enter on screen and land the opening chord; the camera then follows them into the song
  // the video opens with the skip entrance; ?intro=arc tries the other, ?intro=none disables it
  const introParam = (ctx.query.get('intro') ?? 'skip') as
    | EntranceStyle
    | 'none'
  const intro =
    introParam !== 'none' && ENTRANCES.includes(introParam) ? introParam : null
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#030204')
  scene.fog = new THREE.FogExp2('#030204', 0.07)
  const env = environment(renderer)
  scene.environment = env

  const camera = new THREE.PerspectiveCamera(
    28,
    ctx.width / ctx.height,
    0.05,
    80
  )
  camera.layers.enable(0)

  // ground: black cherry candy over silver flake, under a glassy clearcoat
  const songLength = layout.x(score.data.bars * 16) + 40
  const flakes = flakeNormalMap()
  flakes.repeat.set(songLength * 3, 60 * 3)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(songLength, 60),
    new THREE.MeshPhysicalMaterial({
      color: '#1a0710',
      metalness: 0.75,
      roughness: 0.42,
      normalMap: flakes,
      normalScale: new THREE.Vector2(0.55, 0.55),
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      envMapIntensity: 0.9
    })
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.x = songLength / 2 - 20
  scene.add(ground)

  const reflection = new GroundReflection(songLength, 60)
  reflection.reflector.position.x = ground.position.x
  scene.add(reflection.reflector)

  // one overhead light bar per musical bar, visible only in the lacquer's reflection: as the camera
  // cruises along the song they streak across the finish on the downbeats, like tunnel lights on a hood
  const zTop = layout.staffTopZ('sparkle') - 0.6
  const zBot = layout.staves.bass.z + 0.6
  const barLight = new THREE.BoxGeometry(0.14, 0.02, zBot - zTop)
  const warmBase = new THREE.Color('#ffc890').multiplyScalar(0.28)
  const warm = new THREE.MeshBasicMaterial({
    color: warmBase.clone(),
    fog: false
  })
  for (let bar = -2; bar <= score.data.bars + 4; bar++) {
    const m = new THREE.Mesh(barLight, warm)
    m.position.set(
      layout.x(bar * 16) - layout.opts.unit16 * 0.5,
      2.6,
      (zTop + zBot) / 2
    )
    m.layers.set(1)
    scene.add(m)
  }

  reflection.reflector.getReflectionCamera(camera).layers.enable(1)

  const lines = lineMaterial()
  scene.add(
    new THREE.Mesh(buildLines(score, layout, { width: 0.0055 }), lines.mat)
  )

  const mode = (ctx.query.get('chords') ?? 'bud') as ChordMode
  const cast = buildCast(score, layout, mode, {}, intro ?? undefined)
  const notes = noteMaterial(env, palette)
  const noteMesh = new THREE.Mesh(
    buildNotes(
      score,
      layout,
      {},
      undefined,
      (n) => cast.ride.get(n.index) ?? n.d
    ),
    notes.mat
  )
  noteMesh.frustumCulled = false
  scene.add(noteMesh)

  // performers
  const haloTex = radialTexture(128, 2.4)
  const performers: Performer[] = cast.performers.map(
    ({ voice, line, motion }) => {
      const color = new THREE.Color(palette[voice])
      const bodyMat = pearlMaterial(color)
      const body = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 5), bodyMat)
      body.matrixAutoUpdate = false
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: haloTex,
          color,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true
        })
      )
      const light = new THREE.PointLight(color, 0, 1.6, 2)
      const trailMat = trailMaterial(color, 1.6)
      const trail = new Trail(trailMat)
      scene.add(body, halo, light, trail.mesh)
      return {
        voice,
        line,
        motion,
        body,
        bodyMat,
        halo,
        light,
        trail,
        trailMat,
        color
      }
    }
  )
  // repaint every voice when the player's palette changes
  let paletteKey = JSON.stringify(palette)
  const repaint = (next: Record<VoiceId, string>) => {
    const key = JSON.stringify(next)
    if (key === paletteKey) return
    paletteKey = key
    VOICE_ORDER.forEach((v, i) => notes.uniforms.uColors.value[i]!.set(next[v]))
    for (const p of performers) {
      p.color.set(next[p.voice])
      p.halo.material.color.copy(p.color)
      p.light.color.copy(p.color)
      ;(p.trailMat.uniforms.uColor!.value as THREE.Color)
        .copy(p.color)
        .multiplyScalar(1.6)
    }
  }

  const ripplePool = Array.from({ length: 24 }, () => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), rippleMaterial())
    m.rotation.x = -Math.PI / 2
    m.position.y = 0.0015
    m.visible = false
    scene.add(m)
    return m
  })

  // post
  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: 4
  })
  composer.addPass(new RenderPass(scene, camera))
  const dof = new DepthOfFieldEffect(camera, {
    focusDistance: 3,
    focusRange: 1.6,
    bokehScale: 3.2,
    resolutionScale: 0.75
  })
  const bloom = new BloomEffect({
    mipmapBlur: true,
    intensity: 1.15,
    luminanceThreshold: 0.55,
    luminanceSmoothing: 0.2,
    radius: 0.72,
    levels: 8
  })
  const grain = new NoiseEffect({
    premultiply: true,
    blendFunction: BlendFunction.SCREEN
  })
  grain.blendMode.opacity.value = 0.035
  const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.72 })
  const fader = new FadeEffect()
  const credits = new CreditsEffect(score)
  const posterFx = new PosterEffect()
  composer.addPass(new EffectPass(camera, dof))
  composer.addPass(
    new EffectPass(
      camera,
      bloom,
      vignette,
      new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
      credits,
      posterFx,
      grain,
      fader,
      new SMAAEffect()
    )
  )

  const mat4 = new THREE.Matrix4()
  const focusTarget = new THREE.Vector3()

  const director = new Director(
    score,
    layout,
    intro ?? undefined,
    ctx.height > ctx.width
  )
  // the drop shockwave rolls out from the bass's landing on each drop downbeat
  const shockMat = rippleMaterial()
  const shockwave = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shockMat)
  shockwave.rotation.x = -Math.PI / 2
  shockwave.visible = false
  scene.add(shockwave)
  const bassMain = performers.find(
    (p) => p.voice === 'bass' && p.line === 0
  )!.motion
  const dropOrigins = DROPS.map((bar) => {
    const e = bassMain.events.find((ev) => ev.s >= bar * 16)!
    return {
      t: e.t,
      x: layout.x(e.target.s) + layout.noteWidth / 2,
      z: layout.z('bass', e.target.step)
    }
  })

  const placeCamera = (t: number) => {
    const tw = tweaks()
    const shot = ctx.tweaks?.shot ?? ctx.shot
    dof.bokehScale = 3.2 * tw.focus
    grain.blendMode.opacity.value = tw.grain
    vignette.darkness = tw.vignette
    if (shot === 'director') {
      const st = director.state(t, tw.impact)
      camera.fov = st.fov
      camera.position.set(...st.position)
      focusTarget.set(...st.target)
      camera.updateProjectionMatrix()
      camera.lookAt(focusTarget)
      dof.target = focusTarget
      dof.cocMaterial.focusRange = st.range
      // the overhead bar lights only read as reflections at low angles; from above they'd look solid
      const dy = st.position[1] - st.target[1]
      const elevation = Math.atan2(
        dy,
        Math.hypot(st.position[0] - st.target[0], st.position[2] - st.target[2])
      )
      const steep = Math.min(1, Math.max(0, (elevation - 0.38) / 0.22))
      warm.color
        .copy(warmBase)
        .multiplyScalar(1 - steep * steep * (3 - 2 * steep))
      ;(scene.fog as THREE.FogExp2).density = st.fog * tw.fog
      notes.uniforms.uEmber.value = st.ember * tw.ember
      fader.fade = st.fade
      const flash = st.shock
        ? 1.4 * tw.impact * Math.exp(-st.shock.age / 0.22)
        : 0
      bloom.intensity = (st.bloom + flash) * tw.bloom
      const drop = dropOrigins.find((d) => t >= d.t && t < d.t + 2.5)
      shockwave.visible = !!drop && tw.impact > 0
      if (drop) {
        const age = t - drop.t
        shockwave.position.set(drop.x, 0.002, drop.z)
        shockwave.scale.set(9, 9, 1)
        shockMat.uniforms.uAge!.value = age * 0.3
        shockMat.uniforms.uStrength!.value = 1.6 * tw.impact
        ;(shockMat.uniforms.uColor!.value as THREE.Color)
          .set(tw.palette.bass)
          .lerp(new THREE.Color('#ffffff'), 0.35)
      }
      return
    }
    // the fixed framings keep the look's base fog, glow and exposure
    ;(scene.fog as THREE.FogExp2).density = 0.07 * tw.fog
    notes.uniforms.uEmber.value = tw.ember
    fader.fade = 1
    bloom.intensity = 1.15 * tw.bloom
    shockwave.visible = false
    const px = layout.playheadX(t)
    const zMid = (layout.staffCenterZ('riff') + layout.staffCenterZ('lead')) / 2
    switch (shot) {
      case 'wide':
        camera.fov = 32
        camera.position.set(px - 3.2, 2.6, 2.9)
        focusTarget.set(px + 0.6, 0, zMid)
        break

      case 'close':
        // close on the riff and lead staves, high enough to read chords and held notes
        camera.fov = 24
        camera.position.set(px - 1.7, 1.15, layout.staffCenterZ('riff') + 2.0)
        focusTarget.set(px + 0.2, 0.03, layout.staffCenterZ('riff') - 0.35)
        break

      case 'low':
        camera.fov = 26
        camera.position.set(px - 1.4, 0.32, 1.25)
        focusTarget.set(px + 0.55, 0.05, layout.staffCenterZ('riff'))
        break

      default:
        camera.fov = 19
        camera.position.set(px - 3.4, 1.5, 3.3)
        focusTarget.set(px + 0.45, 0.04, zMid + 0.1)
    }
    camera.updateProjectionMatrix()
    camera.lookAt(focusTarget)
    dof.target = focusTarget
    dof.cocMaterial.focusRange =
      shot === 'wide' ? 2.4 : shot === 'close' ? 1.6 : 1.3
  }

  // the intro title holds its spot top left while the camera starts following the riff, then the
  // camera passes it: from LINGER on it's a point in the foreground of the scene, left behind
  const LINGER = 3.4
  // in a tall frame the title spans nearly the whole width, so it sits deeper in the scene and
  // eases off for longer: it drifts out to the left instead of being swept away
  const tall = ctx.height > ctx.width
  const TITLE_DEPTH = tall ? 3.0 : 1.4
  const HANDOFF = tall ? 1.6 : 0.9
  // and mostly keeps its height, so the camera's rise doesn't drag it down on the way out
  const RISE = tall ? 0.3 : 1
  const probe = new THREE.PerspectiveCamera()
  const aimProbe = (t: number) => {
    const st = director.state(t)
    probe.fov = st.fov
    probe.aspect = camera.aspect
    probe.updateProjectionMatrix()
    probe.position.set(...st.position)
    probe.lookAt(...st.target)
    probe.updateMatrixWorld()
    return probe
  }
  let titlePoint: THREE.Vector3 | null = null
  const titleAnchor = (t: number): TitleAnchor => {
    const W = renderer.domElement.width
    const H = renderer.domElement.height
    // scale by the short side; a tall frame gives the title more headroom
    const u = Math.min(W, H) / 1080
    const home = {
      x: (H > W ? 90 : 110) * u,
      y: (H > W ? 170 : 70) * u,
      scale: 1
    }
    if (t <= LINGER) return home
    if (!titlePoint) {
      // the point in the scene, just in front of the camera, behind the title's center at LINGER
      const cam = aimProbe(LINGER)
      const ndc = new THREE.Vector3(
        ((home.x + 400 * u) / W) * 2 - 1,
        1 - ((home.y + 150 * u) / H) * 2,
        0.5
      )
      const dir = ndc.unproject(cam).sub(cam.position).normalize()
      titlePoint = cam.position.clone().addScaledVector(dir, TITLE_DEPTH)
    }
    const at = (tt: number) => {
      const cam = aimProbe(tt)
      const v = titlePoint!.clone().project(cam)
      return { x: v.x, y: v.y, dist: cam.position.distanceTo(titlePoint!) }
    }
    const a = at(LINGER)
    const b = at(t)
    // ease the hand-off so the title's motion starts gently instead of jumping to the camera's speed
    const e = Math.min(1, (t - LINGER) / HANDOFF)
    const k = e * e * (3 - 2 * e)
    return {
      x: home.x + (((b.x - a.x) * W) / 2) * k,
      y: home.y - (((b.y - a.y) * H) / 2) * k * RISE,
      scale: 1 + (a.dist / b.dist - 1) * k
    }
  }

  const look: Look = {
    update(t) {
      const tw = tweaks()
      repaint(tw.palette)
      placeCamera(t)
      const directed = (ctx.tweaks?.shot ?? ctx.shot) === 'director'
      // with an intro, frame 0 is lit instead of fading up from black
      if (intro && t < 1) fader.fade = 1
      credits.draw(t)
      posterFx.draw(t, intro && directed ? titleAnchor(t) : null)
      notes.uniforms.uTime.value = t
      lines.uniforms.uTime.value = t
      for (const p of performers) {
        const st = sampleRig(p.motion, t)
        const r = p.motion.params.radius * (st.pose.size ?? 1) * tw.size
        deformMatrix(st, r, 0.09, mat4)
        p.body.matrix.copy(mat4)
        p.body.matrixWorldNeedsUpdate = true
        const vis = st.pose.visible
        const glow = st.pose.glow * tw.glow
        p.body.visible = vis > 0.01
        p.bodyMat.uniforms.uOpacity!.value = vis
        p.bodyMat.uniforms.uGlow!.value = glow
        p.halo.position.copy(st.pos)
        const hs = r * (4.5 + 3 * glow)
        p.halo.scale.set(hs, hs, 1)
        p.halo.material.opacity = 0.35 * vis * Math.min(1.4, glow)
        p.light.position.set(st.pos.x, st.pos.y + r * 1.5, st.pos.z)
        p.light.intensity =
          0.25 * vis * (0.4 + glow) * (p.voice === 'bass' ? 1.6 : 1)
        if (tw.trail > 0)
          p.trail.update(p.motion, t, 0.42 * tw.trail, r * 0.55, camera)
        p.trail.mesh.visible = vis > 0.01 && tw.trail > 0
      }
      const impacts = recentImpacts(score, layout, t, 0.9)
      const take = impacts.slice(-ripplePool.length)
      ripplePool.forEach((m, i) => {
        const imp = take[i]
        m.visible = !!imp
        if (!imp) return
        const mat = m.material as THREE.ShaderMaterial
        const size =
          imp.voice === 'bass' ? 0.9 : imp.voice === 'sparkle' ? 0.25 : 0.45
        m.position.set(imp.x, 0.0015, imp.z)
        m.scale.set(size, size, 1)
        mat.uniforms.uAge!.value = t - imp.t
        mat.uniforms.uStrength!.value = 0.5 + imp.vel
        ;(mat.uniforms.uColor!.value as THREE.Color).set(tw.palette[imp.voice])
      })
    },
    render() {
      composer.render()
    },
    dispose() {
      scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        o.geometry.dispose()
        const mats: THREE.Material[] = Array.isArray(o.material)
          ? o.material
          : [o.material]
        for (const m of mats) m.dispose()
      })
      for (const p of performers) p.halo.material.dispose()
      reflection.reflector.dispose()
      composer.dispose()
      env.dispose()
      flakes.dispose()
      haloTex.dispose()
    },
    setSize(w, h) {
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      composer.setSize(w, h)
      reflection.setSize(
        w * renderer.getPixelRatio(),
        h * renderer.getPixelRatio()
      )
    }
  }
  look.setSize(ctx.width, ctx.height)
  return look
}
