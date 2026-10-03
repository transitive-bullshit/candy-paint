// Deterministic offline renderer: drives the page's window.renderFrame(t) in headless Chrome (GPU via
// Metal) and writes stills or pipes frames into ffmpeg with the matching slice of the song.
//
//   pnpm render --look lacquer --stills 33.0,12.4 --out renders/concepts
//   pnpm render --look lacquer --from 27.4 --to 40 --fps 60 --out renders/tests/drop.mp4

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
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
    /** supersampling factor: render at w*ss x h*ss, downscale with lanczos */
    ss: { type: 'string', default: '1' },
    out: { type: 'string', default: 'renders' },
    name: { type: 'string' },
    audio: { type: 'string', default: 'media/candy-paint-instrumental.wav' },
    /** extra page parameters for experiments, e.g. "chords=bud" */
    query: { type: 'string', default: '' },
    /** frame transfer format for clips: png (lossless) or jpeg (q 0.97, much faster at 4K) */
    transfer: { type: 'string', default: 'png' }
  }
})

const W = Number(args.w)
const H = Number(args.h)
const SS = Number(args.ss)
const RW = W * SS
const RH = H * SS

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
    const page = await browser.newPage({
      viewport: { width: RW, height: RH },
      deviceScaleFactor: 1
    })
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning')
        console.log(`[page ${msg.type()}]`, msg.text())
    })
    const url = `http://127.0.0.1:${port}/?mode=render&look=${args.look}&shot=${args.shot}&w=${RW}&h=${RH}${args.query ? `&${args.query}` : ''}`
    await page.goto(url)
    await page.waitForFunction(
      () => window.lookReady || window.lookError,
      null,
      { timeout: 120_000 }
    )
    const err = await page.evaluate(() => window.lookError)
    if (err) throw new Error(err)

    const grab = async (t: number, mime = 'image/png') => {
      await page.evaluate(async (time) => window.renderFrame!(time), t)
      const dataUrl = await page.evaluate(
        (type) => document.querySelector('canvas')!.toDataURL(type, 0.97),
        mime
      )
      return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
    }

    if (args.stills) {
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
        '-ss',
        String(from),
        '-t',
        String(to - from),
        '-i',
        args.audio,
        // standard delivery color, limited-range BT.709 and tagged: JPEG frames would otherwise carry
        // full-range BT.601 through, which players that ignore the flags show with crushed shadows
        '-vf',
        `scale=${SS === 1 ? '' : `${W}:${H}:flags=lanczos:`}out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709`,
        '-color_range',
        'tv',
        '-colorspace',
        'bt709',
        '-color_primaries',
        'bt709',
        '-color_trc',
        'bt709',
        '-c:v',
        'libx264',
        '-preset',
        'slow',
        '-crf',
        '14',
        '-c:a',
        'aac',
        '-b:a',
        '256k',
        '-shortest',
        '-movflags',
        '+faststart',
        out
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] }
    )
    const started = Date.now()
    await grab(from)
    for (let i = 0; i < frames; i++) {
      const png = await grab(
        from + i / fps,
        args.transfer === 'jpeg' ? 'image/jpeg' : 'image/png'
      )
      if (!enc.stdin.write(png))
        await new Promise((r) => enc.stdin.once('drain', r))
      if (i % fps === 0) {
        // progress on its own line (so logs can be polled): percent, speed and time remaining
        const rate = (i + 1) / ((Date.now() - started) / 1000)
        const eta = (frames - i - 1) / rate
        const pct = ((100 * (i + 1)) / frames).toFixed(1)
        console.log(
          `progress ${pct}% frame ${i + 1}/${frames} ${rate.toFixed(1)} fps eta ${Math.floor(eta / 60)}m${String(Math.round(eta % 60)).padStart(2, '0')}s`
        )
      }
    }
    enc.stdin.end()
    await new Promise<void>((resolve, reject) =>
      enc.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))
      )
    )
    console.log(
      `\nwrote ${out} in ${((Date.now() - started) / 1000).toFixed(1)}s`
    )
  } finally {
    await browser.close()
    await server.close()
  }
}

function ffmpeg(argv: string[], input: Buffer) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn('ffmpeg', ['-loglevel', 'error', ...argv], {
      stdio: ['pipe', 'inherit', 'inherit']
    })
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))
    )
    p.stdin.end(input)
  })
}

await main()
