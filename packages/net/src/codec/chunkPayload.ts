import {
	CHUNK_CODEC_VERSION,
	CHUNK_MAGIC,
	CHUNK_VOLUME,
	SECTIONS_PER_CHUNK,
	type BlockId,
} from '@voxelcraft/core-types'
import { ByteReader, ByteWriter } from '../bytes'

/**
 * Payload carried by NetChunkData.bytes:
 *
 *   magic[4] | version u16 | flags u16 | sectionMask u16 | reserved u16
 *   per section with its mask bit set, ascending sy:
 *     paletteLen u16 | palette u16 * paletteLen | bits u8 | pad u8 | data u32 * n
 *   fluid layer: the same section mask, RLE pairs (value u8, runLength u16)
 *   block entities: count u16 | (index u16 | jsonLen u16 | utf8 json) * count
 *
 * This is byte-for-byte the frozen save codec so the server can stream the same
 * bytes it persists instead of transcoding every chunk it sends.
 *
 * `cx`/`cz` are not in the payload: on the wire they ride in the ChunkData
 * header, on disk they live in the storage key. `decodeChunkPayload` therefore
 * reports 0/0 and the caller fills them in from the message it decoded.
 *
 * The v2 net snapshot carries no block entities yet, so we always write a count
 * of 0, but we still skip records a newer sender may add.
 */

export interface NetChunkSnapshot {
	cx: number
	cz: number
	blocks: Uint16Array
	fluids: Uint8Array
}

/** Voxels in one 16-high section. */
const SECTION_VOLUME = CHUNK_VOLUME / SECTIONS_PER_CHUNK
const HEADER_BYTES = 12

/** Smallest of {0,1,2,4,8,16} that can index `paletteLen` entries. */
function bitsForPaletteLength(paletteLen: number): number {
	if (paletteLen === 1) return 0
	if (paletteLen <= 2) return 1
	if (paletteLen <= 4) return 2
	if (paletteLen <= 16) return 4
	if (paletteLen <= 256) return 8
	if (paletteLen <= 65536) return 16
	throw new RangeError(`net: chunk section palette too large: ${paletteLen}`)
}

/** Entries packed per u32 word. Entries never straddle a word. */
function entriesPerWord(bits: number): number {
	return bits === 0 ? 0 : 32 / bits
}

