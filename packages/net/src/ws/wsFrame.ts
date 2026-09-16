/**
 * RFC 6455 data framing. Hand rolled for the same reason as the handshake: no
 * new dependency, and we only need binary messages plus the three control
 * frames.
 *
 * The reader hands back whole messages, not raw frames, so callers never have
 * to reassemble a fragmented payload themselves.
 */
import { randomBytes } from 'node:crypto'
import { NET } from '@voxelcraft/core-types'

export const WS_OPCODE = {
	Continuation: 0x0,
	Text: 0x1,
	Binary: 0x2,
	Close: 0x8,
	Ping: 0x9,
	Pong: 0xa,
} as const
export type WsOpcode = (typeof WS_OPCODE)[keyof typeof WS_OPCODE]

/** RFC 6455 section 5.5: a control frame carries at most 125 bytes. */
export const WS_MAX_CONTROL_BYTES = 125

/** Normal closure, used whenever we hang up on purpose. */
export const WS_CLOSE_NORMAL = 1000
export const WS_CLOSE_PROTOCOL_ERROR = 1002
export const WS_CLOSE_TOO_LARGE = 1009

export interface WsMessage {
	readonly opcode: WsOpcode
	readonly payload: Uint8Array
}

const EMPTY = new Uint8Array(0)

function isControl(opcode: number): boolean {
	return (opcode & 0x08) !== 0
}

/** One unfragmented frame. FIN is always set: we never split on send. */
export function encodeWsFrame(
	opcode: WsOpcode,
	payload: Uint8Array,
	masked: boolean,
): Uint8Array {
	const len = payload.length
	if (isControl(opcode) && len > WS_MAX_CONTROL_BYTES) {
		throw new Error(`ws: control frame too long: ${len}`)
	}
	let headerBytes = 2
	if (len > 0xffff) headerBytes += 8
	else if (len > WS_MAX_CONTROL_BYTES) headerBytes += 2
	if (masked) headerBytes += 4

	const out = new Uint8Array(headerBytes + len)
	const view = new DataView(out.buffer)
	out[0] = 0x80 | opcode
	if (len > 0xffff) {
		out[1] = 127
		view.setBigUint64(2, BigInt(len))
	} else if (len > WS_MAX_CONTROL_BYTES) {
		out[1] = 126
		view.setUint16(2, len)
	} else {
		out[1] = len
	}

	if (masked) {
		out[1] |= 0x80
		const key = randomBytes(4)
		out.set(key, headerBytes - 4)
		for (let i = 0; i < len; i++) out[headerBytes + i] = payload[i] ^ key[i & 3]
	} else {
		out.set(payload, headerBytes)
	}
	return out
}

export function encodeCloseFrame(code: number, reason: string, masked: boolean): Uint8Array {
	const reasonBytes = new TextEncoder().encode(reason)
	const payload = new Uint8Array(2 + reasonBytes.length)
	new DataView(payload.buffer).setUint16(0, code)
	payload.set(reasonBytes, 2)
	return encodeWsFrame(WS_OPCODE.Close, payload, masked)
}

export function parseClosePayload(payload: Uint8Array): { code: number; reason: string } {
	if (payload.length < 2) return { code: WS_CLOSE_NORMAL, reason: '' }
	const code = new DataView(payload.buffer, payload.byteOffset, payload.length).getUint16(0)
	return { code, reason: new TextDecoder('utf-8').decode(payload.subarray(2)) }
}

export interface WsFrameReaderOptions {
	/** True on the server: RFC 6455 requires every client frame to be masked. */
	readonly expectMasked: boolean
	readonly maxMessageBytes?: number
}

interface ParsedFrame {
	readonly fin: boolean
	readonly opcode: number
	readonly payload: Uint8Array
	readonly next: number
}

export class WsFrameReader {
	private pending = EMPTY
	private fragmentOpcode: WsOpcode | null = null
	private fragments: Uint8Array[] = []
	private fragmentBytes = 0
	private readonly expectMasked: boolean
	private readonly maxMessageBytes: number

