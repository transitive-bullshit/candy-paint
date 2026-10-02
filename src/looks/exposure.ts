// Look B, "Long Exposure": the song as a night highway shot from an overpass on a long exposure.
// Staves are lane lines on wet asphalt, every bar sits under a sodium streetlight, notes are road
// reflectors that catch the light as performers pass, and each performer leaves a seconds-long light
// trail, so the melody's contour is painted in light the way cars paint a freeway at night.

import {
  BloomEffect,
  BlendFunction,
  DepthOfFieldEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect
} from 'postprocessing'
import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'

import type { Look, LookContext } from '../look'
import { SpriteMotion } from '../motion'
import {
  deformMatrix,
  radialTexture,
  sampleRig,
  Trail,
  trailMaterial
} from '../rig'
import { VOICE_ORDER, type VoiceId } from '../score'
import { buildLines, buildNotes } from '../stage'

/** Photographic light colors: tail lights, headlights, turn signals, sparkle. */
const LIGHT: Record<VoiceId, string> = {
  lead: '#ff2b2b',
  riff: '#d6ecff',
  bass: '#ff9b2e',
  sparkle: '#fff1c2'
}

const SODIUM = new THREE.Color('#ff9a3c')

// GLSL shared by the asphalt, paint and studs: value noise, puddles, and sodium pools per bar
const COMMON_GLSL = /* glsl */ `
  uniform float uBarLen;
  uniform float uBar0;
  uniform vec2 uLampZ;
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
  }
  float puddle(vec2 xz) {
    return smoothstep(0.56, 0.62, fbm(xz * vec2(0.55, 0.9) + 3.0));
  }
  // irradiance from the streetlights: one per bar, alternating sides of the road, 3 units up
  float pools(vec3 w) {
    float k = floor((w.x - uBar0) / uBarLen);
    float sum = 0.0;
    for (int j = -1; j <= 2; j++) {
      float b = k + float(j);
      float lx = uBar0 + b * uBarLen + 0.35 * uBarLen;
      float lz = mod(b, 2.0) < 0.5 ? uLampZ.x : uLampZ.y;
      vec3 d = vec3(lx, 2.2, lz) - w;
      float r2 = dot(d, d);
      float r = sqrt(r2);
      // a downlight cone: tight pools with darkness between bars
      float spot = pow(d.y / r, 7.0);
      sum += spot * d.y / (r2 * r);
    }
    return sum * 5.5;
  }
`

function injectWorldPos(shader: {
  vertexShader: string
  fragmentShader: string
}) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
    .replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;'
    )
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>\nvarying vec3 vW;\n${COMMON_GLSL}`
  )
}

function asphaltMaterial(common: Record<string, THREE.IUniform>) {
  const mat = new THREE.MeshStandardMaterial({
    color: '#141416',
    roughness: 0.9,
    metalness: 0
  })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, common)
    injectWorldPos(shader)
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float grit = hash12(floor(vW.xz * 900.0));
        float n = fbm(vW.xz * 6.0);
        float wet = puddle(vW.xz);
        diffuseColor.rgb *= 0.55 + 0.6 * n + 0.35 * step(0.93, grit);
        diffuseColor.rgb *= mix(1.0, 0.45, wet);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.92, 0.08, puddle(vW.xz));`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vec3(${SODIUM.r.toFixed(3)}, ${SODIUM.g.toFixed(3)}, ${SODIUM.b.toFixed(3)}) * pools(vW) * 1.4;`
      )
  }
  return mat
}

function paintMaterial(common: Record<string, THREE.IUniform>) {
  const mat = new THREE.MeshStandardMaterial({
    color: '#bdb6a8',
    roughness: 0.75
  })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, common)
    injectWorldPos(shader)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      // worn paint: broken in places, retroreflective under the lamps
      float wear = smoothstep(0.35, 0.6, fbm(vW.xz * vec2(3.0, 40.0)));
      diffuseColor.rgb *= mix(0.25, 1.0, wear);
      totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.75, 0.5) * pools(vW) * 0.55 + diffuseColor.rgb * 0.008;`
    )
  }
  return mat
}

