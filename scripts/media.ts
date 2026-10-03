// The song isn't in git. The master MP3 lives in R2 (AUDIO_URL); the pipeline works from a local
// copy in media/, plus a 44.1 kHz WAV decoded from it for the analysis and renders.
//
//   pnpm media                         download the MP3 and decode the WAV, if they're missing
//   pnpm media --upload --env <file>   put the local MP3 in R2 with the S3_* credentials in <file>

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { AwsClient } from 'aws4fetch'

import { AUDIO_URL } from '../src/media'

export const MP3 = 'media/candy-paint-instrumental.mp3'
export const WAV = 'media/candy-paint-instrumental.wav'

/** the local MP3 and WAV: downloaded from R2 and decoded when they're missing */
export async function ensureMedia() {
  await mkdir(path.dirname(MP3), { recursive: true })
  // each file is written aside and renamed, so an interrupted run never leaves a partial one
  if (!existsSync(MP3)) {
    console.log(`downloading ${AUDIO_URL}`)
    const res = await fetch(AUDIO_URL)
    if (!res.ok)
      throw new Error(`${AUDIO_URL}: ${res.status} ${res.statusText}`)
    await writeFile(`${MP3}.part`, new Uint8Array(await res.arrayBuffer()))
    await rename(`${MP3}.part`, MP3)
  }
  if (!existsSync(WAV)) {
    console.log(`decoding ${WAV}`)
    await ffmpeg([
      '-i',
      MP3,
      '-ar',
      '44100',
      '-ac',
      '2',
      '-f',
      'wav',
      `${WAV}.part`
    ])
    await rename(`${WAV}.part`, WAV)
  }
}

/** put the local MP3 in the S3_BUCKET_NAME bucket at AUDIO_URL's path, then check the public copy */
async function upload() {
  const env = (name: string) => {
    const value = process.env[name]?.trim()
    if (!value) throw new Error(`${name} is not set`)
    return value
  }
  const client = new AwsClient({
    accessKeyId: env('S3_ACCESS_KEY_ID'),
    secretAccessKey: env('S3_SECRET_ACCESS_KEY'),
    service: 's3',
    region: process.env.S3_REGION?.trim() || 'auto'
  })
  const key = new URL(AUDIO_URL).pathname.slice(1)
  const endpoint = env('S3_API_ENDPOINT').replace(/\/+$/, '')
  const body = await readFile(MP3)
  const res = await client.fetch(
    `${endpoint}/${env('S3_BUCKET_NAME')}/${key}`,
    {
      method: 'PUT',
      body,
      headers: {
        'content-type': 'audio/mpeg',
        // the audio is the master: it never changes
        'cache-control': 'public, max-age=31536000, immutable'
      }
    }
  )
  if (!res.ok)
    throw new Error(`upload failed: ${res.status} ${await res.text()}`)

  const check = await fetch(AUDIO_URL, { method: 'HEAD' })
  const size = Number(check.headers.get('content-length'))
  if (!check.ok || size !== body.length)
    throw new Error(
      `${AUDIO_URL}: ${check.status}, ${size} bytes where ${body.length} were uploaded`
    )
  console.log(`uploaded ${MP3} to ${AUDIO_URL}`)
}

function ffmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-y', ...args], {
      stdio: 'inherit'
    })
    p.on('error', reject)
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))
    )
  })
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: { upload: { type: 'boolean' }, env: { type: 'string' } }
  })
  if (values.env) process.loadEnvFile(values.env)
  await (values.upload ? upload() : ensureMedia())
}
