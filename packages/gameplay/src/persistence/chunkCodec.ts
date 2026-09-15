import {
	CHUNK_CODEC_VERSION,
	CHUNK_MAGIC,
	CHUNK_VOLUME,
	SECTIONS_PER_CHUNK,
	blockIndex,
	worldToLocal,
	type BlockId,
	type ChunkCodec,
	type ChunkData,
	type ChunkSnapshot,
	type SerializedBlockEntity,
} from '@voxelcraft/core-types'
import {
	blockEntityFromJson,
	blockEntityToJson,
	deserializeBlockEntities,
	serializeBlockEntities,
} from '../blockEntities/data'
import { ByteReader, ByteWriter } from './bytes'

/**
 * Chunk serialization, frozen for save version 1:
 *
 *   magic[4] | version u16 | flags u16 | sectionMask u16 | reserved u16
 *   per section with its mask bit set, ascending sy:
 *     paletteLen u16 | palette u16 * paletteLen | bits u8 | pad u8 | data u32 * n
 *   fluid layer: the same section mask, RLE pairs (value u8, runLength u16)
 *   block entities: count u16 | (index u16 | jsonLen u16 | utf8 json) * count
 *
 * Notes:
 * - Light is derived state and is never written.
 * - A section bit is set when the section holds any non-air block *or* any
 *   fluid, so both layers really do share one mask.
 * - `cx`/`cz` live in the storage key, not in the payload, so `decode` reports
 *   0/0. Callers that know the coordinates use `decodeChunkAt`.
 */

/** Voxels in one 16-high section. */
export const SECTION_VOLUME = CHUNK_VOLUME / SECTIONS_PER_CHUNK
export const CHUNK_HEADER_BYTES = 12

const MAX_U16 = 0xffff
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/** Smallest of {0,1,2,4,8,16} that can index `paletteLen` entries. */
export function bitsForPaletteLength(paletteLen: number): number {
	if (!Number.isInteger(paletteLen) || paletteLen < 1) {
		throw new RangeError(`invalid palette length: ${String(paletteLen)}`)
	}
	if (paletteLen === 1) return 0
	if (paletteLen <= 2) return 1
	if (paletteLen <= 4) return 2
	if (paletteLen <= 16) return 4
	if (paletteLen <= 256) return 8
	if (paletteLen <= 65536) return 16
	throw new RangeError(`palette too large: ${paletteLen}`)
}

/** Entries packed per u32 word. Entries never straddle a word. */
export function entriesPerWord(bits: number): number {
	return bits === 0 ? 0 : 32 / bits
}

/** Chunk-local voxel index for a world position. */
export function chunkLocalIndex(wx: number, wy: number, wz: number): number {
	return blockIndex(worldToLocal(wx), wy, worldToLocal(wz))
}

export function sectionMaskOf(blocks: Uint16Array, fluids: Uint8Array): number {
	let mask = 0
	for (let sy = 0; sy < SECTIONS_PER_CHUNK; sy++) {
		const base = sy * SECTION_VOLUME
		for (let i = 0; i < SECTION_VOLUME; i++) {
			if (blocks[base + i] !== 0 || fluids[base + i] !== 0) {
				mask |= 1 << sy
				break
			}
		}
	}
	return mask
}

function writeSection(out: ByteWriter, blocks: Uint16Array, base: number): void {
	const paletteIndex = new Map<BlockId, number>()
	const palette: BlockId[] = []
	const entries = new Uint16Array(SECTION_VOLUME)
	for (let i = 0; i < SECTION_VOLUME; i++) {
		const id = blocks[base + i]
		let index = paletteIndex.get(id)
		if (index === undefined) {
			index = palette.length
			paletteIndex.set(id, index)
			palette.push(id)
		}
		entries[i] = index
	}
	out.u16(palette.length)
	for (const id of palette) out.u16(id)
	const bits = bitsForPaletteLength(palette.length)
	out.u8(bits)
	out.u8(0)
	if (bits === 0) return
	const perWord = entriesPerWord(bits)
	const words = SECTION_VOLUME / perWord
	const valueMask = (1 << bits) - 1
	for (let w = 0; w < words; w++) {
		let word = 0
		for (let slot = 0; slot < perWord; slot++) {
			word |= (entries[w * perWord + slot] & valueMask) << (slot * bits)
		}
		out.u32(word >>> 0)
	}
}

