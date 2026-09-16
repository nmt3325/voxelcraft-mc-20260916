import { expect, test, type Page } from '@playwright/test'
import { CROP_STAGES } from '@voxelcraft/core-types'
import {
	advanceTicks,
	bootTestApp,
	collectConsoleIssues,
	readFarm,
	type WindowWithVc,
} from '../src/harness'

/**
 * Farming, end to end. Growth is a pure function of (seed, tick, position), so
 * a fixed seed plus a tick budget is a deterministic amount of game time: the
 * crop either reaches its last stage or the wiring is broken.
 */

interface Plot {
	x: number
	y: number
	z: number
	found: boolean
}

/** Tills soil near the spawn point and plants a seed on top of it. */
function plantNearSpawn(page: Page): Promise<Plot> {
	return page.evaluate(() => {
		const vc = (window as unknown as WindowWithVc).__vc
		const state = vc.state()
		const top = Math.min(250, Math.floor(state.y) + 2)
		for (let dx = -3; dx <= 3; dx++) {
			for (let dz = -3; dz <= 3; dz++) {
				const x = Math.floor(state.x) + dx
				const z = Math.floor(state.z) + dz
				// Only the first couple of solid blocks of the column are candidates:
				// below the surface everything is stone, which no hoe can till.
				let tried = 0
				for (let y = top; y > 1 && tried < 2; y--) {
					if (vc.getBlock(x, y, z) === 0) continue
					tried++
					if (vc.till(x, y, z) && vc.plant(x, y + 1, z)) return { x, y, z, found: true }
				}
			}
		}
		return { x: 0, y: 0, z: 0, found: false }
	})
}

test.describe('farming', () => {
	test.slow()

	test('a tilled plot grows a crop on the fixed schedule and yields a harvest', async ({
		page,
	}) => {
		const issues = collectConsoleIssues(page)

		await bootTestApp(page, { workers: true })

		const plot = await plantNearSpawn(page)
		expect(plot.found, 'the spawn neighbourhood must offer tillable soil').toBe(true)

		const planted = await readFarm(page)
		expect(planted.crops, 'the planted seed must be tracked').toBe(1)
		expect(planted.mature, 'a fresh seed is not mature').toBe(0)

		const tick = await advanceTicks(page, 2000)
		expect(tick, 'the fixed schedule must advance').toBeGreaterThanOrEqual(CROP_STAGES)

		const grown = await readFarm(page)
		expect(grown.crops, 'growth must not lose the crop').toBe(1)
		expect(grown.mature, 'the crop must reach its last stage').toBe(1)

		const dropped = await page.evaluate(
			(cell: { x: number; y: number; z: number }) =>
				(window as unknown as WindowWithVc).__vc.harvest(cell.x, cell.y + 1, cell.z),
			{ x: plot.x, y: plot.y, z: plot.z },
		)
		expect(dropped, 'a mature crop must drop its product and a seed').toBeGreaterThanOrEqual(2)

		const cleared = await readFarm(page)
		expect(cleared.crops, 'the harvest must clear the plot').toBe(0)

		expect(issues.join(' | '), 'farming must not log console errors or warnings').toBe('')
	})
})
