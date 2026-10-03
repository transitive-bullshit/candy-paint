import { readFileSync } from 'node:fs'

import { defineConfig, type Plugin } from 'vite'

// `pnpm build` makes the site: the interactive player (index.html) with the song and its score
// beside it. Neither is in git, so they're copied in from the local pipeline outputs.
const SITE_ASSETS = ['data/score.json', 'media/candy-paint-instrumental.mp3']

function siteAssets(): Plugin {
  return {
    name: 'candy-paint:site-assets',
    apply: 'build',
    generateBundle() {
      for (const fileName of SITE_ASSETS)
        this.emitFile({
          type: 'asset',
          fileName,
          source: readFileSync(fileName)
        })
    }
  }
}

export default defineConfig({
  // relative URLs, so the site works from any folder of a web server
  base: './',
  server: { host: '127.0.0.1', port: 5199, strictPort: true },
  preview: { host: '127.0.0.1', port: 5199 },
  // three.js is most of the bundle; it gzips to about 270 kB
  build: { chunkSizeWarningLimit: 1000 },
  plugins: [siteAssets()]
})
