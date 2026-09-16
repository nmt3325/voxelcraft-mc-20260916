import { defineConfig } from 'vitest/config'

// Server tests include a headless integration test that boots a real listener
// on port 0, so the timeouts are looser than the unit-test defaults.
export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
})
