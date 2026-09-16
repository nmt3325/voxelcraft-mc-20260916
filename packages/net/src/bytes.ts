/**
 * Little-endian byte primitives. Every message codec in this package builds on
 * these two classes so that offsets, growth and bounds checks live in one place
 * instead of being re-derived per opcode.
 *
 * Reads never return garbage: a short buffer throws instead of producing a
 * silently wrong value, which is what lets the server answer a malformed frame
 * with NET_KICK_REASON.BadMessage.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

/** Longest string any message may carry, in UTF-8 bytes. Fits the u16 prefix. */
export const MAX_STRING_BYTES = 0xffff

export class ByteWriter {
	private buf: Uint8Array
	private view: DataView
	private pos = 0

	constructor(capacity = 128) {
		this.buf = new Uint8Array(Math.max(16, capacity))
		this.view = new DataView(this.buf.buffer)
	}

	get length(): number {
		return this.pos
	}

	private ensure(extra: number): void {
		const need = this.pos + extra
		if (need <= this.buf.length) return
		let next = this.buf.length * 2
		while (next < need) next *= 2
		const grown = new Uint8Array(next)
		grown.set(this.buf.subarray(0, this.pos))
		this.buf = grown
		this.view = new DataView(grown.buffer)
	}

	u8(value: number): this {
		this.ensure(1)
		this.view.setUint8(this.pos, value & 0xff)
		this.pos += 1
		return this
	}

	u16(value: number): this {
		this.ensure(2)
		this.view.setUint16(this.pos, value & 0xffff, true)
		this.pos += 2
		return this
	}

	i16(value: number): this {
		this.ensure(2)
		this.view.setInt16(this.pos, value, true)
		this.pos += 2
		return this
	}

	u32(value: number): this {
		this.ensure(4)
		this.view.setUint32(this.pos, value >>> 0, true)
		this.pos += 4
		return this
	}

	i32(value: number): this {
		this.ensure(4)
		this.view.setInt32(this.pos, value | 0, true)
		this.pos += 4
		return this
	}

	f32(value: number): this {
		this.ensure(4)
		this.view.setFloat32(this.pos, value, true)
		this.pos += 4
		return this
	}

	f64(value: number): this {
		this.ensure(8)
		this.view.setFloat64(this.pos, value, true)
		this.pos += 8
		return this
	}

	bool(value: boolean): this {
		return this.u8(value ? 1 : 0)
	}

	/** Raw bytes, no length prefix. */
	bytes(src: Uint8Array): this {
		this.ensure(src.length)
		this.buf.set(src, this.pos)
		this.pos += src.length
		return this
	}

	/** u32 length prefix followed by the bytes. Used for chunk payloads. */
	blob(src: Uint8Array): this {
		this.u32(src.length)
		return this.bytes(src)
	}

	/** u16 byte-length prefix followed by UTF-8. */
	str(value: string): this {
		const utf8 = encoder.encode(value)
		if (utf8.length > MAX_STRING_BYTES) {
			throw new Error(`net: string too long: ${utf8.length} bytes`)
		}
		this.u16(utf8.length)
		return this.bytes(utf8)
	}

	/** Copy of the written region. The writer stays usable afterwards. */
	finish(): Uint8Array {
		return this.buf.slice(0, this.pos)
	}
}

export class ByteReader {
	private readonly view: DataView
	private readonly src: Uint8Array
	private pos: number
	private readonly end: number

	constructor(src: Uint8Array, offset = 0, length = src.length - offset) {
		if (offset < 0 || length < 0 || offset + length > src.length) {
			throw new Error('net: reader window out of range')
		}
		this.src = src
		this.view = new DataView(src.buffer, src.byteOffset, src.length)
		this.pos = offset
		this.end = offset + length
	}

	get offset(): number {
		return this.pos
	}

	get remaining(): number {
		return this.end - this.pos
	}

	private take(n: number): number {
		if (this.pos + n > this.end) throw new Error('net: truncated payload')
		const at = this.pos
		this.pos += n
		return at
	}

	u8(): number {
		return this.view.getUint8(this.take(1))
	}

	u16(): number {
		return this.view.getUint16(this.take(2), true)
	}

	i16(): number {
		return this.view.getInt16(this.take(2), true)
	}

	u32(): number {
		return this.view.getUint32(this.take(4), true)
	}

	i32(): number {
		return this.view.getInt32(this.take(4), true)
	}

	f32(): number {
		return this.view.getFloat32(this.take(4), true)
	}

	f64(): number {
		return this.view.getFloat64(this.take(8), true)
	}

	bool(): boolean {
		return this.u8() !== 0
	}

	/** Copy of the next n bytes. */
	bytes(n: number): Uint8Array {
		const at = this.take(n)
		return this.src.slice(at, at + n)
	}

	/** u32 length prefix followed by that many bytes. */
	blob(): Uint8Array {
		return this.bytes(this.u32())
	}

	str(): string {
		const n = this.u16()
		const at = this.take(n)
		return decoder.decode(this.src.subarray(at, at + n))
	}

	/** Throws when the payload is longer than the decoder consumed. */
	requireEnd(): void {
		if (this.remaining !== 0) {
			throw new Error(`net: ${this.remaining} trailing bytes in payload`)
		}
	}
}
