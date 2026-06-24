import { defineConfig } from 'vitest/config'

// Tests cover pure logic (schema, JSONL, merge, parsing, config). They must not
// require Chrome, Google Drive, or the Prompt API, so the CRXJS/extension build
// plugins are deliberately not loaded here.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'config/**/*.test.ts'],
  },
})