/** One shared mask: a section ships when it holds any block *or* any fluid. */
function sectionMaskOf(blocks: Uint16Array, fluids: Uint8Array): number {
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

function writeSection(w: ByteWriter, blocks: Uint16Array, base: number): void {
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
	w.u16(palette.length)
	for (const id of palette) w.u16(id)
	const bits = bitsForPaletteLength(palette.length)
	w.u8(bits)
	w.u8(0)
	// A uniform section is fully described by its single palette entry.
	if (bits === 0) return
	const perWord = entriesPerWord(bits)
	const words = SECTION_VOLUME / perWord
	const valueMask = (1 << bits) - 1
	for (let word = 0; word < words; word++) {
		let packed = 0
		for (let slot = 0; slot < perWord; slot++) {
			packed |= (entries[word * perWord + slot] & valueMask) << (slot * bits)
		}
		w.u32(packed >>> 0)
	}
}

function readSection(r: ByteReader, blocks: Uint16Array, base: number): void {
	const paletteLen = r.u16()
	if (paletteLen < 1) throw new Error('net: chunk section palette must not be empty')
	const palette = new Uint16Array(paletteLen)
	for (let i = 0; i < paletteLen; i++) palette[i] = r.u16()
	const bits = r.u8()
	r.u8()
	const expected = bitsForPaletteLength(paletteLen)
	if (bits !== expected) {
		throw new Error(`net: chunk section bits ${bits} does not match palette length ${paletteLen}`)
	}
	if (bits === 0) {
		blocks.fill(palette[0], base, base + SECTION_VOLUME)
		return
	}
	const perWord = entriesPerWord(bits)
	const words = SECTION_VOLUME / perWord
	const valueMask = (1 << bits) - 1
	for (let word = 0; word < words; word++) {
		const packed = r.u32()
		for (let slot = 0; slot < perWord; slot++) {
			const value = (packed >>> (slot * bits)) & valueMask
			if (value >= paletteLen) throw new Error(`net: palette index out of range: ${value}`)
			blocks[base + word * perWord + slot] = palette[value]
		}
	}
}

function writeFluidRuns(w: ByteWriter, fluids: Uint8Array, base: number): void {
	let i = 0
	while (i < SECTION_VOLUME) {
		const value = fluids[base + i]
		let run = 1
		while (run < SECTION_VOLUME - i && fluids[base + i + run] === value) run++
		w.u8(value)
		w.u16(run)
		i += run
	}
}

function readFluidRuns(r: ByteReader, fluids: Uint8Array, base: number): void {
	let filled = 0
	while (filled < SECTION_VOLUME) {
		const value = r.u8()
		const run = r.u16()
		if (run < 1 || filled + run > SECTION_VOLUME) {
			throw new Error(`net: invalid fluid run length: ${run}`)
		}
		if (value !== 0) fluids.fill(value, base + filled, base + filled + run)
		filled += run
	}
}

/** Accept, but drop, block entity records from senders that write them. */
function skipBlockEntities(r: ByteReader): void {
	const count = r.u16()
	for (let i = 0; i < count; i++) {
		r.u16()
		const jsonLen = r.u16()
		r.bytes(jsonLen)
	}
}

export function encodeChunkPayload(snapshot: NetChunkSnapshot): Uint8Array {
	if (snapshot.blocks.length !== CHUNK_VOLUME) {
		throw new RangeError(
			`net: blocks must hold ${CHUNK_VOLUME} voxels, got ${snapshot.blocks.length}`,
		)
	}
	if (snapshot.fluids.length !== CHUNK_VOLUME) {
		throw new RangeError(
			`net: fluids must hold ${CHUNK_VOLUME} voxels, got ${snapshot.fluids.length}`,
		)
	}
	const mask = sectionMaskOf(snapshot.blocks, snapshot.fluids)
	const w = new ByteWriter(HEADER_BYTES + 4096)
	for (const byte of CHUNK_MAGIC) w.u8(byte)
	w.u16(CHUNK_CODEC_VERSION)
	w.u16(0)
	w.u16(mask)
	w.u16(0)
	for (let sy = 0; sy < SECTIONS_PER_CHUNK; sy++) {
		if ((mask & (1 << sy)) === 0) continue
		writeSection(w, snapshot.blocks, sy * SECTION_VOLUME)
	}
	for (let sy = 0; sy < SECTIONS_PER_CHUNK; sy++) {
		if ((mask & (1 << sy)) === 0) continue
		writeFluidRuns(w, snapshot.fluids, sy * SECTION_VOLUME)
	}
	w.u16(0)
	return w.finish()
}

export function canDecodeChunkPayload(bytes: Uint8Array): boolean {
	if (bytes.length < HEADER_BYTES) return false
	for (let i = 0; i < CHUNK_MAGIC.length; i++) {
		if (bytes[i] !== CHUNK_MAGIC[i]) return false
	}
	const version = bytes[4] | (bytes[5] << 8)
	return version === CHUNK_CODEC_VERSION
}

export function decodeChunkPayload(bytes: Uint8Array): NetChunkSnapshot {
	if (!canDecodeChunkPayload(bytes)) {
		throw new Error(`net: not a chunk payload of codec version ${CHUNK_CODEC_VERSION}`)
	}
	const r = new ByteReader(bytes)
	r.bytes(CHUNK_MAGIC.length)
	r.u16()
	r.u16()
	const mask = r.u16()
	r.u16()
	const blocks = new Uint16Array(CHUNK_VOLUME)
	const fluids = new Uint8Array(CHUNK_VOLUME)
	for (let sy = 0; sy < SECTIONS_PER_CHUNK; sy++) {
		if ((mask & (1 << sy)) === 0) continue
		readSection(r, blocks, sy * SECTION_VOLUME)
	}
	for (let sy = 0; sy < SECTIONS_PER_CHUNK; sy++) {
		if ((mask & (1 << sy)) === 0) continue
		readFluidRuns(r, fluids, sy * SECTION_VOLUME)
	}
	skipBlockEntities(r)
	r.requireEnd()
	return { cx: 0, cz: 0, blocks, fluids }
}
