import { describe, expect, it } from 'vitest'
import { NET, NET_HEADER_BYTES, NET_MAGIC, NET_OPCODE } from '@voxelcraft/core-types'
import { FrameSplitter, decodeFrame, decodeFrames, encodeFrame, readFrameHeader } from './frame'

function payload(n: number): Uint8Array {
	const out = new Uint8Array(n)
	for (let i = 0; i < n; i++) out[i] = (i * 37) & 0xff
	return out
}

describe('frame header', () => {
	it('writes the frozen 8 byte layout', () => {
		const frame = encodeFrame(NET_OPCODE.Welcome, new Uint8Array([1, 2, 3]))
		expect(frame.length).toBe(NET_HEADER_BYTES + 3)
		const view = new DataView(frame.buffer)
		expect(view.getUint16(0, true)).toBe(NET_MAGIC)
		expect(view.getUint8(2)).toBe(NET.protocolVersion)
		expect(view.getUint8(3)).toBe(NET_OPCODE.Welcome)
		expect(view.getUint32(4, true)).toBe(3)
	})

	it('roundtrips every opcode with an empty payload', () => {
		for (const opcode of Object.values(NET_OPCODE)) {
			const { frame, next } = decodeFrame(encodeFrame(opcode, new Uint8Array(0)))
			expect(frame.opcode).toBe(opcode)
			expect(frame.version).toBe(NET.protocolVersion)
			expect(frame.payload.length).toBe(0)
			expect(next).toBe(NET_HEADER_BYTES)
		}
	})

	it('roundtrips a large payload byte for byte', () => {
		const body = payload(5000)
		const { frame } = decodeFrame(encodeFrame(NET_OPCODE.ChunkData, body))
		expect(frame.opcode).toBe(NET_OPCODE.ChunkData)
		expect(Array.from(frame.payload)).toEqual(Array.from(body))
	})

	it('reads a header without copying the payload', () => {
		const frame = encodeFrame(NET_OPCODE.Snapshot, payload(64))
		const header = readFrameHeader(frame)
		expect(header.opcode).toBe(NET_OPCODE.Snapshot)
		expect(header.payloadLength).toBe(64)
	})

	it('rejects a bad magic', () => {
		const frame = encodeFrame(NET_OPCODE.Ping, new Uint8Array(0))
		frame[0] = 0x00
		expect(() => decodeFrame(frame)).toThrow(/bad magic/)
	})

	it('rejects a truncated header', () => {
		expect(() => decodeFrame(new Uint8Array(NET_HEADER_BYTES - 1))).toThrow(/truncated header/)
	})

	it('rejects a payload shorter than the header claims', () => {
		const frame = encodeFrame(NET_OPCODE.Input, payload(16))
		expect(() => decodeFrame(frame.subarray(0, frame.length - 1))).toThrow(/truncated frame/)
	})

	it('walks several frames in one buffer', () => {
		const a = encodeFrame(NET_OPCODE.Hello, payload(3))
		const b = encodeFrame(NET_OPCODE.Pong, payload(4))
		const joined = new Uint8Array(a.length + b.length)
		joined.set(a, 0)
		joined.set(b, a.length)
		const frames = decodeFrames(joined)
		expect(frames.map((f) => f.opcode)).toEqual([NET_OPCODE.Hello, NET_OPCODE.Pong])
		expect(frames[1].payload.length).toBe(4)
	})
})

describe('FrameSplitter', () => {
	it('reassembles a frame delivered one byte at a time', () => {
		const splitter = new FrameSplitter()
		const frame = encodeFrame(NET_OPCODE.BlockChange, payload(40))
		const seen = []
		for (const byte of frame) seen.push(...splitter.push(new Uint8Array([byte])))
		expect(seen.length).toBe(1)
		expect(seen[0].opcode).toBe(NET_OPCODE.BlockChange)
		expect(seen[0].payload.length).toBe(40)
		expect(splitter.bufferedBytes).toBe(0)
	})

	it('returns every frame from a coalesced chunk and keeps the remainder', () => {
		const splitter = new FrameSplitter()
		const a = encodeFrame(NET_OPCODE.TimeSync, payload(16))
		const b = encodeFrame(NET_OPCODE.Kick, payload(8))
		const joined = new Uint8Array(a.length + b.length)
		joined.set(a, 0)
		joined.set(b, a.length)
		const first = splitter.push(joined.subarray(0, a.length + 4))
		expect(first.map((f) => f.opcode)).toEqual([NET_OPCODE.TimeSync])
		expect(splitter.bufferedBytes).toBe(4)
		const second = splitter.push(joined.subarray(a.length + 4))
		expect(second.map((f) => f.opcode)).toEqual([NET_OPCODE.Kick])
		expect(splitter.bufferedBytes).toBe(0)
	})

	it('forgets buffered bytes on reset', () => {
		const splitter = new FrameSplitter()
		splitter.push(encodeFrame(NET_OPCODE.Chat, payload(9)).subarray(0, 5))
		expect(splitter.bufferedBytes).toBe(5)
		splitter.reset()
		expect(splitter.bufferedBytes).toBe(0)
	})
})
