/**
 * Little-endian byte cursors shared by the chunk codec and the stores.
 *
 * The chunk layout is frozen (see `core-types/chunk.ts`), so reads and writes
 * are explicit about width and endianness instead of relying on typed-array
 * platform order.
 */

export class ByteWriter {
	private data: Uint8Array
	private view: DataView
	private length = 0

	constructor(capacity = 1024) {
		this.data = new Uint8Array(Math.max(16, capacity))
		this.view = new DataView(this.data.buffer)
	}

	get size(): number {
		return this.length
	}

	private reserve(extra: number): void {
		const needed = this.length + extra
		if (needed <= this.data.length) return
		let capacity = this.data.length * 2
		while (capacity < needed) capacity *= 2
		const grown = new Uint8Array(capacity)
		grown.set(this.data.subarray(0, this.length))
		this.data = grown
		this.view = new DataView(grown.buffer)
	}

	u8(value: number): void {
		this.reserve(1)
		this.view.setUint8(this.length, value & 0xff)
		this.length += 1
	}

	u16(value: number): void {
		this.reserve(2)
		this.view.setUint16(this.length, value & 0xffff, true)
		this.length += 2
	}

	u32(value: number): void {
		this.reserve(4)
		this.view.setUint32(this.length, value >>> 0, true)
		this.length += 4
	}

	raw(source: Uint8Array): void {
		this.reserve(source.length)
		this.data.set(source, this.length)
		this.length += source.length
	}

	/** Copy of the bytes written so far. */
	toBytes(): Uint8Array {
		return this.data.slice(0, this.length)
	}
}

export class ByteReader {
	private readonly data: Uint8Array
	private readonly view: DataView
	private offset = 0

	constructor(data: Uint8Array) {
		this.data = data
		this.view = new DataView(data.buffer, data.byteOffset, data.byteLength)
	}

	get position(): number {
		return this.offset
	}

	get remaining(): number {
		return this.data.byteLength - this.offset
	}

	private require(bytes: number): void {
		if (bytes < 0 || this.offset + bytes > this.data.byteLength) {
			throw new Error(
				`unexpected end of payload: wanted ${bytes} byte(s) at ${this.offset} of ${this.data.byteLength}`,
			)
		}
	}

	skip(bytes: number): void {
		this.require(bytes)
		this.offset += bytes
	}

	u8(): number {
		this.require(1)
		const value = this.view.getUint8(this.offset)
		this.offset += 1
		return value
	}

	u16(): number {
		this.require(2)
		const value = this.view.getUint16(this.offset, true)
		this.offset += 2
		return value
	}

	u32(): number {
		this.require(4)
		const value = this.view.getUint32(this.offset, true)
		this.offset += 4
		return value
	}

	/** View over the next `length` bytes. Never outlives the source buffer. */
	raw(length: number): Uint8Array {
		this.require(length)
		const slice = this.data.subarray(this.offset, this.offset + length)
		this.offset += length
		return slice
	}
}
