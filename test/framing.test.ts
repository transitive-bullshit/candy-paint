import { readFileSync } from 'node:fs'

import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { buildCast } from '../src/cast'
import { Director } from '../src/director'
import { Layout } from '../src/layout'
import { Score, type ScoreData } from '../src/score'

// The framing contract for 9:16: the camera follows the cast, so every visible performer stays in
// frame. Brief exits are tolerated (a hop arc grazing the edge); the credits reveal is exempt,
// since that shot deliberately rises away from the performers.
describe('9:16 framing', () => {
  it('keeps the visible performers in frame', { timeout: 60_000 }, () => {
    const score = new Score(
      JSON.parse(readFileSync('data/score.json', 'utf8')) as ScoreData
    )
    const layout = new Layout(score)
    const { performers } = buildCast(score, layout, 'bud', {}, 'skip')
    const aspect = 9 / 16
    const director = new Director(score, layout, 'skip', true)
    director.keepInFrame(
      (t) =>
        performers.map(({ motion }) => {
          const p = motion.pose(t)
          return { x: p.x, y: p.y, z: p.z, visible: p.visible }
        }),
      aspect
    )
    const camera = new THREE.PerspectiveCamera(30, aspect, 0.05, 80)
    const v = new THREE.Vector3()
    const reveal = score.barTime(82)
    let samples = 0
    let outside = 0
    let run = 0
    let longest = 0
    for (let t = 0; t < reveal; t += 1 / 30) {
      const st = director.state(t)
      camera.fov = st.fov
      camera.position.set(...st.position)
      camera.lookAt(...st.target)
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld()
      const out = performers.some(({ motion }) => {
        const p = motion.pose(t)
        if (p.visible < 0.5) return false
        v.set(p.x, p.y, p.z).project(camera)
        return Math.abs(v.x) > 1 || Math.abs(v.y) > 1 || v.z > 1
      })
      samples++
      if (out) outside++
      run = out ? run + 1 / 30 : 0
      longest = Math.max(longest, run)
    }
    expect(outside / samples).toBeLessThan(0.03)
    expect(longest).toBeLessThan(0.5)
  })
})
