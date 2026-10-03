import shared from '@fisch0920/config/oxfmt'
import { defineConfig } from 'oxfmt'

export default defineConfig({
  ...shared,
  // the analysis pipeline writes the score as compact JSON; commit it byte for byte
  ignorePatterns: [...(shared.ignorePatterns ?? []), 'data/score.json']
})
