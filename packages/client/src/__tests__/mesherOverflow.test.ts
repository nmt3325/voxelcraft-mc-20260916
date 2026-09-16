import { BLOCK, RENDER_LAYER, VERTEX_STRIDE_U16, sectionKey } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { MAX_VERTICES_PER_BATCH, meshSectionWithDebug } from '../mesher/greedy'
import {
	createEmptyPadded,
	createMeshRequest,
	fillPaddedLight,
	setPaddedBlock,
} from '../mesher/padded'

/**
 * Review blocker H-04.
 *
 * A 16^3 section can produce more vertices than a Uint16 index buffer can
 * address, and the mesher used to silently drop the overflowing quads. It must
 * instead split the layer into several draw batches whose indices are batch
 * local, so nothing is lost and no index wraps past 65535.
 *
 * Fixture: every interior voxel holds a cross block. The cross pass emits four
 * quads per voxel regardless of its neighbours, so the section produces
 * 4096 * 4 = 16384 quads = 65536 vertices, which is four vertices past the
 * per-batch limit and therefore needs exactly two batches.
 */

const SECTION_VOXELS = 16 * 16 * 16
const CROSS_QUADS_PER_VOXEL = 4
const EXPECTED_QUADS = SECTION_VOXELS * CROSS_QUADS_PER_VOXEL
const EXPECTED_VERTICES = EXPECTED_QUADS * 4
const EXPECTED_INDICES = EXPECTED_QUADS * 6

function buildRequest(fill: (blocks: Uint16Array) => void) {
	const padded = createEmptyPadded()
	fillPaddedLight(padded.light, 15, 0)
	fill(padded.blocks)
	return createMeshRequest({
		key: sectionKey(0, 0, 0),
		cx: 0,
		cz: 0,
		sy: 0,
		revision: 1,
		padded,
	})
}

function fillCrossBlocks(blocks: Uint16Array): void {
	for (let y = 0; y < 16; y++) {
		for (let z = 0; z < 16; z++) {
			for (let x = 0; x < 16; x++) setPaddedBlock(blocks, x, y, z, BLOCK.TALL_GRASS)
		}
	}
}

describe('mesher Uint16 index overflow (H-04)', () => {
	it('splits an overflowing layer into batches instead of dropping quads', () => {
		const { result, debug } = meshSectionWithDebug(buildRequest(fillCrossBlocks))

		expect(EXPECTED_VERTICES).toBeGreaterThan(MAX_VERTICES_PER_BATCH)
		expect(debug.crossQuads).toBe(EXPECTED_QUADS)
		expect(debug.droppedQuads).toBe(0)
		expect(result.stats.quads).toBe(EXPECTED_QUADS)

		expect(result.buffers).toHaveLength(2)
		expect(debug.batches).toBe(result.buffers.length)
		for (const buffer of result.buffers) expect(buffer.layer).toBe(RENDER_LAYER.Cutout)

		const vertices = result.buffers.reduce((sum, buffer) => sum + buffer.vertexCount, 0)
		const indices = result.buffers.reduce((sum, buffer) => sum + buffer.indexCount, 0)
		expect(vertices).toBe(EXPECTED_VERTICES)
		expect(indices).toBe(EXPECTED_INDICES)
	})

	it('keeps every batch addressable by a Uint16 index buffer', () => {
		const { result } = meshSectionWithDebug(buildRequest(fillCrossBlocks))

		for (const buffer of result.buffers) {
			expect(buffer.vertexCount).toBeGreaterThan(0)
			expect(buffer.vertexCount).toBeLessThanOrEqual(MAX_VERTICES_PER_BATCH)
			expect(buffer.vertexCount % 4).toBe(0)
			expect(buffer.indexCount).toBe((buffer.vertexCount / 4) * 6)
			expect(buffer.interleaved.byteLength).toBe(buffer.vertexCount * VERTEX_STRIDE_U16 * 2)
			expect(buffer.index.byteLength).toBe(buffer.indexCount * 2)

			const index = new Uint16Array(buffer.index)
			let lowest = 0x10000
			let highest = -1
			for (let i = 0; i < buffer.indexCount; i++) {
				const value = index[i]
				if (value < lowest) lowest = value
				if (value > highest) highest = value
			}
			// Batch local indices: no wrap-around past 65535, no dangling vertex.
			expect(lowest).toBe(0)
			expect(highest).toBe(buffer.vertexCount - 1)
			expect(highest).toBeLessThanOrEqual(0xffff)
		}
	})

	it('still emits a single batch per layer when the section fits', () => {
		const { result, debug } = meshSectionWithDebug(
			buildRequest((blocks) => {
				setPaddedBlock(blocks, 1, 1, 1, BLOCK.STONE)
				setPaddedBlock(blocks, 5, 5, 5, BLOCK.TALL_GRASS)
			}),
		)

		expect(result.buffers.map((buffer) => buffer.layer)).toEqual([
			RENDER_LAYER.Opaque,
			RENDER_LAYER.Cutout,
		])
		expect(debug.batches).toBe(2)
		expect(debug.droppedQuads).toBe(0)
		expect(result.stats.quads).toBe(6 + 4)
	})
})
