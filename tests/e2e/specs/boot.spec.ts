import { expect, test } from '@playwright/test'

test('app boots with zero console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(String(err)))

  await page.goto('/')
  await expect(page).toHaveTitle(/VoxelCraft/)
  await expect(page.locator('#game-canvas')).toBeAttached()
  await page.screenshot({ path: 'test-results/boot.png' })

  expect(errors.join(' | ')).toBe('')
})
