import { expect, test, type Page } from '@playwright/test'
import { PERF } from '@voxelcraft/core-types'
import {
	buildTestUrl,
	collectConsoleIssues,
	readMesherStats,
	waitForReady,
	waitForTestApi,
	type WindowWithVc,
} from '../src/harness'

/** Meshing is asynchronous, so the counters are polled instead of sampled once. */
const MESH_TIMEOUT = 30000

/** Boots test mode and waits until the pool has actually produced a mesh. */
async function bootMeshedApp(page: Page, workers: boolean): Promise<void> {
	await page.setViewportSize({ width: PERF.e2eCanvasWidth, height: PERF.e2eCanvasHeight })
	await page.goto(buildTestUrl({ workers }))
	await waitForTestApi(page)
	await waitForReady(page)
	// Spawning a worker is not enough: a section has to come back meshed.
	await page.waitForFunction(
		() => (window as unknown as WindowWithVc).__vc.mesher().meshed > 0,
		undefined,
		{ timeout: MESH_TIMEOUT },
	)
}

test.describe('worker meshing', () => {
	test.slow()

	test('meshes chunks in web workers instead of on the main thread', async ({ page }) => {
		const issues = collectConsoleIssues(page)

		await bootMeshedApp(page, true)

		const stats = await readMesherStats(page)
		expect(stats.workers, 'the mesher pool must keep at least one live worker').toBeGreaterThan(0)
		expect(stats.meshed, 'the pool must have meshed at least one section').toBeGreaterThan(0)
		expect(
			stats.inline,
			'no section may be meshed on the main thread while workers are enabled',
		).toBe(0)
		expect(stats.worker, 'every accepted mesh must come from a worker').toBe(stats.meshed)
		expect(stats.errors, 'the mesher pool must not report worker errors').toBe(0)

		// The worker output is what the renderer actually draws.
		const state = await page.evaluate(() => (window as unknown as WindowWithVc).__vc.state())
		expect(state.quads, 'worker meshes must reach the renderer').toBeGreaterThan(0)

		expect(issues.join(' | '), 'the worker run must not log console errors or warnings').toBe('')
	})

	test('re-meshes an edited section in a worker', async ({ page }) => {
		const issues = collectConsoleIssues(page)

		await bootMeshedApp(page, true)
		const before = await readMesherStats(page)

		const cleared = await page.evaluate(() => {
			const vc = (window as unknown as WindowWithVc).__vc
			const state = vc.state()
			const x = Math.floor(state.x)
			const z = Math.floor(state.z)
			const from = Math.min(250, Math.max(1, Math.floor(state.y)))
			for (let y = from; y > 0; y--) {
				if (vc.getBlock(x, y, z) === 0) continue
				vc.breakBlock(x, y, z)
				return vc.getBlock(x, y, z) === 0
			}
			return false
		})
		expect(cleared, 'breaking a solid block below the spawn point must clear it').toBe(true)

		await page.waitForFunction(
			(baseline: number) => (window as unknown as WindowWithVc).__vc.mesher().meshed > baseline,
			before.meshed,
			{ timeout: MESH_TIMEOUT },
		)

		const after = await readMesherStats(page)
		expect(after.worker, 'the edit must be re-meshed in a worker').toBeGreaterThan(before.worker)
		expect(after.inline, 'an edit must never be meshed on the main thread').toBe(0)
		expect(after.errors, 'the mesher pool must not report worker errors').toBe(0)

		expect(issues.join(' | '), 'the edit must not log console errors or warnings').toBe('')
	})

	test('telemetry reports the inline fallback when workers are disabled', async ({ page }) => {
		const issues = collectConsoleIssues(page)

		// Proof that the assertions above have teeth: with workers=0 the very same
		// counters have to report main-thread meshing.
		await bootMeshedApp(page, false)

		const stats = await readMesherStats(page)
		expect(stats.workers, 'workers=0 must not spawn a worker').toBe(0)
		expect(stats.inline, 'workers=0 must mesh on the main thread').toBeGreaterThan(0)
		expect(stats.worker, 'workers=0 must not report any worker mesh').toBe(0)

		expect(issues.join(' | '), 'the inline fallback must not log console errors or warnings').toBe(
			'',
		)
	})
})
