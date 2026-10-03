# Project: candy-paint

A programmatic music video for a piano cover of "Candy Paint", rendered note by note from a transcription of the song. A working directory: Python analysis plus a TypeScript/WebGL renderer. See `contributing.md` for setup and commands.

## Conventions

- use `pnpm`
- use modern TypeScript (ESM only, no CommonJS)
- no semicolons; oxfmt formats (`pnpm fix:format`) and oxlint lints (`pnpm fix:lint`)
- `pnpm test` runs format, lint, types, and unit tests; keep it green
- use `uv` for the Python analysis (`analysis/`)

## Mental model

audio (R2, synced to `media/` by `pnpm media`, not in git) → transcription + analysis (`analysis/`) → `data/score.json` → engine (`src/`): voices split into lines (`lines.ts`), one performer per line that buds off its voice's main performer (`cast.ts`, `motion.ts`), camera from the storyboard (`director.ts`; in 9:16 it also follows the cast, `keepInFrame`), all pure functions of song time → `scripts/render.ts` drives headless Chrome (`engine.html`) and pipes frames to ffmpeg with the matching audio slice. The site (`index.html`, `src/player/`) plays the same engine live against the MP3; its `Tweaks` default to the rendered video.

Direction A (`src/looks/lacquer.ts`) is the chosen look; `exposure` and `sleeve` are shelved concept directions.

## Rules

- The audio is the master: never edit or re-time it. Sync comes from the 90.000 bpm grid in the score (bar 0 at 0.702 s).
- Keep motion deterministic: no `Math.random()` or wall-clock time at render; seed anything random.
- The motion test is the sync contract: performers touch down on every onset. Keep it passing when changing choreography.
- The framing test is the 9:16 contract: visible performers stay in frame. Keep it passing when changing the camera.
- Never commit the audio, stems, raw transcriptions (`analysis/out/`) or renders with audio; they derive from copyrighted material. `data/score.json` is the exception: it's committed so the site builds from git.
