import { expect, test, type Page } from '@playwright/test'
import { PARTICLE_BUDGET, PERF } from '@voxelcraft/core-types'
import {
	buildTestUrl,
	collectConsoleIssues,
	waitForReady,
	waitForTestApi,
	type WindowWithVc,
} from '../src/harness'

/**
 * Particles, end to end. The pool and the point batch have unit tests of their
 * own; what only a real boot can prove is that `apps/game` actually owns them:
 * that a block edit spawns into the pool, that the batch uploads the result as
 * one draw call, and that the frozen budgets are respected in the browser.
 */

/** Mirrors `VcParticleStats` in apps/game/src/main.ts. */
interface ParticleStats {
	alive: number
	visible: number
	drawCalls: number
	capacity: number
	spawnBudget: number
}

type VcWithParticles = WindowWithVc['__vc'] & { particles(): ParticleStats }

/** Budget for the batch to pick a fresh burst up on one of the next frames. */
const PARTICLE_TIMEOUT = 15000

/**
 * Draining is frame bound, not wall-clock bound. The frame loop clamps a frame
 * to `MAX_FRAME_SECONDS`, i.e. to a single 20 Hz tick, and swiftshader draws
 * this scene at roughly two frames per second, so the 40 tick block-break
 * lifetime costs about twenty seconds of wall clock in this harness (measured:
 * 16 frames in 8s, all 256 particles still alive). The budget keeps a wide
 * margin over that instead of asserting on the headless frame rate.
 */
const DRAIN_TIMEOUT = 90000

async function bootApp(page: Page): Promise<void> {
	await page.setViewportSize({ width: PERF.e2eCanvasWidth, height: PERF.e2eCanvasHeight })
	await page.goto(buildTestUrl({ workers: true }))
	await waitForTestApi(page)
	await waitForReady(page)
}

function readParticles(page: Page): Promise<ParticleStats> {
	return page.evaluate(() => (window as unknown as { __vc: VcWithParticles }).__vc.particles())
}

/** Breaks solid blocks around and below the spawn point. Returns the count. */
function breakBlocks(page: Page, wanted: number): Promise<number> {
	return page.evaluate((limit: number) => {
		const vc = (window as unknown as { __vc: VcWithParticles }).__vc
		const state = vc.state()
		const top = Math.min(250, Math.max(1, Math.floor(state.y)))
		let broken = 0
		for (let dx = -2; dx <= 2 && broken < limit; dx++) {
			for (let dz = -2; dz <= 2 && broken < limit; dz++) {
				const x = Math.floor(state.x) + dx
				const z = Math.floor(state.z) + dz
				for (let y = top; y > 0 && broken < limit; y--) {
					if (vc.getBlock(x, y, z) === 0) continue
					vc.breakBlock(x, y, z)
					if (vc.getBlock(x, y, z) === 0) broken++
				}
			}
		}
		return broken
	}, wanted)
}

test.describe('particles', () => {
	test.slow()

	test('spawns a batched burst when a block is broken', async ({ page }) => {
		const issues = collectConsoleIssues(page)

		await bootApp(page)

		const idle = await readParticles(page)
		expect(idle.capacity, 'the pool must expose the frozen capacity').toBe(PARTICLE_BUDGET.maxAlive)
		expect(idle.alive, 'nothing may be alive before the first edit').toBe(0)
		expect(idle.drawCalls, 'an empty pool must not cost a draw call').toBe(0)

		expect(await breakBlocks(page, 1), 'breaking one solid block must succeed').toBe(1)

		const after = await readParticles(page)
		expect(after.alive, 'breaking a block must spawn particles').toBeGreaterThan(0)
		expect(after.alive, 'a burst must stay inside the pool capacity').toBeLessThanOrEqual(
			after.capacity,
		)

		// The batch uploads on the next frame, so the draw call is polled.
		await page.waitForFunction(
			() => (window as unknown as { __vc: VcWithParticles }).__vc.particles().visible > 0,
			undefined,
			{ timeout: PARTICLE_TIMEOUT },
		)
		const drawn = await readParticles(page)
		expect(drawn.drawCalls, 'every live particle must share one draw call').toBe(1)

		expect(issues.join(' | '), 'particles must not log console errors or warnings').toBe('')
	})

	test('clamps a mass edit and drains back to empty', async ({ page }) => {
		const issues = collectConsoleIssues(page)

		await bootApp(page)

		const broken = await breakBlocks(page, 40)
		expect(broken, 'the mass edit needs a solid neighbourhood to dig into').toBeGreaterThan(18)

		const peak = await readParticles(page)
		expect(peak.alive, 'the mass edit must spawn particles').toBeGreaterThan(0)
		expect(peak.alive, 'the per-tick spawn budget must clamp the burst').toBeLessThanOrEqual(
			PARTICLE_BUDGET.maxSpawnPerTick,
		)
		expect(peak.alive, 'the pool must never exceed its capacity').toBeLessThanOrEqual(peak.capacity)

		// Every kind has a finite lifetime, so the pool empties without any help.
		// One frame is one tick here, so this waits on frames, not on wall clock.
		await page.waitForFunction(
			() => (window as unknown as { __vc: VcWithParticles }).__vc.particles().alive === 0,
			undefined,
			{ timeout: DRAIN_TIMEOUT },
		)
		const drained = await readParticles(page)
		expect(drained.drawCalls, 'a drained pool must stop drawing').toBe(0)
		expect(drained.visible, 'a drained pool must stop uploading points').toBe(0)

		expect(issues.join(' | '), 'the mass edit must not log console errors or warnings').toBe('')
	})
})
