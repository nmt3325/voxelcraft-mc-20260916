import { expect, test } from '@playwright/test'
import { INVENTORY, PERF } from '@voxelcraft/core-types'
import { buildTestUrl, collectConsoleIssues, MISSING_WEBGL, readWebGlInfo } from '../src/harness'

test('app boots with zero console errors or warnings', async ({ page }) => {
	const issues = collectConsoleIssues(page)

	await page.goto('/')
	await expect(page).toHaveTitle(/VoxelCraft/)
	await expect(page.locator('#game-canvas')).toBeAttached()
	await page.screenshot({ path: 'test-results/boot.png' })

	expect(issues.join(' | '), 'the boot must not log console errors or warnings').toBe('')
})

test('chromium provides a real WebGL2 context', async ({ page }) => {
	const issues = collectConsoleIssues(page)

	await page.goto(buildTestUrl())
	// GL has to work for real. Without this the rendering assertions could only be
	// kept green by relaxing them, which would hide a broken renderer.
	const webgl = await readWebGlInfo(page)
	expect(webgl.supported, `${MISSING_WEBGL} (${webgl.detail})`).toBe(true)
	expect(webgl.version, `expected a WebGL 2 context, got "${webgl.version}"`).toContain('WebGL 2')

	expect(issues.join(' | '), 'the WebGL probe must not log console errors or warnings').toBe('')
})

test('test-mode url boots at the E2E canvas size with zero console errors', async ({ page }) => {
	const issues = collectConsoleIssues(page)

	await page.setViewportSize({ width: PERF.e2eCanvasWidth, height: PERF.e2eCanvasHeight })
	await page.goto(buildTestUrl())
	await expect(page.locator('#game-canvas')).toBeAttached()
	await page.screenshot({ path: 'test-results/boot-test-mode.png' })

	expect(issues.join(' | '), 'test mode must not log console errors or warnings').toBe('')
})

test('hud is mounted under #ui-root', async ({ page }) => {
	const issues = collectConsoleIssues(page)

	await page.setViewportSize({ width: PERF.e2eCanvasWidth, height: PERF.e2eCanvasHeight })
	await page.goto(buildTestUrl())

	// A missing HUD is a failure, never a skip: apps/game mounts it on boot.
	const uiRoot = page.locator('#ui-root')
	await expect(uiRoot, '#ui-root must exist so the HUD has a mount point').toBeAttached()

	for (const testId of ['hud', 'crosshair', 'hotbar', 'health', 'hunger']) {
		await expect(
			uiRoot.locator(`[data-testid="${testId}"]`),
			`the HUD must render [data-testid="${testId}"] under #ui-root`,
		).toBeAttached()
	}
	for (let i = 0; i < INVENTORY.hotbarSlots; i++) {
		await expect(
			uiRoot.locator(`[data-testid="hotbar-slot-${i}"]`),
			`the hotbar must render slot ${i}`,
		).toBeAttached()
	}
	await page.screenshot({ path: 'test-results/ui-hud.png' })

	expect(issues.join(' | '), 'the HUD must not log console errors or warnings').toBe('')
})
