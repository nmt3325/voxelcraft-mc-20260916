import {
	BLOCK,
	RENDER_LAYER,
	VERTEX_STRIDE_U16,
	paddedIndex,
	sectionKey,
} from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { appearanceOf } from '../mesher/appearance'
import { meshSection, meshSectionWithDebug } from '../mesher/greedy'
import {
	countVisibleFaces,
	createEmptyPadded,
	createMeshRequest,
	fillPaddedLight,
	paddedOffset,
	setPaddedBlock,
} from '../mesher/padded'
import { TEXTURE_NAMES, textureLayer } from '../mesher/textures'

type Fill = (blocks: Uint16Array) => void

function buildRequest(fill: Fill, revision = 1) {
	const padded = createEmptyPadded()
	fillPaddedLight(padded.light, 15, 0)
	fill(padded.blocks)
	return createMeshRequest({
		key: sectionKey(0, 0, 0),
		cx: 0,
		cz: 0,
		sy: 0,
		revision,
		padded,
	})
}

/** Local deterministic PRNG: fixtures must not depend on Math.random. */
function lcg(seed: number): () => number {
	let state = seed >>> 0
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0
		return state / 0x100000000
	}
}

const FULL_CUBE_PALETTE = [
	0,
	0,
	BLOCK.STONE,
	BLOCK.DIRT,
	BLOCK.GRASS_BLOCK,
	BLOCK.SAND,
	BLOCK.GLASS,
	BLOCK.WATER,
	BLOCK.OAK_LEAVES,
	BLOCK.OAK_LOG,
]

function fillRandomCubes(blocks: Uint16Array, seed: number): void {
	const random = lcg(seed)
	for (let y = -1; y <= 16; y++) {
		for (let z = -1; z <= 16; z++) {
			for (let x = -1; x <= 16; x++) {
				const pick = Math.floor(random() * FULL_CUBE_PALETTE.length)
				blocks[paddedOffset(x, y, z)] = FULL_CUBE_PALETTE[pick]
			}
		}
	}
}

function lane(interleaved: ArrayBuffer, vertex: number, laneIndex: number): number {
	return new Uint16Array(interleaved)[vertex * VERTEX_STRIDE_U16 + laneIndex]
}

function aoHistogram(interleaved: ArrayBuffer, vertexCount: number): number[] {
	const histogram = [0, 0, 0, 0]
	for (let vertex = 0; vertex < vertexCount; vertex++) {
		histogram[lane(interleaved, vertex, 5) & 3]++
	}
	return histogram
}

describe('padded section helpers', () => {
	it('matches the contract padded index layout', () => {
		for (const [x, y, z] of [
			[0, 0, 0],
			[15, 15, 15],
			[-1, -1, -1],
			[16, 16, 16],
			[3, 11, 7],
		]) {
			expect(paddedOffset(x, y, z)).toBe(paddedIndex(x, y, z))
		}
	})
})

