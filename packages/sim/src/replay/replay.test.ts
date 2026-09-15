import { describe, expect, it } from 'vitest'
import { createTestArena } from '../testing'
import { hashSimState, replayIntentAt, runReplay } from './index'

describe('deterministic replay', () => {
	it('produces the same state hash for the same seed and tick count', () => {
		const first = runReplay({ seed: 1234, ticks: 120, entities: 6 })
		const second = runReplay({ seed: 1234, ticks: 120, entities: 6 })
		expect(first.ticks).toBe(120)
		expect(second.hash).toBe(first.hash)
		expect(second.samples).toEqual(first.samples)
	})

	it('diverges for a different seed', () => {
		const a = runReplay({ seed: 1, ticks: 120, entities: 6 })
		const b = runReplay({ seed: 2, ticks: 120, entities: 6 })
		expect(b.hash).not.toBe(a.hash)
	})

	it('keeps advancing the state as ticks are simulated', () => {
		const short = runReplay({ seed: 77, ticks: 20, entities: 4 })
		const long = runReplay({ seed: 77, ticks: 200, entities: 4 })
		expect(long.hash).not.toBe(short.hash)
		for (const sample of long.samples) {
			expect(Number.isFinite(sample.x)).toBe(true)
			expect(Number.isFinite(sample.y)).toBe(true)
			expect(Number.isFinite(sample.z)).toBe(true)
		}
	})

	it('derives the input stream purely from the seed', () => {
		expect(replayIntentAt(42, 3, 9)).toEqual(replayIntentAt(42, 3, 9))
		expect(replayIntentAt(42, 3, 9)).not.toEqual(replayIntentAt(43, 3, 9))
	})

	it('hashes the voxel world as well as the entities', () => {
		const run = runReplay({ seed: 5, ticks: 5, entities: 2 })
		const before = hashSimState(run.world, run.arena.world, run.ticks)
		expect(before).toBe(run.hash)
		run.arena.world.setBlock(0, run.arena.floorTop + 30, 0, 1)
		expect(hashSimState(run.world, run.arena.world, run.ticks)).not.toBe(before)
	})

	it('runs on a reusable arena', () => {
		const arena = createTestArena()
		const a = runReplay({ seed: 9, ticks: 30, entities: 3, arena })
		const arenaB = createTestArena()
		const b = runReplay({ seed: 9, ticks: 30, entities: 3, arena: arenaB })
		expect(b.hash).toBe(a.hash)
	})
})
