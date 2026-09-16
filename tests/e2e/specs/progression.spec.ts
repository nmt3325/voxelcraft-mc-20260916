import { expect, test } from '@playwright/test'
import { XP } from '@voxelcraft/core-types'
import {
	bootTestApp,
	collectConsoleIssues,
	readParticleStats,
	readXp,
	type WindowWithVc,
} from '../src/harness'

/**
 * Experience, end to end. The orb pool and the level curve have unit tests of
 * their own; what only a real boot can prove is that `apps/game` owns them:
 * that breaking an ore drops orbs, that collecting them raises the level, and
 * that the HUD paints what the player earned.
 */

test.describe('experience', () => {
	test.slow()

	test('breaking ore grants xp, spawns particles and updates the hud', async ({ page }) => {
		const issues = collectConsoleIssues(page)

		await bootTestApp(page, { workers: true })

		const idle = await readXp(page)
		expect(idle.total, 'a fresh world starts without experience').toBe(0)
		expect(idle.level, 'a fresh world starts at level zero').toBe(0)

		// Three ores: one drop is not enough to reach the first level.
		const gained = await page.evaluate(() => {
			const vc = (window as unknown as WindowWithVc).__vc
			let total = 0
			for (let i = 0; i < 3; i++) total += vc.xpFromOre()
			return total
		})
		expect(gained, 'an ore break must release experience').toBeGreaterThanOrEqual(XP.oreDrop)

		const earned = await readXp(page)
		expect(earned.total, 'collected orbs must land in the xp state').toBe(gained)
		expect(earned.level, 'three ore drops must be worth at least one level').toBeGreaterThanOrEqual(
			1,
		)

		const particles = await readParticleStats(page)
		expect(particles.alive, 'breaking a block must spawn particles').toBeGreaterThan(0)

		// The HUD repaints on its own interval, so these assertions are polled.
		await expect(page.locator('[data-testid="xp"]')).toHaveAttribute(
			'data-total',
			String(earned.total),
		)
		await expect(page.locator('[data-testid="xp-level"]')).toHaveText(
			`Lvl ${earned.level} - ${earned.total} xp`,
		)

		expect(issues.join(' | '), 'the xp path must not log console errors or warnings').toBe('')
	})
})
