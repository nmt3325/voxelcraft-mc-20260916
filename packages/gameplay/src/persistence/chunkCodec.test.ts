import { describe, expect, it } from 'vitest'
import {
	BLOCK,
	BLOCK_ENTITY,
	CHUNK_CODEC_VERSION,
	CHUNK_MAGIC,
	CHUNK_VOLUME,
	FLUID,
	blockIndex,
	type ChunkSnapshot,
	type SerializedBlockEntity,
} from '@voxelcraft/core-types'
import {
	blockEntityFromJson,
	blockEntityToJson,
	createBlockEntityData,
} from '../blockEntities/data'
import {
	CHUNK_CODEC,
	CHUNK_HEADER_BYTES,
	SECTION_VOLUME,
	bitsForPaletteLength,
	canDecodeChunk,
	chunkLocalIndex,
	createChunkCodec,
	decodeChunk,
	decodeChunkAt,
	emptyChunkSnapshot,
	encodeChunk,
	entriesPerWord,
	sectionMaskOf,
} from './chunkCodec'

/** Cycles `ids` through one whole section, so the palette is exactly `ids`. */
function fillSection(blocks: Uint16Array, section: number, ids: readonly number[]): void {
	const base = section * SECTION_VOLUME
	for (let i = 0; i < SECTION_VOLUME; i++) blocks[base + i] = ids[i % ids.length]
}

function distinctIds(count: number): number[] {
	const ids: number[] = []
	for (let i = 0; i < count; i++) ids.push(i + 1)
	return ids
}

function roundTrip(snapshot: ChunkSnapshot): ChunkSnapshot {
	return decodeChunk(encodeChunk(snapshot))
}

describe('chunk payload header', () => {
	it('starts with the frozen magic and version', () => {
		const bytes = encodeChunk(emptyChunkSnapshot())
		expect([...bytes.slice(0, 4)]).toEqual([...CHUNK_MAGIC])
		expect(bytes[4] | (bytes[5] << 8)).toBe(CHUNK_CODEC_VERSION)
		expect(bytes[8] | (bytes[9] << 8)).toBe(0)
		// Empty chunk: header plus an empty block entity table, no sections.
		expect(bytes.length).toBe(CHUNK_HEADER_BYTES + 2)
	})

	it('round-trips an all-air chunk', () => {
		const decoded = roundTrip(emptyChunkSnapshot(3, -4))
		expect(decoded.blocks.length).toBe(CHUNK_VOLUME)
		expect(decoded.fluids.length).toBe(CHUNK_VOLUME)
		expect(decoded.blocks.some((value) => value !== 0)).toBe(false)
		expect(decoded.fluids.some((value) => value !== 0)).toBe(false)
		expect(decoded.blockEntities).toEqual([])
	})

	it('takes the chunk coordinates from the storage key, not the payload', () => {
		const bytes = encodeChunk(emptyChunkSnapshot(9, 9))
		expect(decodeChunkAt(bytes, -2, 5)).toMatchObject({ cx: -2, cz: 5 })
		expect(decodeChunk(bytes)).toMatchObject({ cx: 0, cz: 0 })
	})

	it('marks a section present for blocks or fluids', () => {
		const blocks = new Uint16Array(CHUNK_VOLUME)
		const fluids = new Uint8Array(CHUNK_VOLUME)
		expect(sectionMaskOf(blocks, fluids)).toBe(0)
		fluids[3 * SECTION_VOLUME] = 1
		expect(sectionMaskOf(blocks, fluids)).toBe(1 << 3)
		blocks[5 * SECTION_VOLUME] = BLOCK.STONE
		expect(sectionMaskOf(blocks, fluids)).toBe((1 << 3) | (1 << 5))
	})
})

describe('palette bit widths', () => {
	it('uses the smallest width of {0,1,2,4,8,16} that fits', () => {
		expect(bitsForPaletteLength(1)).toBe(0)
		expect(bitsForPaletteLength(2)).toBe(1)
		expect(bitsForPaletteLength(3)).toBe(2)
		expect(bitsForPaletteLength(4)).toBe(2)
		expect(bitsForPaletteLength(5)).toBe(4)
		expect(bitsForPaletteLength(16)).toBe(4)
		expect(bitsForPaletteLength(17)).toBe(8)
		expect(bitsForPaletteLength(256)).toBe(8)
		expect(bitsForPaletteLength(257)).toBe(16)
		expect(bitsForPaletteLength(65536)).toBe(16)
		expect(() => bitsForPaletteLength(0)).toThrow(RangeError)
	})

	it('packs whole 32-bit words with no entry straddling a word', () => {
		expect(entriesPerWord(0)).toBe(0)
		for (const bits of [1, 2, 4, 8, 16]) {
			expect(entriesPerWord(bits)).toBe(32 / bits)
			expect(SECTION_VOLUME % entriesPerWord(bits)).toBe(0)
		}
	})

	it('writes the computed width into the section header', () => {
		const snapshot = emptyChunkSnapshot()
		fillSection(snapshot.blocks, 0, distinctIds(3))
		const bytes = encodeChunk(snapshot)
		const paletteLen = bytes[CHUNK_HEADER_BYTES] | (bytes[CHUNK_HEADER_BYTES + 1] << 8)
		expect(paletteLen).toBe(3)
		expect(bytes[CHUNK_HEADER_BYTES + 2 + 2 * paletteLen]).toBe(2)
	})

	it('maps world coordinates to the chunk-local index', () => {
		expect(chunkLocalIndex(17, 5, -1)).toBe(blockIndex(1, 5, 15))
		expect(chunkLocalIndex(0, 0, 0)).toBe(0)
	})
})