function studMaterial(common: Record<string, THREE.IUniform>) {
  const uniforms = {
    ...common,
    uTime: { value: 0 },
    uColors: { value: VOICE_ORDER.map((v) => new THREE.Color(LIGHT[v])) }
  }
  const mat = new THREE.MeshStandardMaterial({
    color: '#2a2a2e',
    roughness: 0.35,
    metalness: 0.2
  })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    injectWorldPos(shader)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aOnset; attribute float aDur; attribute float aVel; attribute float aVoice; attribute float aLocal;
        varying float vOnset; varying float vDur; varying float vVel; varying float vVoice; varying float vLocal;`
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvOnset = aOnset; vDur = aDur; vVel = aVel; vVoice = aVoice; vLocal = aLocal;'
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime; uniform vec3 uColors[4];
        varying float vOnset; varying float vDur; varying float vVel; varying float vVoice; varying float vLocal;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 col = uColors[int(vVoice + 0.5)];
        float age = uTime - vOnset;
        float hit = step(0.0, age);
        float flash = hit * exp(-age / 0.2) * (0.6 + vVel);
        float sounding = hit * (1.0 - smoothstep(vDur, vDur + 0.8, age));
        float after = hit * mix(0.12, 0.04, smoothstep(0.0, 8.0, age));
        float fill = hit * (1.0 - smoothstep(0.15 + age / max(vDur, 0.06) - 0.03, 0.15 + age / max(vDur, 0.06), vLocal));
        totalEmissiveRadiance += col * (flash * 5.0 + sounding * 0.7 * fill + after);
        totalEmissiveRadiance += diffuseColor.rgb * pools(vW) * 0.6;`
      )
  }
  return { mat, uniforms }
}

function puddleReflection(
  width: number,
  height: number,
  common: Record<string, THREE.IUniform>
) {
  const shader = {
    name: 'PuddleReflection',
    uniforms: {
      ...common,
      color: { value: null },
      tDiffuse: { value: null },
      textureMatrix: { value: null }
    },
    vertexShader: /* glsl */ `
      uniform mat4 textureMatrix;
      varying vec4 vUv;
      varying vec3 vW;
      void main() {
        vUv = textureMatrix * vec4(position, 1.0);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      varying vec4 vUv;
      varying vec3 vW;
      ${COMMON_GLSL}
      void main() {
        float wet = puddle(vW.xz);
        // ripples in the water break up the reflection a little
        vec2 jitter = vec2(vnoise(vW.xz * 40.0), vnoise(vW.xz * 40.0 + 9.0)) - 0.5;
        vec2 uv = vUv.xy / vUv.w + jitter * 0.004;
        vec3 sharp = textureLod(tDiffuse, uv, 0.5).rgb;
        vec3 soft = textureLod(tDiffuse, uv, 3.5).rgb;
        // damp asphalt between puddles still smears the lights a little
        vec3 c = sharp * wet * 0.85 + soft * (0.05 + 0.3 * wet);
        gl_FragColor = vec4(c, 1.0);
      }`
  }
  const r = new Reflector(new THREE.PlaneGeometry(width, height), {
    textureWidth: 1024,
    textureHeight: 1024,
    clipBias: 0.002,
    shader
  })
  const rt = r.getRenderTarget()
  rt.texture.generateMipmaps = true
  rt.texture.minFilter = THREE.LinearMipmapLinearFilter
  rt.texture.type = THREE.HalfFloatType
  const mat = r.material as THREE.ShaderMaterial
  mat.transparent = true
  mat.blending = THREE.AdditiveBlending
  mat.depthWrite = false
  r.rotation.x = -Math.PI / 2
  r.position.y = 0.0004
  return r
}

