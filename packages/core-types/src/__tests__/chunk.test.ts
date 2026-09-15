import { describe, expect, it } from 'vitest'
import {
	CHUNK_AREA,
	CHUNK_VOLUME,
	CHUNK_X,
	CHUNK_Y,
	CHUNK_Z,
	SECTIONS_PER_CHUNK,
	blockIndex,
	chunkKey,
	createChunkData,
	indexX,
	indexY,
	indexZ,
	sectionOfIndex,
	worldToChunk,
	worldToLocal,
} from '../chunk'

describe('chunk indexing', () => {
	it('has the frozen v1 dimensions', () => {
		expect([CHUNK_X, CHUNK_Y, CHUNK_Z]).toEqual([16, 256, 16])
		expect(CHUNK_VOLUME).toBe(65536)
		expect(CHUNK_AREA).toBe(256)
		expect(SECTIONS_PER_CHUNK).toBe(16)
	})

	it('round trips every voxel coordinate', () => {
		for (let y = 0; y < CHUNK_Y; y += 7) {
			for (let z = 0; z < CHUNK_Z; z++) {
				for (let x = 0; x < CHUNK_X; x++) {
					const i = blockIndex(x, y, z)
					expect(i).toBeGreaterThanOrEqual(0)
					expect(i).toBeLessThan(CHUNK_VOLUME)
					expect(indexX(i)).toBe(x)
					expect(indexY(i)).toBe(y)
					expect(indexZ(i)).toBe(z)
					expect(sectionOfIndex(i)).toBe(y >> 4)
				}
			}
		}
	})

	it('is a bijection over the whole chunk', () => {
		const seen = new Uint8Array(CHUNK_VOLUME)
		for (let y = 0; y < CHUNK_Y; y++)
			for (let z = 0; z < CHUNK_Z; z++)
				for (let x = 0; x < CHUNK_X; x++) seen[blockIndex(x, y, z)]++
		expect(seen.every((v) => v === 1)).toBe(true)
	})

	it('keeps x as the fastest axis', () => {
		expect(blockIndex(1, 0, 0) - blockIndex(0, 0, 0)).toBe(1)
		expect(blockIndex(0, 0, 1) - blockIndex(0, 0, 0)).toBe(16)
		expect(blockIndex(0, 1, 0) - blockIndex(0, 0, 0)).toBe(256)
	})

	it('maps negative world coordinates correctly', () => {
		expect(worldToChunk(-1)).toBe(-1)
		expect(worldToLocal(-1)).toBe(15)
		expect(worldToChunk(-16)).toBe(-1)
		expect(worldToLocal(-16)).toBe(0)
		expect(chunkKey(-3, 4)).toBe('-3,4')
	})

	it('allocates the documented buffer sizes', () => {
		const chunk = createChunkData(2, -5)
		expect(chunk.blocks.length).toBe(CHUNK_VOLUME)
		expect(chunk.fluids.length).toBe(CHUNK_VOLUME)
		expect(chunk.light.length).toBe(CHUNK_VOLUME)
		expect(chunk.heightmap.length).toBe(CHUNK_AREA)
		expect(chunk.revision).toBe(0)
		expect(chunk.blockEntities.size).toBe(0)
		expect(chunk.cx).toBe(2)
		expect(chunk.cz).toBe(-5)
	})
})
