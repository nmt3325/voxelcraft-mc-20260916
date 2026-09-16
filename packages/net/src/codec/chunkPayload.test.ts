import { CHUNK_VOLUME, blockIndex } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import {
	canDecodeChunkPayload,
	decodeChunkPayload,
	encodeChunkPayload,
	type NetChunkSnapshot,
} from './chunkPayload'

function emptySnapshot(): NetChunkSnapshot {
	return {
		cx: 0,
		cz: 0,
		blocks: new Uint16Array(CHUNK_VOLUME),
		fluids: new Uint8Array(CHUNK_VOLUME),
	}
}

/** Report the first differing voxel instead of dumping a 65536 entry diff. */
function expectSameVoxels(actual: Uint16Array | Uint8Array, expected: Uint16Array | Uint8Array) {
	expect(actual.length).toBe(expected.length)
	let at = -1
	for (let i = 0; i < expected.length; i++) {
		if (actual[i] !== expected[i]) {
			at = i
			break
		}
	}
	const report = at === -1 ? 'equal' : `index ${at}: ${actual[at]} !== ${expected[at]}`
	expect(report).toBe('equal')
}

function roundtrip(snapshot: NetChunkSnapshot): NetChunkSnapshot {
	const decoded = decodeChunkPayload(encodeChunkPayload(snapshot))
	expectSameVoxels(decoded.blocks, snapshot.blocks)
	expectSameVoxels(decoded.fluids, snapshot.fluids)
	return decoded
}

describe('chunk payload', () => {
	it('encodes an all-air chunk as a bare header', () => {
		const snapshot = emptySnapshot()
		// 12 byte header plus the u16 block entity count, no sections at all.
		expect(encodeChunkPayload(snapshot).length).toBe(14)
		const decoded = roundtrip(snapshot)
		expect(decoded.cx).toBe(0)
		expect(decoded.cz).toBe(0)
	})

	it('roundtrips a single block', () => {
		const snapshot = emptySnapshot()
		snapshot.blocks[blockIndex(1, 2, 3)] = 7
		const decoded = roundtrip(snapshot)
		expect(decoded.blocks[blockIndex(1, 2, 3)]).toBe(7)
	})

	it('packs a three id palette into 2 bit entries', () => {
		const snapshot = emptySnapshot()
		snapshot.blocks[5] = 4
		snapshot.blocks[6] = 9
		snapshot.blocks[7] = 4
		const bytes = encodeChunkPayload(snapshot)
		// header 12 | paletteLen u16 | palette 3 * u16 | bits u8 at 20
		expect(bytes[12] | (bytes[13] << 8)).toBe(3)
		expect(bytes[20]).toBe(2)
		roundtrip(snapshot)
	})

	it('falls back to 16 bit entries past 256 ids', () => {
		const snapshot = emptySnapshot()
		for (let i = 0; i < 300; i++) snapshot.blocks[i] = i + 1
		const bytes = encodeChunkPayload(snapshot)
		// 300 distinct ids plus air, so bits lands after 301 palette entries.
		expect(bytes[12] | (bytes[13] << 8)).toBe(301)
		expect(bytes[616]).toBe(16)
		roundtrip(snapshot)
	})

	it('roundtrips a fluid only section', () => {
		const snapshot = emptySnapshot()
		snapshot.fluids[blockIndex(0, 20, 0)] = 3
		snapshot.fluids[blockIndex(1, 20, 0)] = 3
		snapshot.fluids[blockIndex(2, 20, 0)] = 8
		const decoded = roundtrip(snapshot)
		expect(decoded.fluids[blockIndex(2, 20, 0)]).toBe(8)
		expect(decoded.blocks[blockIndex(2, 20, 0)]).toBe(0)
	})

	it('rejects a wrong magic', () => {
		const bytes = encodeChunkPayload(emptySnapshot())
		expect(canDecodeChunkPayload(bytes)).toBe(true)
		const wrong = bytes.slice()
		wrong[0] = 0
		expect(canDecodeChunkPayload(wrong)).toBe(false)
		expect(() => decodeChunkPayload(wrong)).toThrow(/codec version/)
		expect(canDecodeChunkPayload(new Uint8Array(4))).toBe(false)
	})

	it('rejects truncated and trailing bytes', () => {
		const snapshot = emptySnapshot()
		snapshot.blocks[0] = 12
		const bytes = encodeChunkPayload(snapshot)
		expect(() => decodeChunkPayload(bytes.subarray(0, bytes.length - 1))).toThrow()
		const padded = new Uint8Array(bytes.length + 1)
		padded.set(bytes)
		expect(() => decodeChunkPayload(padded)).toThrow(/trailing/)
	})

	it('rejects a snapshot of the wrong size', () => {
		const snapshot = { cx: 0, cz: 0, blocks: new Uint16Array(8), fluids: new Uint8Array(8) }
		expect(() => encodeChunkPayload(snapshot)).toThrow(/voxels/)
	})
})