/** Out-of-focus city behind the road: thousands of small lights that the lens turns into bokeh. */
function city(length: number) {
  const n = 2600
  const pos = new Float32Array(n * 3)
  const col = new Float32Array(n * 3)
  const palette = [
    new THREE.Color('#ffb46b'),
    new THREE.Color('#ffe2b8'),
    new THREE.Color('#ff4a4a'),
    new THREE.Color('#9ec8ff')
  ]
  let s = 11
  const rand = () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
  for (let i = 0; i < n; i++) {
    pos[i * 3] = -30 + rand() * (length + 60)
    pos[i * 3 + 1] = rand() ** 2 * 7
    pos[i * 3 + 2] = -14 - rand() * 30
    const c = palette[
      Math.floor(rand() * palette.length)
    ]!.clone().multiplyScalar(0.6 + rand() * 2.2)
    col.set([c.r, c.g, c.b], i * 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const m = new THREE.PointsMaterial({
    size: 0.09,
    map: radialTexture(64, 1.2),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false
  })
  return new THREE.Points(g, m)
}

interface Performer {
  voice: VoiceId
  motion: SpriteMotion
  body: THREE.Mesh
  streak: THREE.Sprite
  glow: THREE.Sprite
  light: THREE.PointLight
  trail: Trail
}

export async function createExposure(ctx: LookContext): Promise<Look> {
  const { renderer, score, layout } = ctx
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#05060a')
  scene.fog = new THREE.FogExp2('#05060a', 0.05)
  scene.add(new THREE.HemisphereLight('#2a3a5a', '#120a06', 0.12))

  const camera = new THREE.PerspectiveCamera(
    24,
    ctx.width / ctx.height,
    0.05,
    120
  )
  const songLength = layout.x(score.data.bars * 16) + 40
  const zTop = layout.staffTopZ('sparkle')
  const zBot = layout.staves.bass.z
  const common: Record<string, THREE.IUniform> = {
    uBarLen: { value: layout.x(16) },
    uBar0: { value: layout.x(0) - layout.opts.unit16 * 0.5 },
    uLampZ: { value: new THREE.Vector2(zTop - 1.1, zBot + 1.1) }
  }

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(songLength, 80),
    asphaltMaterial(common)
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.x = songLength / 2 - 20
  scene.add(ground)
  const reflector = puddleReflection(songLength, 80, common)
  reflector.position.x = ground.position.x
  scene.add(reflector)

  scene.add(
    new THREE.Mesh(
      buildLines(score, layout, { width: 0.0085, height: 0.0015 }),
      paintMaterial(common)
    )
  )
  const studs = studMaterial(common)
  const noteMesh = new THREE.Mesh(
    buildNotes(score, layout, { widthFrac: 0.55, height: 0.008, bevel: 0.008 }),
    studs.mat
  )
  noteMesh.frustumCulled = false
  scene.add(noteMesh)
  scene.add(city(songLength))

  // the lamp heads themselves only show up in the puddles
  const lampMat = new THREE.MeshBasicMaterial({
    color: SODIUM.clone().multiplyScalar(3),
    fog: false
  })
  const lampGeo = new THREE.BoxGeometry(0.22, 0.04, 0.09)
  for (let bar = -6; bar <= score.data.bars + 6; bar++) {
    const lamp = new THREE.Mesh(lampGeo, lampMat)
    const side =
      ((bar % 2) + 2) % 2 === 0
        ? (common.uLampZ!.value as THREE.Vector2).x
        : (common.uLampZ!.value as THREE.Vector2).y
    lamp.position.set(
      layout.x(bar * 16) - layout.opts.unit16 * 0.5 + 0.35 * layout.x(16),
      2.2,
      side
    )
    lamp.layers.set(1)
    scene.add(lamp)
  }
  reflector.getReflectionCamera(camera).layers.enable(1)

  const glowTex = radialTexture(128, 2.6)
  const performers: Performer[] = VOICE_ORDER.map((voice) => {
    const color = new THREE.Color(LIGHT[voice])
    const motion = new SpriteMotion(score, layout, voice, score.events[voice])
    const body = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 4),
      new THREE.MeshBasicMaterial({
        color: color
          .clone()
          .lerp(new THREE.Color('#fff'), 0.6)
          .multiplyScalar(6)
      })
    )
    body.matrixAutoUpdate = false
    const streak = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true
      })
    )
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true
      })
    )
    const light = new THREE.PointLight(color, 0, 2.2, 2)
    const trail = new Trail(trailMaterial(color, 2.4), 420)
    scene.add(body, streak, glow, light, trail.mesh)
    return { voice, motion, body, streak, glow, light, trail }
  })

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: 4
  })
  composer.addPass(new RenderPass(scene, camera))
  const dof = new DepthOfFieldEffect(camera, {
    focusDistance: 5,
    focusRange: 2.6,
    bokehScale: 5.5,
    resolutionScale: 0.75
  })
  const grain = new NoiseEffect({
    premultiply: true,
    blendFunction: BlendFunction.SCREEN
  })
  grain.blendMode.opacity.value = 0.06
  composer.addPass(new EffectPass(camera, dof))
  composer.addPass(
    new EffectPass(
      camera,
      new BloomEffect({
        mipmapBlur: true,
        intensity: 1.6,
        luminanceThreshold: 0.5,
        luminanceSmoothing: 0.25,
        radius: 0.8
      }),
      new VignetteEffect({ offset: 0.28, darkness: 0.8 }),
      new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
      grain,
      new SMAAEffect()
    )
  )

  const focus = new THREE.Vector3()
  const mat4 = new THREE.Matrix4()
  const zMid = (zTop + zBot) / 2

  const placeCamera = (t: number) => {
    const px = layout.playheadX(t)
    if (ctx.shot === 'low') {
      camera.fov = 22
      camera.position.set(px - 2.6, 0.45, zBot + 1.6)
      focus.set(px + 0.4, 0.05, layout.staffCenterZ('riff'))
    } else if (ctx.shot === 'wide') {
      camera.fov = 30
      camera.position.set(px - 1.2, 5.6, zBot + 4.6)
      focus.set(px + 0.6, 0, zMid)
    } else {
      camera.fov = 24
      camera.position.set(px - 1.4, 3.4, zBot + 3.6)
      focus.set(px + 0.55, 0, zMid + 0.2)
    }
    camera.updateProjectionMatrix()
    camera.lookAt(focus)
    dof.target = focus
  }

  const look: Look = {
    update(t) {
      placeCamera(t)
      studs.uniforms.uTime.value = t
      for (const p of performers) {
        const st = sampleRig(p.motion, t)
        const r = p.motion.params.radius * 0.55
        deformMatrix(st, r, 0.06, mat4)
        p.body.matrix.copy(mat4)
        p.body.matrixWorldNeedsUpdate = true
        const vis = st.pose.visible
        p.body.visible = vis > 0.01
        // anamorphic streak: a wide, thin flare like a headlight through a cinema lens
        p.streak.position.copy(st.pos)
        p.streak.scale.set(r * 34 * (0.6 + 0.4 * st.pose.glow), r * 1.6, 1)
        p.streak.material.opacity = 0.5 * vis * st.pose.glow
        p.glow.position.copy(st.pos)
        p.glow.scale.setScalar(r * (8 + 5 * st.pose.glow))
        p.glow.material.opacity = 0.6 * vis
        p.light.position.copy(st.pos).y += 0.05
        p.light.intensity = 0.5 * vis * (0.5 + st.pose.glow)
        p.trail.update(p.motion, t, 3.6, r * 0.42, camera, 0.18)
        p.trail.mesh.visible = vis > 0.01 || t > p.motion.events[0]!.t
      }
    },
    render() {
      composer.render()
    },
    setSize(w, h) {
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      composer.setSize(w, h)
      reflector
        .getRenderTarget()
        .setSize(
          Math.round(w * renderer.getPixelRatio() * 0.75),
          Math.round(h * renderer.getPixelRatio() * 0.75)
        )
    }
  }
  look.setSize(ctx.width, ctx.height)
  return look
}
