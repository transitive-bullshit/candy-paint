// A sprite performer in 3D: a body mesh that squashes and stretches along its velocity, an optional
// halo and light, and a ribbon trail sampled from its own (pure) motion history.

import * as THREE from 'three'

import type { Pose, SpriteMotion } from './motion'

const UP = new THREE.Vector3(0, 1, 0)

export interface RigState {
  pose: Pose
  pos: THREE.Vector3
  vel: THREE.Vector3
  speed: number
}

export function sampleRig(
  motion: SpriteMotion,
  t: number,
  out?: RigState
): RigState {
  const h = 1 / 240
  const pose = motion.pose(t)
  const a = motion.pose(t - h)
  const b = motion.pose(t + h)
  const s = out ?? {
    pose,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    speed: 0
  }
  s.pose = pose
  s.pos.set(pose.x, pose.y, pose.z)
  s.vel.set((b.x - a.x) / (2 * h), (b.y - a.y) / (2 * h), (b.z - a.z) / (2 * h))
  s.speed = s.vel.length()
  return s
}

const tmpDir = new THREE.Vector3()
const m3 = new THREE.Matrix3()

/**
 * Squash/stretch as a symmetric scale tensor: S = I + stretch * d d^T - squash * u u^T, volume
 * normalized. Continuous through contact, unlike switching orientation frames.
 */
export function deformMatrix(
  state: RigState,
  radius: number,
  stretchK: number,
  out: THREE.Matrix4
) {
  const stretch = Math.min(0.55, state.speed * stretchK)
  const squash = Math.max(-0.4, Math.min(0.6, state.pose.squash))
  tmpDir.copy(state.vel)
  if (state.speed > 1e-4) tmpDir.multiplyScalar(1 / state.speed)
  else tmpDir.copy(UP)
  const d = tmpDir
  const e: number[] = []
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const di = i === 0 ? d.x : i === 1 ? d.y : d.z
      const dj = j === 0 ? d.x : j === 1 ? d.y : d.z
      const ui = i === 1 ? 1 : 0
      const uj = j === 1 ? 1 : 0
      e.push((i === j ? 1 : 0) + stretch * di * dj - squash * ui * uj)
    }
  }
  m3.fromArray(e).transpose()
  const det = Math.max(1e-3, m3.determinant())
  const k = radius / Math.cbrt(det)
  const m = m3.elements
  out.set(
    m[0]! * k,
    m[3]! * k,
    m[6]! * k,
    state.pos.x,
    m[1]! * k,
    m[4]! * k,
    m[7]! * k,
    // keep the sprite resting on the paper while squashed
    state.pos.y - radius * Math.max(0, squash) * 0.5,
    m[2]! * k,
    m[5]! * k,
    m[8]! * k,
    state.pos.z,
    0,
    0,
    0,
    1
  )
  return out
}

/** Camera-facing ribbon through recent positions. Alpha and width fade toward the tail. */
export class Trail {
  readonly mesh: THREE.Mesh
  private readonly geo: THREE.BufferGeometry
  private readonly positions: Float32Array
  private readonly alphas: Float32Array
  private readonly samples: number

  constructor(material: THREE.Material, samples = 48) {
    this.samples = samples
    this.geo = new THREE.BufferGeometry()
    this.positions = new Float32Array(samples * 2 * 3)
    this.alphas = new Float32Array(samples * 2)
    const index: number[] = []
    for (let i = 0; i < samples - 1; i++) {
      const a = i * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    this.geo.setIndex(index)
    this.geo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3).setUsage(
        THREE.DynamicDrawUsage
      )
    )
    this.geo.setAttribute(
      'aAlpha',
      new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage)
    )
    this.mesh = new THREE.Mesh(this.geo, material)
    this.mesh.frustumCulled = false
  }

  /**
   * @param length seconds of history
   * @param width world width at the head
   */
  update(
    motion: SpriteMotion,
    t: number,
    length: number,
    width: number,
    camera: THREE.Camera,
    minAlpha = 0
  ) {
    const n = this.samples
    const pts: THREE.Vector3[] = []
    const vis: number[] = []
    for (let i = 0; i < n; i++) {
      // denser sampling near the head
      const u = (i / (n - 1)) ** 1.6
      const p = motion.pose(t - u * length)
      pts.push(new THREE.Vector3(p.x, p.y, p.z))
      vis.push(p.visible)
    }
    const camPos = camera.position
    const side = new THREE.Vector3()
    const tangent = new THREE.Vector3()
    const view = new THREE.Vector3()
    for (let i = 0; i < n; i++) {
      const p = pts[i]!
      const q = pts[Math.min(n - 1, i + 1)]!
      const o = pts[Math.max(0, i - 1)]!
      tangent.subVectors(o, q)
      if (tangent.lengthSq() < 1e-10) tangent.set(1, 0, 0)
      tangent.normalize()
      view.subVectors(camPos, p).normalize()
      side.crossVectors(tangent, view).normalize()
      const f = 1 - i / (n - 1)
      const w = width * (0.25 + 0.75 * f)
      this.positions.set(
        [p.x + side.x * w, p.y + side.y * w, p.z + side.z * w],
        i * 6
      )
      this.positions.set(
        [p.x - side.x * w, p.y - side.y * w, p.z - side.z * w],
        i * 6 + 3
      )
      const a = Math.max(minAlpha * Math.min(1, f / 0.2), f * f) * vis[i]!
      this.alphas[i * 2] = a
      this.alphas[i * 2 + 1] = a
    }
    this.geo.attributes.position!.needsUpdate = true
    this.geo.attributes.aAlpha!.needsUpdate = true
  }
}

export function trailMaterial(color: THREE.ColorRepresentation, intensity = 1) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color).multiplyScalar(intensity) }
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(uColor * vAlpha, vAlpha);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  })
}

/** Soft radial gradient texture for halos and bokeh. */
export function radialTexture(size = 128, falloff = 2.2) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5
      const dy = (y + 0.5) / size - 0.5
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2)
      const a = Math.max(0, 1 - r) ** falloff
      const i = (y * size + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
