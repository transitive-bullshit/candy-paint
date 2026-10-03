# Contributing

## Setup

- Node 24+, pnpm, `uv`, ffmpeg, and Google Chrome (headless renders drive the installed Chrome via Playwright).
- `pnpm install` and `uv sync`.
- Put the source audio at `media/candy-paint-instrumental.mp3` (not in git; it's the Molotov Cocktail Piano cover).

## Pipeline

```bash
# 1. decode, separate stems (optional, diagnostic) and transcribe the piano (Transkun, ~1 min on CPU)
ffmpeg -i media/candy-paint-instrumental.mp3 -ar 44100 -ac 2 media/candy-paint-instrumental.wav
uv tool run --python 3.11 --from transkun --with "torch<2.9" --with "torchaudio<2.9" --with "setuptools<81" \
  transkun media/candy-paint-instrumental.wav analysis/out/transkun.mid --device cpu

# 2. analyze: tempo grid, sections, voices -> data/score.json
uv run python analysis/analyze_mix.py
uv run python analysis/analyze_notes.py
uv run python analysis/build_score.py

# 3. preview with audio and scrubbing: ?look=lacquer&shot=director, &chords=bud|twins|single (space plays, arrows step)
pnpm dev

# 4. render stills or a clip with the matching audio slice
pnpm render --look lacquer --stills 14.2,32.76 --ss 2 --out renders/concepts
pnpm render --look lacquer --from 25.4 --to 38 --fps 60 --out renders/tests/lacquer-drop.mp4

# 5. review version of the full song (about 5 min): use this while iterating
pnpm render --look lacquer --shot director --w 960 --h 540 --from 0 --to 233.59 --fps 60 --transfer jpeg --out renders/previews/candy-paint-540p60.mp4
# a portrait size switches the camera to the vertical shot list (VERTICAL_SHOTS) for Instagram and TikTok
pnpm render --look lacquer --shot director --w 540 --h 960 --from 0 --to 233.59 --fps 60 --transfer jpeg --out renders/previews/candy-paint-vertical-540p60.mp4

# 6. the final video: a 4K60 master for YouTube (about 45 min on an M3 Pro), then a supersampled, lighter 1080p60 for X and the web
pnpm render --look lacquer --shot director --w 3840 --h 2160 --from 0 --to 233.59 --fps 60 --transfer jpeg --out renders/final/candy-paint-4k60.mp4
ffmpeg -i renders/final/candy-paint-4k60.mp4 -vf scale=1920:1080:flags=lanczos -c:v libx264 -preset slow -crf 19 -maxrate 12M -bufsize 24M -profile:v high -level 4.2 -pix_fmt yuv420p -c:a copy -movflags +faststart renders/final/candy-paint-1080p60-x.mp4
```

## Where things live

| Step | Code | Output |
| --- | --- | --- |
| Mix analysis (beats, key, novelty) | `analysis/analyze_mix.py` | `analysis/out/mix.json`, plots |
| Note grid, hands, harmony | `analysis/analyze_notes.py` | `analysis/out/score.json`, piano roll |
| Voices, sections, chords | `analysis/build_score.py` | `data/score.json` |
| Score model and time helpers | `src/score.ts` |  |
| Stage layout (time on X, staves up the page) | `src/layout.ts`, `src/stage.ts` |  |
| Voice lines (one per finger) | `src/lines.ts` |  |
| Cast: performers per line, budding | `src/cast.ts` |  |
| Performer choreography | `src/motion.ts`, `src/rig.ts` |  |
| Storyboard and camera direction | `src/director.ts` |  |
| Looks | `src/looks/{lacquer,exposure,sleeve}.ts` |  |
| Headless renderer | `scripts/render.ts` | `renders/` |

## Changing a shot

1. Find the beat in `STORY` and its framings in `SHOTS`, or `VERTICAL_SHOTS` for 9:16 (`src/director.ts`); framings are anchored to 0-indexed bars.
2. Preview it with `pnpm dev`, `?shot=director`, scrubbing to the bar.
3. Render a still to check: `pnpm render --shot director --stills <seconds>`.

## Tests

`pnpm test` runs format, lint, types and `test/motion.test.ts`, which checks that every performer lands on every onset and never jumps between frames. It uses a synthetic fixture in CI and the real score when `data/score.json` exists.

## Not in the repo

- `media/`: the copyrighted source audio.
- `data/`, `analysis/out/`: derived from the audio (transcription, stems); regenerate with the pipeline.
- `renders/`: regenerable output.
