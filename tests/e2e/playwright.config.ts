import { defineConfig } from '@playwright/test'

export default defineConfig({
	testDir: './specs',
	timeout: 120000,
	expect: { timeout: 15000 },
	retries: 0,
	workers: 1,
	reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
	outputDir: 'test-results',
	use: {
		baseURL: 'http://127.0.0.1:4173',
		headless: true,
		viewport: { width: 1280, height: 720 },
		screenshot: 'only-on-failure',
		launchOptions: {
			args: [
				'--no-sandbox',
				'--disable-dev-shm-usage',
				// Real software GL, so WebGL2 works headless and the suite can assert on it
				// instead of skipping when a GPU is missing.
				'--use-gl=angle',
				'--use-angle=swiftshader',
				'--enable-unsafe-swiftshader',
				'--ignore-gpu-blocklist',
				// Audio starts without a click in test mode. Without these flags chromium
				// logs an AudioContext console warning, which the suite treats as a failure.
				'--autoplay-policy=no-user-gesture-required',
				'--mute-audio',
			],
		},
	},
	webServer: {
		command: 'pnpm --filter @voxelcraft/game run preview',
		url: 'http://127.0.0.1:4173',
		cwd: '../..',
		reuseExistingServer: true,
		timeout: 180000,
	},
})
