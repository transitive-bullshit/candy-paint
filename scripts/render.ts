// Deterministic offline renderer: drives the page in headless Chrome (GPU via Metal) and writes
// stills, or clips with the matching slice of the song.
//
// Clips encode in the page by default: each frame goes from the canvas to the Mac's hardware H.264
// encoder (WebCodecs), with no raw pixels leaving the GPU. Frames are pure functions of time, so
// several pages each encode a contiguous segment, and ffmpeg joins them and adds the audio.
// --encoder x264 instead pipes JPEG or PNG frames to x264 (slow, CRF 14): about 4x slower.
//
//   pnpm render --look lacquer --stills 33.0,12.4 --out renders/concepts
//   pnpm render --look lacquer --from 27.4 --to 40 --fps 60 --out renders/tests/drop.mp4

import { spawn } from 'node:child_process'
import { mkdir, open as openFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const { values: args } = parseArgs({
  options: {
    look: { type: 'string', default: 'lacquer' },
    shot: { type: 'string', default: 'hero' },
    stills: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    fps: { type: 'string', default: '60' },
    w: { type: 'string', default: '1920' },
    h: { type: 'string', default: '1080' },
    /** supersampling factor: render at w*ss x h*ss, downscale with lanczos (x264 path) */
    ss: { type: 'string', default: '1' },
    out: { type: 'string', default: 'renders' },
    name: { type: 'string' },
    audio: { type: 'string', default: 'media/candy-paint-instrumental.wav' },
    /** extra page parameters for experiments, e.g. "chords=bud" */
    query: { type: 'string', default: '' },
    /** hw: hardware H.264 in the page (WebCodecs); x264: frames piped to ffmpeg's x264 */
    encoder: { type: 'string', default: 'hw' },
    /** x264 path only: frame transfer as jpeg (q 0.97) or png (lossless, slow) */
    transfer: { type: 'string', default: 'jpeg' },
    /** pages rendering at once, each its own segment of frames. The hardware path is bound by
     *  the GPU and the encoder, so it gains nothing past 1; x264 overlaps capture with 2 */
    workers: { type: 'string' }
  }
})

const W = Number(args.w)
const H = Number(args.h)
const SS = Number(args.ss)
const RW = W * SS
const RH = H * SS
/** hardware bitrate: 0.16 bits per pixel matched x264 CRF 14 on this video's grain (80 Mbps at 4K60) */
const BITS_PER_PIXEL = 0.16
/** the standard delivery tags: limited-range BT.709 */
const BT709 =
  'setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709'

async function main() {
  // any free port, so several renders can run side by side; no file watching, so editing
  // sources mid-render can't hot-reload the page out from under the capture
  const server = await createServer({
    configFile: 'vite.config.ts',
    logLevel: 'error',
    server: { port: 0, strictPort: false, hmr: false, watch: null }
  })
  await server.listen()
  const address = server.httpServer?.address()
  const port =
    typeof address === 'object' && address
      ? address.port
      : server.config.server.port
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--use-angle=metal',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--disable-background-timer-throttling'
    ]
  })
  try {
    const url = `http://127.0.0.1:${port}/engine.html?mode=render&look=${args.look}&shot=${args.shot}&w=${RW}&h=${RH}${args.query ? `&${args.query}` : ''}`
    /** a page with the look loaded */
    const open = async () => {
      const page = await browser.newPage({
        viewport: { width: RW, height: RH },
        deviceScaleFactor: 1
      })
      page.on('console', (msg) => {
        if (msg.type() === 'error' || msg.type() === 'warning')
          console.log(`[page ${msg.type()}]`, msg.text())
      })
      await page.goto(url)
      await page.waitForFunction(
        () => window.lookReady || window.lookError,
        null,
        { timeout: 120_000 }
      )
      const err = await page.evaluate(() => window.lookError)
      if (err) throw new Error(err)
      /** an encoded image of the frame at t */
      const image = async (t: number, mime = 'image/png') => {
        await page.evaluate(async (time) => window.renderFrame!(time), t)
        const dataUrl = await page.evaluate(
          (type) => document.querySelector('canvas')!.toDataURL(type, 0.97),
          mime
        )
        return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
      }
      return { page, image }
    }

    if (args.stills) {
      const grab = (await open()).image
      await mkdir(args.out, { recursive: true })
      const times = args.stills.split(',').map(Number)
      // warm-up frame: shader compilation, mip generation
      await grab(times[0]!)
      for (const t of times) {
        const png = await grab(t)
        const base = `${args.name ?? args.look}-${args.shot}-${t.toFixed(2)}`
        const file = path.join(args.out, `${base}.png`)
        if (SS === 1) await writeFile(file, png)
        else
          await ffmpeg(
            [
              '-y',
              '-f',
              'png_pipe',
              '-i',
              '-',
              '-vf',
              `scale=${W}:${H}:flags=lanczos`,
              file
            ],
            png
          )
        console.log('wrote', file)
      }
      return
    }

    const from = Number(args.from ?? 0)
    const to = Number(args.to ?? from + 5)
    const fps = Number(args.fps)
    const frames = Math.round((to - from) * fps)
    const out = args.out.endsWith('.mp4')
      ? args.out
      : path.join(args.out, `${args.name ?? args.look}-${from}-${to}.mp4`)
    await mkdir(path.dirname(out), { recursive: true })
    const pages = await Promise.all(
      Array.from(
        {
          length: Math.max(
            1,
            Number(args.workers ?? (args.encoder === 'hw' ? 1 : 2))
          )
        },
        open
      )
    )
    const started = Date.now()
    let shown = -1
    /** progress on its own line (so logs can be polled): percent, speed and time remaining */
    const progress = (done: number) => {
      const second = Math.floor(done / fps)
      if (second === shown) return
      shown = second
      const rate = done / ((Date.now() - started) / 1000)
      const eta = (frames - done) / rate
      console.log(
        `progress ${((100 * done) / frames).toFixed(1)}% frame ${done}/${frames} ${rate.toFixed(1)} fps eta ${Math.floor(eta / 60)}m${String(Math.round(eta % 60)).padStart(2, '0')}s`
      )
    }
    const audio = [
      '-ss',
      String(from),
      '-t',
      String(to - from),
      '-i',
      args.audio
    ]
    const delivery = ['-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart']

    if (args.encoder === 'hw' && SS === 1) {
      // each page encodes one contiguous segment, keyframe first, into its own Annex B file
      const bounds = pages.map((_, k) =>
        Math.round((k * frames) / pages.length)
      )
      bounds.push(frames)
      const parts = pages.map((_, k) => `${out}.part${k}.h264`)
      let encoded = 0
      await Promise.all(
        pages.map(async ({ page }, k) => {
          const ok = await page.evaluate(
            async (o) => window.segmentEncoder!.start(o),
            {
              width: W,
              height: H,
              fps,
              bitrate: Math.round(W * H * fps * BITS_PER_PIXEL),
              keyInterval: 2 * fps
            }
          )
          if (!ok)
            throw new Error(
              `no hardware H.264 encoder for ${W}x${H}; use --encoder x264`
            )
          const file = await openFile(parts[k]!, 'w')
          try {
            for (let i = bounds[k]!; i < bounds[k + 1]!; i += fps) {
              const n = Math.min(fps, bounds[k + 1]! - i)
              const times = Array.from(
                { length: n },
                (_, j) => from + (i + j) / fps
              )
              const bytes = await page.evaluate(
                async ([ts, first]) => window.segmentEncoder!.frames(ts, first),
                [times, i - bounds[k]!] as const
              )
              await file.write(bytes)
              encoded += n
              progress(encoded)
            }
            await file.write(
              await page.evaluate(async () => window.segmentEncoder!.finish())
            )
          } finally {
            await file.close()
          }
        })
      )
      // join the segments and add the audio without re-encoding (raw H.264 has no timestamps, so
      // they're generated at the frame rate); the browser tags the transfer as sRGB, so retag it
      // BT.709 in the stream and the container like everything else we deliver
      await ffmpeg([
        '-y',
        '-fflags',
        '+genpts',
        '-f',
        'h264',
        '-r',
        String(fps),
        '-i',
        `concat:${parts.join('|')}`,
        ...audio,
        '-map',
        '0:v',
        '-map',
        '1:a',
        '-c:v',
        'copy',
        '-bsf:v',
        'h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',
        '-color_range',
        'tv',
        '-colorspace',
        'bt709',
        '-color_primaries',
        'bt709',
        '-color_trc',
        'bt709',
        ...delivery,
        out
      ])
      await Promise.all(parts.map((part) => rm(part)))
    } else {
      const mime = args.transfer === 'png' ? 'image/png' : 'image/jpeg'
      const enc = spawn(
        'ffmpeg',
        [
          '-y',
          '-loglevel',
          'error',
          '-f',
          'image2pipe',
          '-framerate',
          String(fps),
          '-i',
          '-',
          ...audio,
          // image frames arrive full-range RGB; convert to the delivery standard and tag it
          '-vf',
          `scale=${SS === 1 ? '' : `${W}:${H}:flags=lanczos:`}out_color_matrix=bt709:out_range=tv,format=yuv420p,${BT709}`,
          '-c:v',
          'libx264',
          '-preset',
          'slow',
          '-crf',
          '14',
          '-shortest',
          ...delivery,
          out
        ],
        { stdio: ['pipe', 'inherit', 'inherit'] }
      )
      // warm-up frame per page: shader compilation, mip generation
      await Promise.all(pages.map(({ image }) => image(from, mime)))
      // pages finish out of order; frames go to ffmpeg in order, waiting on it when it falls behind
      const done = new Map<number, Buffer>()
      let next = 0
      let written = 0
      let flushing = Promise.resolve()
      const flush = async () => {
        while (done.has(written)) {
          const frame = done.get(written)!
          done.delete(written)
          if (!enc.stdin.write(frame))
            await new Promise((r) => enc.stdin.once('drain', r))
          written++
          progress(written)
        }
      }
      await Promise.all(
        pages.map(async ({ image }) => {
          while (next < frames) {
            const i = next++
            done.set(i, await image(from + i / fps, mime))
            flushing = flushing.then(flush)
            await flushing
          }
        })
      )
      enc.stdin.end()
      await new Promise<void>((resolve, reject) =>
        enc.on('close', (code) =>
          code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))
        )
      )
    }
    console.log(
      `\nwrote ${out} in ${((Date.now() - started) / 1000).toFixed(1)}s`
    )
  } finally {
    await browser.close()
    await server.close()
  }
}

function ffmpeg(argv: string[], input?: Buffer) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn('ffmpeg', ['-loglevel', 'error', ...argv], {
      stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit']
    })
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))
    )
    p.stdin?.end(input)
  })
}

await main()