function readSection(reader: ByteReader, blocks: Uint16Array, base: number): void {
	const paletteLen = reader.u16()
	if (paletteLen < 1) throw new Error('chunk section palette must not be empty')
	const palette = new Uint16Array(paletteLen)
	for (let i = 0; i < paletteLen; i++) palette[i] = reader.u16()
	const bits = reader.u8()
	reader.u8()
	const expected = bitsForPaletteLength(paletteLen)
	if (bits !== expected) {
		throw new Error(`chunk section bits ${bits} does not match palette length ${paletteLen}`)
	}
	if (bits === 0) {
		blocks.fill(palette[0], base, base + SECTION_VOLUME)
		return
	}
	const perWord = entriesPerWord(bits)
	const words = SECTION_VOLUME / perWord
	const valueMask = (1 << bits) - 1
	for (let w = 0; w < words; w++) {
		const word = reader.u32()
		for (let slot = 0; slot < perWord; slot++) {
			const value = (word >>> (slot * bits)) & valueMask
			if (value >= paletteLen) throw new Error(`palette index out of range: ${value}`)
			blocks[base + w * perWord + slot] = palette[value]
		}
	}
}

function writeFluidRuns(out: ByteWriter, fluids: Uint8Array, base: number): void {
	let i = 0
	while (i < SECTION_VOLUME) {
		const value = fluids[base + i]
		let run = 1
		while (run < SECTION_VOLUME - i && fluids[base + i + run] === value) run++
		out.u8(value)
		out.u16(run)
		i += run
	}
}

function readFluidRuns(reader: ByteReader, fluids: Uint8Array, base: number): void {
	let filled = 0
	while (filled < SECTION_VOLUME) {
		const value = reader.u8()
		const run = reader.u16()
		if (run < 1 || filled + run > SECTION_VOLUME) {
			throw new Error(`invalid fluid run length: ${run}`)
		}
		if (value !== 0) fluids.fill(value, base + filled, base + filled + run)
		filled += run
	}
}

function writeBlockEntities(out: ByteWriter, entities: readonly SerializedBlockEntity[]): void {
	const ordered = serializeBlockEntities(
		new Map(entities.map((entry) => [entry.index, entry.data])),
	)
	if (ordered.length > MAX_U16) {
		throw new RangeError(`too many block entities in one chunk: ${ordered.length}`)
	}
	out.u16(ordered.length)
	for (const entry of ordered) {
		if (!Number.isInteger(entry.index) || entry.index < 0 || entry.index > MAX_U16) {
			throw new RangeError(`block entity index out of range: ${String(entry.index)}`)
		}
		const json = textEncoder.encode(blockEntityToJson(entry.data))
		if (json.length > MAX_U16) {
			throw new RangeError(`block entity JSON too long at index ${entry.index}: ${json.length}`)
		}
		out.u16(entry.index)
		out.u16(json.length)
		out.raw(json)
	}
}

function readBlockEntities(reader: ByteReader): SerializedBlockEntity[] {
	const count = reader.u16()
	const entries: SerializedBlockEntity[] = []
	for (let i = 0; i < count; i++) {
		const index = reader.u16()
		const jsonLen = reader.u16()
		const json = textDecoder.decode(reader.raw(jsonLen))
		entries.push({ index, data: blockEntityFromJson(json) })
	}
	return serializeBlockEntities(deserializeBlockEntities(entries))
}

