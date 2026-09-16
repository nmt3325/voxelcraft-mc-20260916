/**
 * Saturated fluid ticking stays inside the tick budget (review R-03).
 *
 * The review measured about 121 ms for a saturated tick against a 50 ms budget.
 * Wall clock assertions are flaky on shared runners, so this file pins the work
 * instead of the time: the cell cap is hard, the downhill search runs once per
 * tile rather than once per cell, and the outcome does not depend on either.
 */
import { describe, expect, it } from 'vitest'
import { BLOCK, PERF } from '@voxelcraft/core-types'
import { createFlatTestWorld } from '../testing/flatWorld'
import type { FluidTickStats } from './fluidEngine'
import { fluidCreateEngine } from './fluidEngine'

const FLOOR_TOP = 64
/** Half extent of the floor: 49 by 49 voxels of flat, hole free ground. */
const EXTENT = 24
/** Source spacing. Every source spreads `FLUID_MAX_LEVEL` voxels, so the pools merge. */
const SOURCE_STEP = 6
const MAX_TICKS = 600
const SLOW = 30000

interface RunResult {
	stats: FluidTickStats[]
	hash: number
	ticks: number
}

/** Floods a whole region from a grid of sources and records the work per tick. */
const saturatedRun = (budgetCells: number): RunResult => {
	const { world } = createFlatTestWorld({ floorTop: FLOOR_TOP, extent: EXTENT })
	const engine = fluidCreateEngine({ world })
	for (let x = -EXTENT + 3; x <= EXTENT - 3; x += SOURCE_STEP) {
		for (let z = -EXTENT + 3; z <= EXTENT - 3; z += SOURCE_STEP) {
			world.setBlock(x, FLOOR_TOP, z, BLOCK.WATER)
			engine.onNeighborChanged(x, FLOOR_TOP, z)
		}
	}
	const stats: FluidTickStats[] = []
	let tick = 0
	while (engine.pending > 0 && tick < MAX_TICKS) {
		engine.tick(tick, budgetCells)
		stats.push(engine.lastTickStats)
		tick++
	}
	return { stats, hash: world.hash(), ticks: tick }
}

const sum = (stats: FluidTickStats[], of: (s: FluidTickStats) => number): number =>
	stats.reduce((total, s) => total + of(s), 0)

const max = (stats: FluidTickStats[], of: (s: FluidTickStats) => number): number =>
	stats.reduce((best, s) => Math.max(best, of(s)), 0)

describe('fluid tick budget', () => {
	it(
		'never examines more than the per tick cell cap',
		() => {
			const run = saturatedRun(PERF.fluidCellsPerTick)
			expect(run.ticks).toBeLessThan(MAX_TICKS)
			// The fixture has to be genuinely saturated or the cap proves nothing.
			expect(sum(run.stats, (s) => s.examined)).toBeGreaterThan(10000)
			expect(max(run.stats, (s) => s.examined)).toBeGreaterThan(1000)
			for (const s of run.stats) {
				expect(s.examined).toBeLessThanOrEqual(PERF.fluidCellsPerTick)
			}
		},
		SLOW,
	)

	it(
		'solves the downhill search per tile instead of per cell',
		() => {
			const run = saturatedRun(PERF.fluidCellsPerTick)
			const examined = sum(run.stats, (s) => s.examined)
			const fields = sum(run.stats, (s) => s.holeFields)
			// One tile answers 256 voxels, so the searches have to be far rarer than
			// the voxels that need one. This is the bound the 121 ms tick lacked.
			expect(fields * 16).toBeLessThan(examined)
			expect(max(run.stats, (s) => s.holeFields)).toBeLessThanOrEqual(256)
		},
		SLOW,
	)

	it(
		'settles to the same world from the same input, whatever the budget',
		() => {
			const first = saturatedRun(PERF.fluidCellsPerTick)
			const second = saturatedRun(PERF.fluidCellsPerTick)
			expect(second.stats).toEqual(first.stats)
			expect(second.hash).toBe(first.hash)

			const throttled = saturatedRun(512)
			expect(throttled.stats.some((s) => s.examined === 512)).toBe(true)
			for (const s of throttled.stats) expect(s.examined).toBeLessThanOrEqual(512)
			// A smaller budget only costs more ticks; the settled world is identical.
			expect(throttled.ticks).toBeGreaterThanOrEqual(first.ticks)
			expect(throttled.hash).toBe(first.hash)
		},
		SLOW,
	)
})