describe('chunk round trip', () => {
	for (const size of [1, 2, 3, 16, 17, 256, 257]) {
		it(`round-trips a ${String(size)}-entry palette`, () => {
			const snapshot = emptyChunkSnapshot()
			fillSection(snapshot.blocks, 0, distinctIds(size))
			const decoded = roundTrip(snapshot)
			expect(decoded.blocks).toEqual(snapshot.blocks)
			expect(decoded.fluids).toEqual(snapshot.fluids)
		})
	}

	it('round-trips several populated sections', () => {
		const snapshot = emptyChunkSnapshot(-1, 2)
		fillSection(snapshot.blocks, 0, [BLOCK.STONE])
		fillSection(snapshot.blocks, 1, [BLOCK.DIRT, BLOCK.STONE, BLOCK.SAND])
		fillSection(snapshot.blocks, 15, distinctIds(17))
		const decoded = roundTrip(snapshot)
		expect(decoded.blocks).toEqual(snapshot.blocks)
	})

	it('round-trips a water chunk through the fluid RLE', () => {
		const snapshot = emptyChunkSnapshot()
		// Fluid byte layout: bits 0..2 level, bit 3 falling, bits 4..5 kind.
		const water = (FLUID.Water << 4) | 7
		for (let i = 0; i < SECTION_VOLUME; i++) {
			snapshot.blocks[i] = BLOCK.WATER
			snapshot.fluids[i] = water
		}
		// A short run in the next section exercises run boundaries too.
		for (let i = 0; i < 100; i++) snapshot.fluids[SECTION_VOLUME + i] = water
		const decoded = roundTrip(snapshot)
		expect(decoded.fluids).toEqual(snapshot.fluids)
		expect(decoded.blocks).toEqual(snapshot.blocks)
	})

	it('round-trips block entities in ascending index order', () => {
		const snapshot = emptyChunkSnapshot()
		const chestIndex = blockIndex(2, 70, 3)
		const bedIndex = blockIndex(1, 64, 0)
		snapshot.blocks[chestIndex] = BLOCK.CHEST
		snapshot.blocks[bedIndex] = BLOCK.BED_FOOT
		// Deliberately out of order: the codec has to sort by index.
		const entries: SerializedBlockEntity[] = [
			{ index: chestIndex, data: createBlockEntityData(BLOCK_ENTITY.Chest) },
			{ index: bedIndex, data: createBlockEntityData(BLOCK_ENTITY.Bed) },
		]
		const decoded = roundTrip({ ...snapshot, blockEntities: entries })
		expect(decoded.blockEntities.map((entry) => entry.index)).toEqual([bedIndex, chestIndex])
		for (const entry of entries) {
			const found = decoded.blockEntities.find((candidate) => candidate.index === entry.index)
			expect(found?.data).toEqual(blockEntityFromJson(blockEntityToJson(entry.data)))
		}
		expect(decoded.blocks).toEqual(snapshot.blocks)
	})
})

describe('canDecodeChunk', () => {
	it('rejects short, foreign and future payloads', () => {
		expect(canDecodeChunk(new Uint8Array(0))).toBe(false)
		expect(canDecodeChunk(new Uint8Array(4))).toBe(false)
		const bytes = encodeChunk(emptyChunkSnapshot())
		expect(canDecodeChunk(bytes)).toBe(true)
		const foreign = bytes.slice()
		foreign[0] = 0x00
		expect(canDecodeChunk(foreign)).toBe(false)
		expect(() => decodeChunk(foreign)).toThrow()
		const future = bytes.slice()
		future[4] = CHUNK_CODEC_VERSION + 1
		expect(canDecodeChunk(future)).toBe(false)
		expect(() => decodeChunk(future)).toThrow()
	})

	it('exposes the frozen codec object', () => {
		expect(CHUNK_CODEC.version).toBe(CHUNK_CODEC_VERSION)
		expect(createChunkCodec()).toBe(CHUNK_CODEC)
		const snapshot = emptyChunkSnapshot()
		fillSection(snapshot.blocks, 2, distinctIds(5))
		const bytes = CHUNK_CODEC.encode(snapshot)
		expect(CHUNK_CODEC.canDecode(bytes)).toBe(true)
		expect(CHUNK_CODEC.decode(bytes).blocks).toEqual(snapshot.blocks)
	})
})
