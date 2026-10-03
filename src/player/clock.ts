// The song clock. The audio element is the master; its currentTime only advances in coarse steps,
// so while it plays the picture follows a smooth clock that's eased back onto the audio every frame.

/** frame rate of the rendered video, for frame stepping */
export const FPS = 60

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export class SongClock {
  readonly audio: HTMLAudioElement
  readonly duration: number
  private base = 0
  private baseAt = 0
  private running = false

  constructor(src: string, duration: number) {
    this.duration = duration
    const audio = new Audio(src)
    audio.preload = 'auto'
    this.audio = audio
    const start = () => {
      this.sync()
      this.running = true
    }
    const stop = () => {
      this.running = false
    }
    audio.addEventListener('playing', start)
    audio.addEventListener('seeked', () => {
      if (!audio.paused) start()
    })
    for (const type of ['pause', 'waiting', 'seeking', 'ended'])
      audio.addEventListener(type, stop)
  }

  get playing() {
    return !this.audio.paused && !this.audio.ended
  }

  /** song time for a frame drawn at `now` (performance.now()) */
  time(now = performance.now()) {
    // the decoded MP3 runs a few ms past the score's end; the score is the timeline
    const heard = clamp(this.audio.currentTime, 0, this.duration)
    if (!this.running || this.audio.paused) return heard
    const t = this.base + ((now - this.baseAt) / 1000) * this.audio.playbackRate
    const drift = heard - t
    if (Math.abs(drift) > 0.1) {
      this.sync(now)
      return heard
    }
    this.base += drift * 0.03
    return clamp(t, 0, this.duration)
  }

  play() {
    if (this.audio.ended || this.audio.currentTime >= this.duration - 0.05)
      this.seek(0)
    void this.audio.play().catch(() => {})
  }

  pause() {
    this.audio.pause()
  }

  toggle() {
    if (this.playing) this.pause()
    else this.play()
  }

  seek(t: number) {
    this.audio.currentTime = clamp(t, 0, this.duration)
    this.sync()
  }

  /** pause and move whole frames, landing on the frame grid of the rendered video */
  step(frames: number) {
    this.pause()
    this.seek((Math.round(this.audio.currentTime * FPS) + frames) / FPS)
  }

  private sync(now = performance.now()) {
    this.base = this.audio.currentTime
    this.baseAt = now
  }
}
