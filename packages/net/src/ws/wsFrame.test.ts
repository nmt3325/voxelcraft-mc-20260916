import { describe, expect, it } from 'vitest'
import {
	WS_MAX_CONTROL_BYTES,
	WS_OPCODE,
	WsFrameReader,
	encodeCloseFrame,
	encodeWsFrame,
	parseClosePayload,
	type WsOpcode,
} from './wsFrame'

function pattern(n: number, seed = 7): Uint8Array {
	const out = new Uint8Array(n)
	for (let i = 0; i < n; i++) out[i] = (i * 31 + seed) & 0xff
	return out
}

/** encodeWsFrame always sets FIN, so fragments are made by clearing the bit. */
function fragment(opcode: WsOpcode, payload: Uint8Array): Uint8Array {
	const frame = encodeWsFrame(opcode, payload, false)
	frame[0] &= 0x7f
	return frame
}

describe('encodeWsFrame', () => {
	it('roundtrips all three length encodings unmasked', () => {
		const reader = new WsFrameReader({ expectMasked: false })
		for (const size of [0, 10, WS_MAX_CONTROL_BYTES, 200, 70_000]) {
			const payload = pattern(size, size)
			const [message] = reader.push(encodeWsFrame(WS_OPCODE.Binary, payload, false))
			expect(message.opcode).toBe(WS_OPCODE.Binary)
			expect(message.payload).toEqual(payload)
		}
	})

	it('roundtrips masked client frames and lays out the mask key', () => {
		const reader = new WsFrameReader({ expectMasked: true })
		const payload = pattern(40)
		const frame = encodeWsFrame(WS_OPCODE.Binary, payload, true)
		// 2 header bytes + 4 mask key bytes + payload, with the mask bit set.
		expect(frame.length).toBe(2 + 4 + payload.length)
		expect(frame[1] & 0x80).toBe(0x80)
		expect(frame[1] & 0x7f).toBe(payload.length)
		const [message] = reader.push(frame)
		expect(message.payload).toEqual(payload)
	})

	it('refuses to build an oversized control frame', () => {
		expect(() => encodeWsFrame(WS_OPCODE.Ping, pattern(126), false)).toThrow(
			/control frame too long/,
		)
	})
})

describe('WsFrameReader', () => {
	it('reassembles a frame delivered one byte at a time', () => {
		const reader = new WsFrameReader({ expectMasked: false })
		const payload = pattern(300)
		const frame = encodeWsFrame(WS_OPCODE.Binary, payload, false)
		let delivered: Uint8Array | null = null
		for (let i = 0; i < frame.length; i++) {
			const messages = reader.push(frame.subarray(i, i + 1))
			if (messages.length > 0) delivered = messages[0].payload
		}
		expect(delivered).toEqual(payload)
		expect(reader.bufferedBytes).toBe(0)
	})

	it('returns several frames coalesced into one chunk', () => {
		const reader = new WsFrameReader({ expectMasked: false })
		const first = encodeWsFrame(WS_OPCODE.Binary, pattern(4, 1), false)
		const second = encodeWsFrame(WS_OPCODE.Binary, pattern(6, 2), false)
		const chunk = new Uint8Array(first.length + second.length)
		chunk.set(first, 0)
		chunk.set(second, first.length)
		const messages = reader.push(chunk)
		expect(messages).toHaveLength(2)
		expect(messages[0].payload).toEqual(pattern(4, 1))
		expect(messages[1].payload).toEqual(pattern(6, 2))
	})

	it('keeps a partial frame buffered', () => {
		const reader = new WsFrameReader({ expectMasked: false })
		const frame = encodeWsFrame(WS_OPCODE.Binary, pattern(20), false)
		expect(reader.push(frame.subarray(0, 10))).toHaveLength(0)
		expect(reader.bufferedBytes).toBe(10)
		expect(reader.push(frame.subarray(10))).toHaveLength(1)
	})

	it('joins a fragmented message into one payload', () => {
		const reader = new WsFrameReader({ expectMasked: false })
		const head = pattern(5, 1)
		const tail = pattern(7, 2)
		expect(reader.push(fragment(WS_OPCODE.Binary, head))).toHaveLength(0)
		const messages = reader.push(encodeWsFrame(WS_OPCODE.Continuation, tail, false))
		expect(messages).toHaveLength(1)
		expect(messages[0].opcode).toBe(WS_OPCODE.Binary)
		expect(messages[0].payload).toEqual(new Uint8Array([...head, ...tail]))
	})

	it('delivers a control frame that interleaves with fragments', () => {
		const reader = new WsFrameReader({ expectMasked: false })
		reader.push(fragment(WS_OPCODE.Binary, pattern(3)))
		const mid = reader.push(encodeWsFrame(WS_OPCODE.Ping, new Uint8Array([9]), false))
		expect(mid).toHaveLength(1)
		expect(mid[0].opcode).toBe(WS_OPCODE.Ping)
		// The interrupted message still completes afterwards.
		const done = reader.push(encodeWsFrame(WS_OPCODE.Continuation, pattern(2), false))
		expect(done[0].payload).toHaveLength(5)
	})

	it('rejects an unmasked client frame', () => {
		const reader = new WsFrameReader({ expectMasked: true })
		expect(() => reader.push(encodeWsFrame(WS_OPCODE.Binary, pattern(4), false))).toThrow(
			/expected a masked frame/,
		)
	})

	it('rejects a masked server frame', () => {
		const reader = new WsFrameReader({ expectMasked: false })
		expect(() => reader.push(encodeWsFrame(WS_OPCODE.Binary, pattern(4), true))).toThrow(
			/unexpected mask/,
		)
	})

	it('rejects reserved bits', () => {
		const reader = new WsFrameReader({ expectMasked: false })
		const frame = encodeWsFrame(WS_OPCODE.Binary, pattern(2), false)
		frame[0] |= 0x40
		expect(() => reader.push(frame)).toThrow(/reserved bits/)
	})

	it('rejects a fragmented control frame', () => {
		const reader = new WsFrameReader({ expectMasked: false })
		expect(() => reader.push(fragment(WS_OPCODE.Ping, new Uint8Array([1])))).toThrow(
			/fragmented control frame/,
		)
	})

	it('rejects a continuation with nothing to continue', () => {
		const reader = new WsFrameReader({ expectMasked: false })
		expect(() => reader.push(encodeWsFrame(WS_OPCODE.Continuation, pattern(2), false))).toThrow(
			/continuation without a start/,
		)
	})

	it('rejects a message over the configured limit', () => {
		const reader = new WsFrameReader({ expectMasked: false, maxMessageBytes: 32 })
		expect(() => reader.push(encodeWsFrame(WS_OPCODE.Binary, pattern(64), false))).toThrow(
			/message too large/,
		)
	})
})

describe('close frames', () => {
	it('roundtrips the code and reason', () => {
		const reader = new WsFrameReader({ expectMasked: false })
		const [message] = reader.push(encodeCloseFrame(1002, 'protocol error', false))
		expect(message.opcode).toBe(WS_OPCODE.Close)
		expect(parseClosePayload(message.payload)).toEqual({ code: 1002, reason: 'protocol error' })
	})

	it('treats an empty close payload as a normal closure', () => {
		expect(parseClosePayload(new Uint8Array(0))).toEqual({ code: 1000, reason: '' })
	})
})
