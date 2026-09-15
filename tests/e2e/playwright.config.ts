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
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
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
