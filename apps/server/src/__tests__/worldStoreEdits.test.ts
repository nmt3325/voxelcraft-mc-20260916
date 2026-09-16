/**
 * rev6 B-1 regression. The store used to insert a column, trim the cache and
 * only then pin the edit, so a brand new edited column was the only unpinned
 * entry at trim time and was deleted while setBlock still returned true. On the
 * shipped configuration, 400 edits in 400 distinct columns were all accepted
 * and 62 of them - every one from the 339th onwards - were unreadable
 * immediately afterwards, with a BlockChange broadcast for each.
 *
 * These tests fail on that ordering and pass on pin-before-admit.
 */
import { DIMENSION } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import type { ServerWorld } from '../types'
import { WORLD_CACHE, createServerWorld } from '../world/worldStore'

const SEED = 20260916
/** Above every generated surface, so a pristine column holds air here. */
const EDIT_Y = 100
const DISTINCT_COLUMNS = 400

interface Spot {
	readonly index: number
	readonly x: number
	readonly marker: number
}

/**
 * A marker read from deep inside the same column of a pristine same-seed world:
 * a genuinely generated id that is never what the column holds at EDIT_Y, so a
 * read back can never be satisfied by regenerated terrain.
 */
function markerAt(reference: ServerWorld, x: number): number {
	const marker = reference.block(x, 1, 0)
	expect(marker).not.toBe(reference.block(x, EDIT_Y, 0))
	return marker
}

describe('world store edit durability', () => {
	it('keeps every accepted edit readable across 400 distinct columns', () => {
		const reference = createServerWorld(SEED)
		const refusals: string[] = []
		const world = createServerWorld(SEED, DIMENSION.Overworld, {
			onRefusedWrite: (message) => refusals.push(message),
		})
		const cap = WORLD_CACHE.maxColumns
		const accepted: Spot[] = []
		let refused = 0
		let peakResident = 0
		for (let index = 0; index < DISTINCT_COLUMNS; index++) {
			const x = index * 16
			const marker = markerAt(reference, x)
			if (world.setBlock(x, EDIT_Y, 0, marker)) accepted.push({ index, x, marker })
			else refused++
			peakResident = Math.max(peakResident, world.loadedChunks)
		}

		// The blocker itself: an accepted edit is never thrown away.
		const unreadable = accepted.filter((spot) => world.block(spot.x, EDIT_Y, 0) !== spot.marker)
		expect(unreadable).toEqual([])
		// What could not be retained was refused instead of quietly dropped, and
		// every refusal was reported.
		expect(accepted).toHaveLength(cap)
		expect(refused).toBe(DISTINCT_COLUMNS - cap)
		expect(refusals.length).toBeGreaterThan(0)
		// The cap holds throughout, during the edits and after reading them back.
		expect(peakResident).toBeLessThanOrEqual(cap)
		expect(world.loadedChunks).toBeLessThanOrEqual(cap)
	})

	it('refuses a write it cannot retain instead of accepting one it will drop', () => {
		const reference = createServerWorld(SEED)
		const refusals: string[] = []
		const world = createServerWorld(SEED, DIMENSION.Overworld, {
			maxColumns: 2,
			onRefusedWrite: (message) => refusals.push(message),
		})
		const first = markerAt(reference, 0)
		const second = markerAt(reference, 16)
		const third = markerAt(reference, 32)
		expect(world.setBlock(0, EDIT_Y, 0, first)).toBe(true)
		expect(world.setBlock(16, EDIT_Y, 0, second)).toBe(true)

		// Both resident columns hold an edit now, so there is nothing the store may
		// evict for a third one. It used to accept this write, delete the column it
		// had just written into, and return true anyway.
		expect(world.setBlock(32, EDIT_Y, 0, third)).toBe(false)
		expect(refusals).toHaveLength(1)
		expect(world.block(32, EDIT_Y, 0)).toBe(reference.block(32, EDIT_Y, 0))
		expect(world.block(0, EDIT_Y, 0)).toBe(first)
		expect(world.block(16, EDIT_Y, 0)).toBe(second)
		expect(world.loadedChunks).toBeLessThanOrEqual(2)
	})
})