export function encodeChunk(snapshot: ChunkSnapshot): Uint8Array {
	if (snapshot.blocks.length !== CHUNK_VOLUME) {
		throw new RangeError(`blocks must hold ${CHUNK_VOLUME} voxels, got ${snapshot.blocks.length}`)
	}
	if (snapshot.fluids.length !== CHUNK_VOLUME) {
		throw new RangeError(`fluids must hold ${CHUNK_VOLUME} voxels, got ${snapshot.fluids.length}`)
	}
	const mask = sectionMaskOf(snapshot.blocks, snapshot.fluids)
	const out = new ByteWriter(CHUNK_HEADER_BYTES + 4096)
	for (const byte of CHUNK_MAGIC) out.u8(byte)
	out.u16(CHUNK_CODEC_VERSION)
	out.u16(0)
	out.u16(mask)
	out.u16(0)
	for (let sy = 0; sy < SECTIONS_PER_CHUNK; sy++) {
		if ((mask & (1 << sy)) === 0) continue
		writeSection(out, snapshot.blocks, sy * SECTION_VOLUME)
	}
	for (let sy = 0; sy < SECTIONS_PER_CHUNK; sy++) {
		if ((mask & (1 << sy)) === 0) continue
		writeFluidRuns(out, snapshot.fluids, sy * SECTION_VOLUME)
	}
	writeBlockEntities(out, snapshot.blockEntities)
	return out.toBytes()
}

export function canDecodeChunk(bytes: Uint8Array): boolean {
	if (bytes.length < CHUNK_HEADER_BYTES) return false
	for (let i = 0; i < CHUNK_MAGIC.length; i++) {
		if (bytes[i] !== CHUNK_MAGIC[i]) return false
	}
	const version = bytes[4] | (bytes[5] << 8)
	return version === CHUNK_CODEC_VERSION
}

export function decodeChunkAt(bytes: Uint8Array, cx: number, cz: number): ChunkSnapshot {
	if (!canDecodeChunk(bytes)) {
		throw new Error('not a VoxelCraft chunk payload of codec version 1')
	}
	const reader = new ByteReader(bytes)
	reader.skip(CHUNK_MAGIC.length)
	reader.u16()
	reader.u16()
	const mask = reader.u16()
	reader.u16()
	const blocks = new Uint16Array(CHUNK_VOLUME)
	const fluids = new Uint8Array(CHUNK_VOLUME)
	for (let sy = 0; sy < SECTIONS_PER_CHUNK; sy++) {
		if ((mask & (1 << sy)) === 0) continue
		readSection(reader, blocks, sy * SECTION_VOLUME)
	}
	for (let sy = 0; sy < SECTIONS_PER_CHUNK; sy++) {
		if ((mask & (1 << sy)) === 0) continue
		readFluidRuns(reader, fluids, sy * SECTION_VOLUME)
	}
	return { cx, cz, blocks, fluids, blockEntities: readBlockEntities(reader) }
}

export function decodeChunk(bytes: Uint8Array): ChunkSnapshot {
	return decodeChunkAt(bytes, 0, 0)
}

/** The frozen v1 codec. */
export const CHUNK_CODEC: ChunkCodec = {
	version: CHUNK_CODEC_VERSION,
	encode: encodeChunk,
	decode: decodeChunk,
	canDecode: canDecodeChunk,
}

export function createChunkCodec(): ChunkCodec {
	return CHUNK_CODEC
}

export function emptyChunkSnapshot(cx = 0, cz = 0): ChunkSnapshot {
	return {
		cx,
		cz,
		blocks: new Uint16Array(CHUNK_VOLUME),
		fluids: new Uint8Array(CHUNK_VOLUME),
		blockEntities: [],
	}
}

/** Serializable view of a live chunk. Light and heightmap are not saved. */
export function snapshotFromChunk(chunk: ChunkData): ChunkSnapshot {
	return {
		cx: chunk.cx,
		cz: chunk.cz,
		blocks: chunk.blocks,
		fluids: chunk.fluids,
		blockEntities: serializeBlockEntities(chunk.blockEntities),
	}
}

/** Loads a decoded snapshot back into a live chunk. */
export function applySnapshotToChunk(snapshot: ChunkSnapshot, chunk: ChunkData): void {
	chunk.blocks.set(snapshot.blocks)
	chunk.fluids.set(snapshot.fluids)
	chunk.blockEntities.clear()
	for (const [index, data] of deserializeBlockEntities(snapshot.blockEntities)) {
		chunk.blockEntities.set(index, data)
	}
	chunk.revision += 1
	chunk.generated = true
	chunk.lit = false
	chunk.dirtyForSave = false
	chunk.dirtySections = 0xffff
}
