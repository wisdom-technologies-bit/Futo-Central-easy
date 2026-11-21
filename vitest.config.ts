import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Minimal test setup: the importer is plain TypeScript plus `fetch`, so no
 * browser environment is needed. `server-only` is stubbed because it throws
 * outside a React Server Components bundle.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      'server-only': fileURLToPath(new URL('./test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
})
