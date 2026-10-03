// The player's chrome: transport bar, a seek bar split into the song's sections, the center play
// button, keyboard shortcuts and the shortcuts sheet. All page UI; the picture is the engine.

import type { Score } from '../score'
import type { SongClock } from './clock'

interface Chapter {
  label: string
  start: number
  end: number
  drop: boolean
}

const pick = <T extends Element = HTMLElement>(selector: string) => {
  const el = document.querySelector<T>(selector)
  if (!el) throw new Error(`missing ${selector}`)
  return el
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** 83.417 -> "1:23.41" (precise) or "1:23" */
export function formatTime(t: number, precise = false) {
  const cs = Math.floor(Math.max(0, t) * 100)
  const m = Math.floor(cs / 6000)
  const s = (cs % 6000) / 100
  return precise
    ? `${m}:${s.toFixed(2).padStart(5, '0')}`
    : `${m}:${Math.floor(s).toString().padStart(2, '0')}`
}

function chaptersOf(score: Score): Chapter[] {
  const { sections, duration } = score.data
  return sections.map((s, i) => {
    const drop = s.id.endsWith('-drop')
    return {
      // the storyboard calls the full-band hooks drops
      label: drop
        ? s.label.replace(/^Hook (\S+) \(full\)$/, 'Drop $1')
        : s.label,
      start: i === 0 ? 0 : score.barTime(s.start),
      end: i === sections.length - 1 ? duration : score.barTime(s.end),
      drop
    }
  })
}

const VOLUME_KEY = 'candy-paint:volume'

export function createChrome(
  score: Score,
  clock: SongClock,
  hooks: { invalidate(): void }
) {
  const { body } = document
  const { audio, duration } = clock
  const chapters = chaptersOf(score)
  // a little slack: the audio element rounds seeks, which can land a hair before a boundary
  const chapterAt = (t: number) =>
    chapters.findLast((c) => c.start <= t + 0.01) ?? chapters[0]!

  const seek = pick('.seek')
  const rail = pick('.seek-rail')
  const tip = pick('.seek-tip')
  const tipTime = pick('.seek-tip .time')
  const tipLabel = pick('.seek-tip .label')
  const nowEl = pick('.clock .now')
  const sectionEl = pick('.where .section')
  const barEl = pick('.where .bar-number')
  const transport = pick('.transport')
  const flash = pick('.flash')
  const sheet = pick('.sheet')
  const volume = pick<HTMLInputElement>('.volume input')
  pick('.clock .total').textContent = formatTime(duration)

  // the sections, cut into the rail as hairline gaps; drops get a brighter base
  const gaps = chapters.slice(1).map((c) => {
    const p = `${((c.start / duration) * 100).toFixed(3)}%`
    return `#000 calc(${p} - 1.5px), transparent calc(${p} - 1.5px), transparent calc(${p} + 1.5px), #000 calc(${p} + 1.5px)`
  })
  const mask = `linear-gradient(90deg, #000 0, ${gaps.join(', ')}, #000 100%)`
  rail.style.setProperty('mask-image', mask)
  rail.style.setProperty('-webkit-mask-image', mask)
  for (const c of chapters.filter((ch) => ch.drop)) {
    const el = document.createElement('i')
    el.className = 'seek-drop'
    el.style.left = `${(c.start / duration) * 100}%`
    el.style.width = `${((c.end - c.start) / duration) * 100}%`
    rail.prepend(el)
  }

  // feedback in the middle of the frame, like a premium video player
  const pulse = (icon: 'play' | 'pause' | 'back' | 'forward') => {
    flash.dataset.icon = icon
    flash.classList.remove('go')
    void flash.offsetWidth
    flash.classList.add('go')
  }

  const toggle = () => {
    pulse(clock.playing ? 'pause' : 'play')
    clock.toggle()
  }
  const seekTo = (t: number) => {
    clock.seek(t)
    body.classList.remove('fresh', 'ended')
    hooks.invalidate()
  }
  const seekBy = (dt: number) => {
    pulse(dt < 0 ? 'back' : 'forward')
    seekTo(clock.time() + dt)
  }
  const step = (frames: number) => {
    clock.step(frames)
    body.classList.remove('fresh', 'ended')
    hooks.invalidate()
  }
  const jumpSection = (dir: 1 | -1) => {
    const t = clock.time()
    if (dir > 0) {
      seekTo(chapters.find((c) => c.start > t + 0.01)?.start ?? duration)
      return
    }
    // back goes to the start of this section first, unless we're just past it
    const current = chapters.indexOf(chapterAt(t))
    const target = t - chapters[current]!.start > 1.5 ? current : current - 1
    seekTo(chapters[Math.max(0, target)]!.start)
  }

  // volume, remembered per viewer
  const setVolume = (v: number) => {
    audio.volume = clamp(v, 0, 1)
    audio.muted = audio.volume === 0
  }
  try {
    const saved = Number(localStorage.getItem(VOLUME_KEY) ?? 1)
    if (Number.isFinite(saved)) setVolume(saved)
  } catch {}
  audio.addEventListener('volumechange', () => {
    const v = audio.muted ? 0 : audio.volume
    volume.value = String(v)
    volume.style.setProperty('--v', String(v))
    body.classList.toggle('muted', v === 0)
    try {
      localStorage.setItem(VOLUME_KEY, String(audio.volume))
    } catch {}
  })
  volume.value = String(audio.muted ? 0 : audio.volume)
  volume.style.setProperty('--v', volume.value)
  volume.addEventListener('input', () => setVolume(Number(volume.value)))
  const toggleMute = () => {
    if (audio.muted || audio.volume === 0) {
      audio.muted = false
      if (audio.volume === 0) audio.volume = 0.8
    } else audio.muted = true
  }

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen().catch(() => {})
  }
  if (!document.fullscreenEnabled) body.classList.add('no-fullscreen')
  document.addEventListener('fullscreenchange', () =>
    body.classList.toggle('fullscreen', !!document.fullscreenElement)
  )

  const setSheet = (open: boolean) => {
    sheet.classList.toggle('open', open)
    sheet.setAttribute('aria-hidden', String(!open))
    body.classList.toggle('sheet-open', open)
  }

  // buttons; a mouse click shouldn't leave focus behind for Space to re-trigger
  const actions: Record<string, () => void> = {
    play: toggle,
    mute: toggleMute,
    fullscreen,
    keys: () => setSheet(!sheet.classList.contains('open')),
    close: () => setSheet(false)
  }
  for (const btn of document.querySelectorAll<HTMLButtonElement>(
    '[data-action]'
  )) {
    btn.addEventListener('click', (e) => {
      actions[btn.dataset.action!]?.()
      if (e.detail > 0) btn.blur()
    })
  }
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) setSheet(false)
  })
  // on touch, the first tap on a playing video brings the chrome back instead of pausing
  let revealing = false
  const stage = pick('.stage')
  stage.addEventListener('pointerdown', (e) => {
    revealing = e.pointerType === 'touch' && body.classList.contains('idle')
  })
  stage.addEventListener('click', () => {
    if (!revealing) toggle()
  })

  // seek bar: hover preview, drag to scrub (paused while scrubbing, resumes after)
  let dragging = false
  let resume = false
  const timeAt = (e: PointerEvent) => {
    const r = rail.getBoundingClientRect()
    return clamp((e.clientX - r.left) / r.width, 0, 1) * duration
  }
  const hover = (t: number) => {
    const r = rail.getBoundingClientRect()
    const x = clamp((t / duration) * r.width, 34, r.width - 34)
    seek.style.setProperty('--h', String(t / duration))
    tip.style.setProperty('--tip-x', `${x}px`)
    tipTime.textContent = formatTime(t)
    tipLabel.textContent = chapterAt(t).label
  }
  seek.addEventListener('pointerdown', (e) => {
    seek.setPointerCapture(e.pointerId)
    dragging = true
    resume = clock.playing
    clock.pause()
    seek.classList.add('dragging')
    hover(timeAt(e))
    seekTo(timeAt(e))
  })
  seek.addEventListener('pointermove', (e) => {
    hover(timeAt(e))
    if (dragging) seekTo(timeAt(e))
  })
  const release = () => {
    if (!dragging) return
    dragging = false
    seek.classList.remove('dragging')
    if (resume) clock.play()
  }
  seek.addEventListener('pointerup', release)
  seek.addEventListener('pointercancel', release)

  // idle: while playing, the chrome and cursor fade away until the pointer moves
  let overChrome = false
  let idleTimer = 0
  transport.addEventListener('pointerenter', () => (overChrome = true))
  transport.addEventListener('pointerleave', () => (overChrome = false))
  const wake = () => {
    body.classList.remove('idle')
    clearTimeout(idleTimer)
    idleTimer = window.setTimeout(() => {
      const busy =
        dragging ||
        overChrome ||
        body.classList.contains('panel-open') ||
        body.classList.contains('sheet-open')
      if (clock.playing && !busy) body.classList.add('idle')
    }, 2600)
  }
  addEventListener('pointermove', wake)
  addEventListener('pointerdown', wake)

  audio.addEventListener('play', () => {
    body.classList.add('playing')
    body.classList.remove('fresh', 'ended')
    wake()
  })
  audio.addEventListener('pause', () => {
    body.classList.remove('playing')
    wake()
  })
  audio.addEventListener('ended', () => body.classList.add('ended'))

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const el = e.target instanceof Element ? e.target : document.body
    if (el.closest('.dialkit-root')) return
    if (el instanceof HTMLInputElement && el.type !== 'range') return
    // a focused control keeps Space and Enter, and a focused slider its arrows
    if ((e.key === ' ' || e.key === 'Enter') && el.closest('button, a')) return
    if (el instanceof HTMLInputElement && e.key.startsWith('Arrow')) return
    const bar = score.bar
    const keys: Record<string, () => void> = {
      ' ': toggle,
      k: toggle,
      ArrowRight: () => seekBy(e.shiftKey ? bar : 5),
      ArrowLeft: () => seekBy(e.shiftKey ? -bar : -5),
      l: () => seekBy(10),
      j: () => seekBy(-10),
      '.': () => step(1),
      ',': () => step(-1),
      ']': () => jumpSection(1),
      '[': () => jumpSection(-1),
      Home: () => seekTo(0),
      End: () => seekTo(duration),
      ArrowUp: () => setVolume(audio.volume + 0.1),
      ArrowDown: () => setVolume(audio.volume - 0.1),
      m: toggleMute,
      f: fullscreen,
      '?': () => setSheet(!sheet.classList.contains('open')),
      Escape: () => setSheet(false)
    }
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
    const action =
      keys[key] ??
      (/^\d$/.test(key)
        ? () => seekTo((duration * Number(key)) / 10)
        : undefined)
    if (!action) return
    e.preventDefault()
    action()
    wake()
  })

  // OS media controls (lock screen, keyboard media keys)
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'Candy Paint',
      artist: 'Molotov Cocktail Piano',
      album: 'Post Malone, instrumental'
    })
    const session = navigator.mediaSession
    session.setActionHandler('play', () => clock.play())
    session.setActionHandler('pause', () => clock.pause())
    session.setActionHandler('seekbackward', () => seekBy(-10))
    session.setActionHandler('seekforward', () => seekBy(10))
    session.setActionHandler('seekto', (d) => seekTo(d.seekTime ?? 0))
  }

  let shown = ''
  return {
    /** keep the transport in step with the picture; called every frame */
    paint(t: number) {
      const p = clamp(t / duration, 0, 1)
      seek.style.setProperty('--p', p.toFixed(5))
      const chapter = chapterAt(t)
      const bar = clamp(Math.floor(score.pos(t) / 16) + 1, 1, score.data.bars)
      const text = `${formatTime(t, true)}|${chapter.label}|${bar}`
      if (text === shown) return
      shown = text
      nowEl.textContent = formatTime(t, true)
      sectionEl.textContent = chapter.label
      barEl.textContent = `Bar ${bar}`
      seek.setAttribute('aria-valuenow', t.toFixed(1))
      seek.setAttribute(
        'aria-valuetext',
        `${formatTime(t)} of ${formatTime(duration)}, ${chapter.label}`
      )
    },
    ready() {
      body.classList.remove('loading')
    }
  }
}
