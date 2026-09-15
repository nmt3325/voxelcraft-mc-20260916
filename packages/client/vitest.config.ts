import { defineConfig } from 'vitest/config'

// Unit tests for the client package. UI tests (owned by client-c) opt into jsdom
// with a `// @vitest-environment jsdom` docblock at the top of the file.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