describe('greedy mesher', () => {
	it('meshes a single voxel as 6 quads and 24 vertices', () => {
		const request = buildRequest((blocks) => setPaddedBlock(blocks, 8, 8, 8, BLOCK.STONE))
		const { result, debug } = meshSectionWithDebug(request)

		expect(result.buffers).toHaveLength(1)
		const buffer = result.buffers[0]
		expect(buffer.layer).toBe(RENDER_LAYER.Opaque)
		expect(result.stats.quads).toBe(6)
		expect(buffer.vertexCount).toBe(24)
		expect(buffer.indexCount).toBe(36)
		expect(buffer.interleaved.byteLength).toBe(24 * VERTEX_STRIDE_U16 * 2)
		expect(debug.faceArea).toBe(6)
		expect(debug.crossQuads).toBe(0)
		expect(debug.droppedQuads).toBe(0)
		expect(countVisibleFaces(request.blocks)).toBe(6)
	})

	it('writes the frozen vertex lane layout', () => {
		const request = buildRequest((blocks) => setPaddedBlock(blocks, 4, 5, 6, BLOCK.STONE))
		const buffer = meshSection(request).buffers[0]
		const stoneLayer = textureLayer('stone')
		const normals = new Set<number>()
		for (let vertex = 0; vertex < buffer.vertexCount; vertex++) {
			expect(lane(buffer.interleaved, vertex, 3)).toBe(0)
			expect(lane(buffer.interleaved, vertex, 4)).toBe(stoneLayer)
			const normalAo = lane(buffer.interleaved, vertex, 5)
			const normalId = normalAo >> 4
			const uvCorner = (normalAo >> 2) & 3
			expect(normalId).toBeGreaterThanOrEqual(0)
			expect(normalId).toBeLessThanOrEqual(5)
			expect(uvCorner).toBeLessThanOrEqual(3)
			expect(normalAo & 3).toBe(3)
			normals.add(normalId)
			// Sky light 15, block light 0 everywhere in this fixture.
			expect(lane(buffer.interleaved, vertex, 6)).toBe(0xf0)
			expect(lane(buffer.interleaved, vertex, 7)).toBe(0)
			const x = lane(buffer.interleaved, vertex, 0)
			const y = lane(buffer.interleaved, vertex, 1)
			const z = lane(buffer.interleaved, vertex, 2)
			expect([64, 80]).toContain(x)
			expect([80, 96]).toContain(y)
			expect([96, 112]).toContain(z)
		}
		expect([...normals].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5])
		expect(appearanceOf(BLOCK.STONE)?.faces[0]).toBe(stoneLayer)
		expect(TEXTURE_NAMES[0]).toBe('missing')
	})

	it('emits nothing for a fully enclosed section', () => {
		const request = buildRequest((blocks) => blocks.fill(BLOCK.STONE))
		const result = meshSection(request)
		expect(result.buffers).toHaveLength(0)
		expect(result.stats.quads).toBe(0)
		expect(countVisibleFaces(request.blocks)).toBe(0)
	})

	it('merges a flat slab into one quad per face direction', () => {
		const request = buildRequest((blocks) => {
			for (let z = 0; z < 16; z++) {
				for (let x = 0; x < 16; x++) setPaddedBlock(blocks, x, 0, z, BLOCK.STONE)
			}
		})
		const { result, debug } = meshSectionWithDebug(request)
		expect(result.stats.quads).toBe(6)
		expect(debug.faceArea).toBe(256 * 2 + 16 * 4)
		expect(debug.faceArea).toBe(countVisibleFaces(request.blocks))
	})

	it('is deterministic down to the vertex bytes', () => {
		const first = meshSection(buildRequest((blocks) => fillRandomCubes(blocks, 20260916)))
		const second = meshSection(buildRequest((blocks) => fillRandomCubes(blocks, 20260916)))

		expect(second.buffers).toHaveLength(first.buffers.length)
		expect(first.buffers.length).toBeGreaterThan(0)
		for (let i = 0; i < first.buffers.length; i++) {
			expect(second.buffers[i].layer).toBe(first.buffers[i].layer)
			expect([...new Uint8Array(second.buffers[i].interleaved)]).toEqual([
				...new Uint8Array(first.buffers[i].interleaved),
			])
			expect([...new Uint8Array(second.buffers[i].index)]).toEqual([
				...new Uint8Array(first.buffers[i].index),
			])
		}
		expect(first.stats.quads).toBe(second.stats.quads)
	})

	it('keeps merged area equal to the visible face count', () => {
		for (const seed of [1, 7, 4242, 999983]) {
			const request = buildRequest((blocks) => fillRandomCubes(blocks, seed))
			const { debug } = meshSectionWithDebug(request)
			expect(debug.faceArea).toBe(countVisibleFaces(request.blocks))
			expect(debug.droppedQuads).toBe(0)
			expect(debug.greedyQuads).toBeLessThanOrEqual(debug.faceArea)
		}
	})

	it('separates opaque, cutout and translucent layers', () => {
		const request = buildRequest((blocks) => {
			setPaddedBlock(blocks, 2, 2, 2, BLOCK.STONE)
			setPaddedBlock(blocks, 6, 6, 6, BLOCK.GLASS)
			setPaddedBlock(blocks, 10, 10, 10, BLOCK.WATER)
			setPaddedBlock(blocks, 13, 13, 13, BLOCK.TALL_GRASS)
		})
		const result = meshSection(request)
		expect(result.buffers.map((buffer) => buffer.layer)).toEqual([
			RENDER_LAYER.Opaque,
			RENDER_LAYER.Cutout,
			RENDER_LAYER.Translucent,
		])
		// Stone 6 quads, glass 6 quads, water 6 quads, tall grass 4 cross quads.
		expect(result.stats.quads).toBe(22)
		const cutout = result.buffers[1]
		expect(cutout.vertexCount).toBe(6 * 4 + 4 * 4)
	})

	it('hides faces shared by blocks in the same cull group', () => {
		const request = buildRequest((blocks) => {
			setPaddedBlock(blocks, 4, 4, 4, BLOCK.WATER)
			setPaddedBlock(blocks, 5, 4, 4, BLOCK.WATER)
		})
		const { debug } = meshSectionWithDebug(request)
		// 12 cube faces minus the two touching faces.
		expect(debug.faceArea).toBe(10)
		expect(debug.faceArea).toBe(countVisibleFaces(request.blocks))
	})

	it('meshes plants as four cross quads outside the greedy pass', () => {
		const request = buildRequest((blocks) => setPaddedBlock(blocks, 8, 0, 8, BLOCK.TALL_GRASS))
		const { result, debug } = meshSectionWithDebug(request)
		expect(debug.faceArea).toBe(0)
		expect(debug.crossQuads).toBe(4)
		expect(countVisibleFaces(request.blocks)).toBe(0)
		expect(result.buffers).toHaveLength(1)
		expect(result.buffers[0].layer).toBe(RENDER_LAYER.Cutout)
		expect(result.buffers[0].vertexCount).toBe(16)
	})
})

