import { defineConfig } from 'vitest/config'

// Engine tests are pure TS — no DOM, no Vite plugins, no CSP. Keeping this
// config separate from vite.config.ts avoids loading the React plugin and
// the build-only CSP/clean-url plugins into the test runner.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
