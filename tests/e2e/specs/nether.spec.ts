import { expect, test } from '@playwright/test'
import { DIMENSION, PORTAL } from '@voxelcraft/core-types'
import {
	advanceTicks,
	bootTestApp,
	collectConsoleIssues,
	readDimension,
	type WindowWithVc,
} from '../src/harness'

/**
 * The Nether, end to end. Portal search and linking have unit tests of their
 * own; only a real boot can prove that the app swaps the world it streams,
 * raycasts and simulates when the player travels, and that it comes back.
 */

test.describe('nether', () => {
	test.slow()

	test('a portal carries the player to the nether and back', async ({ page }) => {
		const issues = collectConsoleIssues(page)

		await bootTestApp(page, { workers: true })

		const start = await readDimension(page)
		expect(start.id, 'a new world starts in the Overworld').toBe(DIMENSION.Overworld)
		expect(start.label, 'the dimension must be named for the debug overlay').not.toBe('')

		await page.evaluate(() => (window as unknown as WindowWithVc).__vc.buildPortal())

		// Standing in the portal for `travelDelayTicks` is what triggers travel.
		await advanceTicks(page, PORTAL.travelDelayTicks + 40)
		const arrived = await readDimension(page)
		expect(arrived.id, 'the portal must carry the player to the Nether').toBe(DIMENSION.Nether)

		// Arrival builds the return frame, so the way home is the same portal once
		// the cooldown has passed.
		await advanceTicks(page, PORTAL.cooldownTicks + PORTAL.travelDelayTicks + 80)
		const home = await readDimension(page)
		expect(home.id, 'the return portal must bring the player home').toBe(DIMENSION.Overworld)

		expect(issues.join(' | '), 'portal travel must not log console errors or warnings').toBe('')
	})
})
