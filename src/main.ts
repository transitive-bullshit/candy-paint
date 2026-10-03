// Entry point. Two modes:
// - preview (default): plays the song with a scrubbable timeline, rendering in real time
// - render (?mode=render): exposes window.renderFrame(t) for deterministic headless capture

import * as THREE from 'three'

import { createSegmentEncoder } from './encode'
import { Layout } from './layout'
import type { Look, LookFactory } from './look'
import { createExposure } from './looks/exposure'
import { createLacquer } from './looks/lacquer'
import { createSleeve } from './looks/sleeve'
import { AUDIO_URL } from './media'
import { loadScore } from './score'

const LOOKS: Record<string, LookFactory> = {
  lacquer: createLacquer,
  exposure: createExposure,
  sleeve: createSleeve
}

declare global {
  interface Window {
    renderFrame?: (t: number) => Promise<void>
    /** offline renders: encode segments of frames in the page (WebCodecs) */
    segmentEncoder?: ReturnType<typeof createSegmentEncoder>
    lookReady?: boolean
    lookError?: string
  }
}

async function main() {
  const params = new URLSearchParams(location.search)
  const mode = params.get('mode') ?? 'preview'
  const lookName = params.get('look') ?? 'lacquer'
  const width = Number(params.get('w') ?? 1920)
  const height = Number(params.get('h') ?? 1080)
  const dpr = Number(
    params.get('dpr') ?? (mode === 'render' ? 1 : Math.min(2, devicePixelRatio))
  )
  const shot = params.get('shot') ?? 'hero'
  const startTime = Number(params.get('t') ?? 0)

  const score = await loadScore()
  const layout = new Layout(score)

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    preserveDrawingBuffer: mode === 'render',
    powerPreference: 'high-performance',
    stencil: false
  })
  renderer.setPixelRatio(dpr)
  const canvas = renderer.domElement
  document.body.appendChild(canvas)

  const factory = LOOKS[lookName]
  if (!factory) throw new Error(`unknown look: ${lookName}`)

  const fit = () => {
    if (mode === 'render') return { w: width, h: height }
    const s = Math.min(innerWidth / width, innerHeight / height)
    return { w: Math.round(width * s), h: Math.round(height * s) }
  }
  const size = fit()
  renderer.setSize(size.w, size.h)
  const look: Look = await factory({
    renderer,
    score,
    layout,
    width: size.w,
    height: size.h,
    shot,
    query: params
  })

  if (mode === 'render') {
    document.body.classList.add('render')
    window.renderFrame = async (t: number) => {
      look.update(t)
      look.render()
      renderer.getContext().finish()
    }
    window.segmentEncoder = createSegmentEncoder(renderer.domElement, (t) => {
      look.update(t)
      look.render()
    })
    window.lookReady = true
    return
  }

  // preview
  const audio = new Audio(AUDIO_URL)
  audio.preload = 'auto'
  audio.currentTime = startTime
  const ui = document.createElement('div')
  ui.className = 'ui'
  ui.innerHTML = `
    <button data-play>Play</button>
    <input data-scrub type="range" min="0" max="${score.data.duration}" step="0.01" value="${startTime}" />
    <span data-time></span>
    <span data-section></span>`
  document.body.appendChild(ui)
  const playBtn = ui.querySelector<HTMLButtonElement>('[data-play]')!
  const scrub = ui.querySelector<HTMLInputElement>('[data-scrub]')!
  const timeEl = ui.querySelector<HTMLSpanElement>('[data-time]')!
  const sectionEl = ui.querySelector<HTMLSpanElement>('[data-section]')!
  const toggle = () => {
    if (audio.paused) void audio.play()
    else audio.pause()
  }
  playBtn.onclick = toggle
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault()
      toggle()
    }
    if (e.code === 'ArrowRight')
      audio.currentTime += e.shiftKey ? score.bar : score.beat
    if (e.code === 'ArrowLeft')
      audio.currentTime -= e.shiftKey ? score.bar : score.beat
  })
  scrub.oninput = () => {
    audio.currentTime = Number(scrub.value)
  }
  addEventListener('resize', () => {
    const s = fit()
    renderer.setSize(s.w, s.h)
    look.setSize(s.w, s.h)
  })

  const tick = () => {
    const t = audio.currentTime
    look.update(t)
    look.render()
    playBtn.textContent = audio.paused ? 'Play' : 'Pause'
    if (document.activeElement !== scrub) scrub.value = String(t)
    const bar = Math.floor(score.pos(t) / 16)
    timeEl.textContent = `${t.toFixed(2)}s  bar ${bar}`
    sectionEl.textContent = score.sectionAt(t).label
    requestAnimationFrame(tick)
  }
  tick()
}

main().catch((err: unknown) => {
  console.error(err)
  window.lookError = String(
    err instanceof Error ? (err.stack ?? err.message) : err
  )
})
