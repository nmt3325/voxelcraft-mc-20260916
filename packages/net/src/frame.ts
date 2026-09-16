/**
 * Frame codec on top of the frozen 8 byte header from the shared contract.
 * The header itself (magic, version, opcode, payload length) is encoded by
 * core-types; this module only owns concatenation, splitting and the streaming
 * reassembly a socket needs.
 */
import {
	NET,
	NET_HEADER_BYTES,
	decodeFrameHeader,
	encodeFrameHeader,
	type NetFrameHeader,
	type NetOpcode,
} from '@voxelcraft/core-types'

export interface NetFrame {
	readonly version: number
	readonly opcode: NetOpcode
	readonly payload: Uint8Array
}

/** header + payload as one buffer, ready for a single websocket message. */
export function encodeFrame(opcode: NetOpcode, payload: Uint8Array): Uint8Array {
	const out = new Uint8Array(NET_HEADER_BYTES + payload.length)
	encodeFrameHeader(new DataView(out.buffer), 0, opcode, payload.length)
	out.set(payload, NET_HEADER_BYTES)
	return out
}

export function readFrameHeader(bytes: Uint8Array, offset = 0): NetFrameHeader {
	return decodeFrameHeader(new DataView(bytes.buffer, bytes.byteOffset, bytes.length), offset)
}

/**
 * Decode exactly one frame starting at `offset`.
 * `next` is the offset just past this frame, so a caller can walk a buffer that
 * holds several frames back to back.
 */
export function decodeFrame(bytes: Uint8Array, offset = 0): { frame: NetFrame; next: number } {
	const header = readFrameHeader(bytes, offset)
	const start = offset + NET_HEADER_BYTES
	const end = start + header.payloadLength
	if (end > bytes.length) throw new Error('net: truncated frame payload')
	return {
		frame: {
			version: header.version,
			opcode: header.opcode,
			payload: bytes.slice(start, end),
		},
		next: end,
	}
}

/** Every complete frame in a buffer. Throws if the buffer ends mid-frame. */
export function decodeFrames(bytes: Uint8Array): NetFrame[] {
	const frames: NetFrame[] = []
	let at = 0
	while (at < bytes.length) {
		const { frame, next } = decodeFrame(bytes, at)
		frames.push(frame)
		at = next
	}
	return frames
}

/**
 * Reassembles frames from arbitrarily chopped chunks. A websocket message is
 * normally one whole frame, but a proxy is free to split or coalesce them, and
 * a raw TCP transport always can, so the transport layer never assumes.
 */
export class FrameSplitter {
	private pending = new Uint8Array(0)

	get bufferedBytes(): number {
		return this.pending.length
	}

	reset(): void {
		this.pending = new Uint8Array(0)
	}

	push(chunk: Uint8Array): NetFrame[] {
		const buf = this.concat(chunk)
		const frames: NetFrame[] = []
		let at = 0
		for (;;) {
			if (buf.length - at < NET_HEADER_BYTES) break
			const header = readFrameHeader(buf, at)
			const end = at + NET_HEADER_BYTES + header.payloadLength
			if (end > buf.length) break
			frames.push({
				version: header.version,
				opcode: header.opcode,
				payload: buf.slice(at + NET_HEADER_BYTES, end),
			})
			at = end
		}
		this.pending = at === buf.length ? new Uint8Array(0) : buf.slice(at)
		if (this.pending.length > NET.maxMessageBytes + NET_HEADER_BYTES) {
			throw new Error('net: reassembly buffer overflow')
		}
		return frames
	}

	private concat(chunk: Uint8Array): Uint8Array {
		if (this.pending.length === 0) return chunk
		const merged = new Uint8Array(this.pending.length + chunk.length)
		merged.set(this.pending, 0)
		merged.set(chunk, this.pending.length)
		return merged
	}
}