	constructor(options: WsFrameReaderOptions) {
		this.expectMasked = options.expectMasked
		this.maxMessageBytes = options.maxMessageBytes ?? NET.maxMessageBytes
	}

	get bufferedBytes(): number {
		return this.pending.length
	}

	push(chunk: Uint8Array): WsMessage[] {
		let buf: Uint8Array
		if (this.pending.length === 0) {
			buf = chunk
		} else {
			buf = new Uint8Array(this.pending.length + chunk.length)
			buf.set(this.pending, 0)
			buf.set(chunk, this.pending.length)
		}

		const messages: WsMessage[] = []
		let at = 0
		for (;;) {
			const frame = this.parse(buf, at)
			if (frame === null) break
			at = frame.next
			const message = this.accept(frame)
			if (message !== null) messages.push(message)
		}
		this.pending = at === buf.length ? EMPTY : buf.slice(at)
		return messages
	}

	/** null means "need more bytes"; a protocol violation throws. */
	private parse(buf: Uint8Array, offset: number): ParsedFrame | null {
		if (buf.length - offset < 2) return null
		const first = buf[offset]
		const second = buf[offset + 1]
		const fin = (first & 0x80) !== 0
		if ((first & 0x70) !== 0) throw new Error('ws: reserved bits set')
		const opcode = first & 0x0f
		const masked = (second & 0x80) !== 0
		if (masked !== this.expectMasked) {
			throw new Error(masked ? 'ws: unexpected mask' : 'ws: expected a masked frame')
		}

		let at = offset + 2
		let length = second & 0x7f
		if (length === 126) {
			if (buf.length - at < 2) return null
			length = new DataView(buf.buffer, buf.byteOffset + at, 2).getUint16(0)
			at += 2
		} else if (length === 127) {
			if (buf.length - at < 8) return null
			const big = new DataView(buf.buffer, buf.byteOffset + at, 8).getBigUint64(0)
			if (big > BigInt(this.maxMessageBytes)) throw new Error('ws: message too large')
			length = Number(big)
			at += 8
		}
		if (length > this.maxMessageBytes) throw new Error('ws: message too large')
		if (isControl(opcode)) {
			if (!fin) throw new Error('ws: fragmented control frame')
			if (length > WS_MAX_CONTROL_BYTES) throw new Error('ws: control frame too long')
		}

		let key: Uint8Array | null = null
		if (masked) {
			if (buf.length - at < 4) return null
			key = buf.subarray(at, at + 4)
			at += 4
		}
		if (buf.length - at < length) return null

		const payload = buf.slice(at, at + length)
		if (key !== null) {
			for (let i = 0; i < payload.length; i++) payload[i] ^= key[i & 3]
		}
		return { fin, opcode, payload, next: at + length }
	}

	private accept(frame: ParsedFrame): WsMessage | null {
		if (isControl(frame.opcode)) {
			return { opcode: frame.opcode as WsOpcode, payload: frame.payload }
		}
		if (frame.opcode === WS_OPCODE.Continuation) {
			if (this.fragmentOpcode === null) throw new Error('ws: continuation without a start')
		} else {
			if (this.fragmentOpcode !== null) throw new Error('ws: interleaved data frame')
			this.fragmentOpcode = frame.opcode as WsOpcode
		}

		this.fragments.push(frame.payload)
		this.fragmentBytes += frame.payload.length
		if (this.fragmentBytes > this.maxMessageBytes) throw new Error('ws: message too large')
		if (!frame.fin) return null

		const opcode = this.fragmentOpcode
		const payload = new Uint8Array(this.fragmentBytes)
		let at = 0
		for (const part of this.fragments) {
			payload.set(part, at)
			at += part.length
		}
		this.fragmentOpcode = null
		this.fragments = []
		this.fragmentBytes = 0
		return { opcode, payload }
	}
}
