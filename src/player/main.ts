// The interactive player: the engine renders the video live, in sync with the MP3. Nothing is
// pre-rendered; the page's only assets are the song and its score.

import 'dialkit/vanilla/styles.css'
import './player.css'

import * as THREE from 'three'

import { Layout } from '../layout'
import { DEFAULT_TWEAKS, type Look, type Tweaks } from '../look'
import { createLacquer } from '../looks/lacquer'
import { loadScore } from '../score'
import { createChrome } from './chrome'
import { SongClock } from './clock'
import { createPanel, DEFAULT_SETUP, type Setup } from './panel'

/** pixels per frame the auto quality aims for, and the floor it may drop to */
const PIXEL_BUDGET = { auto: 2.1e6, low: 0.9e6 }
const MIN_AUTO_SCALE = 0.55

async function main() {
  const score = await loadScore('data/score.json')
  const layout = new Layout(score)
  const clock = new SongClock(
    'media/candy-paint-instrumental.mp3',
    score.data.duration
  )
  let dirty = true
  const chrome = createChrome(score, clock, {
    invalidate: () => (dirty = true)
  })

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false
  })
  const stage = document.querySelector<HTMLElement>('.stage')!
  stage.append(renderer.domElement)

  const tweaks: Tweaks = structuredClone(DEFAULT_TWEAKS)
  let setup: Setup = DEFAULT_SETUP
  let look: Look | null = null
  let vertical = false
  let building = false
  let generation = 0
  // auto quality steps the resolution down when frames run long, never back up mid-session
  let autoScale = 1

  /** the frame in CSS pixels: the whole window, or a 16:9 / 9:16 frame fit inside it */
  const frameSize = () => {
    // a page loaded hidden (a background tab) has no size yet; the resize observer catches up
    const W = Math.max(1, stage.clientWidth)
    const H = Math.max(1, stage.clientHeight)
    const aspect =
      setup.format === 'landscape'
        ? 16 / 9
        : setup.format === 'portrait'
          ? 9 / 16
          : W / H
    const h = Math.min(H, W / aspect)
    return {
      w: Math.max(1, Math.round(h * aspect)),
      h: Math.max(1, Math.round(h))
    }
  }
  const pixelRatio = (w: number, h: number) => {
    const dpr = Math.min(2, devicePixelRatio || 1)
    if (setup.quality === 'high') return dpr
    const budget = PIXEL_BUDGET[setup.quality]
    const scale = setup.quality === 'auto' ? autoScale : 1
    return Math.min(dpr, Math.sqrt(budget / (w * h))) * scale
  }

  const build = async () => {
    const gen = ++generation
    building = true
    const { w, h } = frameSize()
    renderer.setPixelRatio(pixelRatio(w, h))
    renderer.setSize(w, h)
    const next = await createLacquer({
      renderer,
      score,
      layout,
      width: w,
      height: h,
      shot: 'director',
      query: new URLSearchParams({ chords: setup.chords, intro: setup.intro }),
      tweaks
    })
    if (gen !== generation) {
      next.dispose?.()
      return
    }
    look?.dispose?.()
    look = next
    vertical = h > w
    building = false
    dirty = true
  }

  const resize = () => {
    if (!look || building) return
    const { w, h } = frameSize()
    // the storyboard has a separate camera for tall frames
    if (h > w !== vertical) {
      void build()
      return
    }
    renderer.setPixelRatio(pixelRatio(w, h))
    renderer.setSize(w, h)
    look.setSize(w, h)
    dirty = true
  }
  new ResizeObserver(resize).observe(stage)

  createPanel(tweaks, {
    tweak: () => (dirty = true),
    setup: (next) => {
      const rebuild = next.chords !== setup.chords || next.intro !== setup.intro
      if (next.quality !== setup.quality) autoScale = 1
      setup = next
      if (rebuild) void build()
      else resize()
    }
  })

  await build()

  // frame pacing for auto quality: the mean frame time over a window of played frames
  let lastNow = 0
  let slow = 0
  let frames = 0
  const adapt = (now: number) => {
    const dt = now - lastNow
    lastNow = now
    if (setup.quality !== 'auto' || !clock.playing || dt > 100) return
    slow += dt
    if (++frames < 45) return
    const mean = slow / frames
    slow = 0
    frames = 0
    if (mean > 22 && autoScale > MIN_AUTO_SCALE) {
      autoScale = Math.max(MIN_AUTO_SCALE, autoScale * 0.85)
      resize()
    }
  }

  let shownT = -1
  const frame = (now: number) => {
    requestAnimationFrame(frame)
    const t = clock.time(now)
    chrome.paint(t)
    if (!look || building) return
    // paused and unchanged: keep the last frame instead of re-rendering it
    if (!clock.playing && !dirty && t === shownT) return
    look.update(t)
    look.render()
    shownT = t
    dirty = false
    adapt(now)
  }
  requestAnimationFrame((now) => {
    frame(now)
    chrome.ready()
  })
}

main().catch((err: unknown) => {
  console.error(err)
  document.body.classList.add('failed')
  const message = document.querySelector('.loader-message')
  if (message)
    message.textContent =
      'The player needs WebGL 2 and a recent browser. Try Chrome, Safari or Firefox.'
})
