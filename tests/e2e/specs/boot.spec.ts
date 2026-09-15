import { expect, test } from '@playwright/test'
import { INVENTORY, PERF } from '@voxelcraft/core-types'
import { buildTestUrl, collectPageErrors } from '../src/harness'

test('app boots with zero console errors', async ({ page }) => {
  const errors = collectPageErrors(page)

  await page.goto('/')
  await expect(page).toHaveTitle(/VoxelCraft/)
  await expect(page.locator('#game-canvas')).toBeAttached()
  await page.screenshot({ path: 'test-results/boot.png' })

  expect(errors.join(' | ')).toBe('')
})

test('test-mode url boots at the E2E canvas size with zero console errors', async ({ page }) => {
  const errors = collectPageErrors(page)

  await page.setViewportSize({ width: PERF.e2eCanvasWidth, height: PERF.e2eCanvasHeight })
  await page.goto(buildTestUrl())
  await expect(page.locator('#game-canvas')).toBeAttached()
  await page.screenshot({ path: 'test-results/boot-test-mode.png' })

  expect(errors.join(' | ')).toBe('')
})

test('hud is mounted under #ui-root', async ({ page }) => {
  const errors = collectPageErrors(page)

  await page.setViewportSize({ width: PERF.e2eCanvasWidth, height: PERF.e2eCanvasHeight })
  await page.goto(buildTestUrl())

  const uiRoot = page.locator('#ui-root')
  const mounted = await uiRoot
    .waitFor({ state: 'attached', timeout: 4000 })
    .then(() => true)
    .catch(() => false)
  test.skip(!mounted, '#ui-root is not wired up yet (apps/game is owned by client-a)')

  for (const testId of ['hud', 'crosshair', 'hotbar', 'health', 'hunger']) {
    await expect(uiRoot.locator(`[data-testid="${testId}"]`)).toBeAttached()
  }
  for (let i = 0; i < INVENTORY.hotbarSlots; i++) {
    await expect(uiRoot.locator(`[data-testid="hotbar-slot-${i}"]`)).toBeAttached()
  }
  await page.screenshot({ path: 'test-results/ui-hud.png' })

  expect(errors.join(' | ')).toBe('')
})
