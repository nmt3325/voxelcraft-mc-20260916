/**
 * rev6 B-1, the converse symptom. Re-touching a key that is already marked as
 * edited used to re-create it as an unevictable entry, so the resident set
 * climbed past its cap: 400 resident columns against a cap of 338, and it
 * stayed there because the victim search could find nothing it was allowed to
 * delete. The cap now covers pinned columns too, which is why an edit that
 * cannot be retained is refused rather than admitted.
 */
import { DIMENSION } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import type { ServerWorld } from '../types'
import { createServerWorld } from '../world/worldStore'

const SEED = 20260916
const EDIT_Y = 100
const CAP = 8

function markerAt(reference: ServerWorld, x: number): number {
	const marker = reference.block(x, 1, 0)
	expect(marker).not.toBe(reference.block(x, EDIT_Y, 0))
	return marker
}

describe('world store residency cap', () => {
	it('stays inside the cap while edited columns are re-touched', () => {
		const reference = createServerWorld(SEED)
		const refusals: string[] = []
		const world = createServerWorld(SEED, DIMENSION.Overworld, {
			maxColumns: CAP,
			onRefusedWrite: (message) => refusals.push(message),
		})
		const edits = Array.from({ length: CAP }, (_unused, index) => ({
			x: index * 16,
			marker: markerAt(reference, index * 16),
		}))
		for (const edit of edits) {
			expect(world.setBlock(edit.x, EDIT_Y, 0, edit.marker)).toBe(true)
		}
		expect(world.loadedChunks).toBe(CAP)

		// The cap is full of game state, so one more distinct column cannot be
		// retained and must be refused.
		const overflowX = CAP * 16
		expect(world.setBlock(overflowX, EDIT_Y, 0, markerAt(reference, overflowX))).toBe(false)
		expect(refusals).toHaveLength(1)

		// Re-touching keys that already hold an edit is what a player walking back
		// over its own build does. It must not grow the resident set.
		for (const edit of edits) {
			expect(world.setBlock(edit.x, EDIT_Y, 0, edit.marker)).toBe(true)
		}
		expect(world.loadedChunks).toBeLessThanOrEqual(CAP)

		// Nor may a long streaming run of clean columns push it over.
		for (let index = 0; index < 50; index++) world.chunk(1_000 + index, 77)
		expect(world.loadedChunks).toBeLessThanOrEqual(CAP)

		// And every retained edit is still exactly where it was written.
		for (const edit of edits) {
			expect(world.block(edit.x, EDIT_Y, 0)).toBe(edit.marker)
		}
	})
})
