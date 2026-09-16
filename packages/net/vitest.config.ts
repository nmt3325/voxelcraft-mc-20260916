import { defineConfig } from 'vitest/config'

// Protocol unit tests. Pure byte work, so the node environment is enough.
export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
	},
})
