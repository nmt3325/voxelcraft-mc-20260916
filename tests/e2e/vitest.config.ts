import { defineConfig } from 'vitest/config'

// Playwright specs live in ./specs and must not be collected by vitest.
export default defineConfig({
	test: { include: ['unit/**/*.test.ts'] },
})