describe('ambient occlusion', () => {
	it('stays inside 0..3 and darkens occluded corners', () => {
		const request = buildRequest((blocks) => {
			setPaddedBlock(blocks, 8, 8, 8, BLOCK.STONE)
			setPaddedBlock(blocks, 9, 9, 8, BLOCK.STONE)
			setPaddedBlock(blocks, 9, 9, 9, BLOCK.STONE)
		})
		const buffer = meshSection(request).buffers[0]
		const histogram = aoHistogram(buffer.interleaved, buffer.vertexCount)
		expect(histogram.reduce((sum, count) => sum + count, 0)).toBe(buffer.vertexCount)
		expect(histogram[3]).toBeLessThan(buffer.vertexCount)
		for (let vertex = 0; vertex < buffer.vertexCount; vertex++) {
			const ao = lane(buffer.interleaved, vertex, 5) & 3
			expect(ao).toBeGreaterThanOrEqual(0)
			expect(ao).toBeLessThanOrEqual(3)
		}
	})

	it('rotates with the voxel configuration', () => {
		const place: ReadonlyArray<readonly [number, number, number]> = [
			[8, 8, 8],
			[9, 8, 8],
			[9, 9, 8],
			[8, 9, 9],
		]
		const straight = buildRequest((blocks) => {
			for (const [x, y, z] of place) setPaddedBlock(blocks, x, y, z, BLOCK.STONE)
		})
		// (x, z) -> (z, 15 - x) is a bijection on the padded range [-1, 16].
		const rotated = buildRequest((blocks) => {
			for (const [x, y, z] of place) setPaddedBlock(blocks, z, y, 15 - x, BLOCK.STONE)
		})

		const a = meshSection(straight).buffers[0]
		const b = meshSection(rotated).buffers[0]
		expect(b.vertexCount).toBe(a.vertexCount)
		expect(aoHistogram(b.interleaved, b.vertexCount)).toEqual(
			aoHistogram(a.interleaved, a.vertexCount),
		)
	})
})
