// Offline encoding inside the page: each finished frame goes from the canvas straight to the
// browser's hardware H.264 encoder (WebCodecs), with no readback of raw pixels. Node collects the
// compressed Annex B stream, about 170 kB a frame at 4K, where a raw frame is 33 MB.

export interface SegmentOptions {
  width: number
  height: number
  fps: number
  bitrate: number
  /** frames between keyframes; a segment always starts on one */
  keyInterval: number
}

/** High profile at the lowest level that fits the frame size and rate (4.2, 5.1 or 5.2) */
function avcCodec(width: number, height: number, fps: number) {
  const mbps = Math.ceil(width / 16) * Math.ceil(height / 16) * fps
  const level = mbps <= 522_240 ? '2a' : mbps <= 983_040 ? '33' : '34'
  return `avc1.6400${level}`
}

export function createSegmentEncoder(
  canvas: HTMLCanvasElement,
  render: (t: number) => void
) {
  let encoder: VideoEncoder | null = null
  let options: SegmentOptions | null = null
  let failure: Error | null = null
  let chunks: Uint8Array[] = []

  /** the encoded bytes produced since the last call */
  const take = () => {
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
    let at = 0
    for (const c of chunks) {
      out.set(c, at)
      at += c.length
    }
    chunks = []
    return out
  }

  return {
    /** false when the browser has no H.264 encoder for this size */
    async start(o: SegmentOptions) {
      const config: VideoEncoderConfig = {
        codec: avcCodec(o.width, o.height, o.fps),
        width: o.width,
        height: o.height,
        bitrate: o.bitrate,
        framerate: o.fps,
        hardwareAcceleration: 'prefer-hardware',
        avc: { format: 'annexb' }
      }
      if (!(await VideoEncoder.isConfigSupported(config)).supported)
        return false
      options = o
      chunks = []
      encoder = new VideoEncoder({
        output: (chunk) => {
          const bytes = new Uint8Array(chunk.byteLength)
          chunk.copyTo(bytes)
          chunks.push(bytes)
        },
        error: (e) => {
          failure = e
        }
      })
      encoder.configure(config)
      return true
    },

    /** render and encode the frames at `times`, numbered from `first` within the segment */
    async frames(times: number[], first: number) {
      const enc = encoder!
      const { fps, keyInterval } = options!
      for (const [k, t] of times.entries()) {
        render(t)
        const i = first + k
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round((i * 1e6) / fps)
        })
        enc.encode(frame, { keyFrame: i % keyInterval === 0 })
        frame.close()
        // keep the GPU and the encoder both busy without queueing frames without bound
        while (enc.encodeQueueSize > 4)
          await new Promise((r) => setTimeout(r, 1))
        if (failure) throw failure
      }
      return take()
    },

    async finish() {
      await encoder!.flush()
      encoder!.close()
      encoder = null
      if (failure) throw failure
      return take()
    }
  }
}
