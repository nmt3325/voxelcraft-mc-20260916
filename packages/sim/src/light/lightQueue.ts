/**
 * Typed-array FIFO used by the light BFS.
 *
 * The first implementation pushed four numbers per record onto a plain
 * `number[]` and walked it with a read index. Seeding a 15x15 chunk world
 * enqueues millions of records, and in the H-05 profile the array growth plus
 * the boxed element writes were the single largest cost of `stitchBoundaries`.
 *
 * This queue stores the same four fields in a growable `Int32Array`, reuses the
 * backing buffer across chunks, and compacts the consumed prefix before it ever
 * reallocates. `shift()` writes the popped record into plain instance fields so
 * a drain loop touches no objects at all.
 *
 * The fourth field is the traversal face for spread queues and the removed
 * light level for removal queues; both users are in this package.
 */

/** Numbers per queued record: x, y, z, arg. */
const SLOTS = 4

/** Records reserved up front. One chunk seed frontier fits comfortably. */
const DEFAULT_RECORDS = 1024

export class LightQueue {
	/** Packed records, `SLOTS` numbers each. */
	private buffer: Int32Array
	/** Read cursor, in numbers. */
	private readAt = 0
	/** Write cursor, in numbers. */
	private writeAt = 0

	/** X of the record last returned by `shift()`. */
	x = 0
	/** Y of the record last returned by `shift()`. */
	y = 0
	/** Z of the record last returned by `shift()`. */
	z = 0
	/** Face (spread queues) or removed level (removal queues) of that record. */
	arg = 0

	constructor(capacityRecords: number = DEFAULT_RECORDS) {
		const records = capacityRecords > 0 ? capacityRecords : DEFAULT_RECORDS
		this.buffer = new Int32Array(records * SLOTS)
	}

	/** Records still waiting to be read. */
	get size(): number {
		return (this.writeAt - this.readAt) / SLOTS
	}

	get isEmpty(): boolean {
		return this.readAt >= this.writeAt
	}

	/** Records the buffer can hold without growing. Only used by tests. */
	get capacity(): number {
		return this.buffer.length / SLOTS
	}

	/** Drops every pending record and rewinds both cursors. Keeps the buffer. */
	clear(): void {
		this.readAt = 0
		this.writeAt = 0
	}

	push(x: number, y: number, z: number, arg: number): void {
		if (this.writeAt + SLOTS > this.buffer.length) this.reserve()
		const buffer = this.buffer
		let at = this.writeAt
		buffer[at++] = x
		buffer[at++] = y
		buffer[at++] = z
		buffer[at++] = arg
		this.writeAt = at
	}

	/**
	 * Pops the oldest record into `x` / `y` / `z` / `arg`.
	 * Returns `false` when the queue is empty, leaving the fields untouched.
	 */
	shift(): boolean {
		const at = this.readAt
		if (at >= this.writeAt) return false
		const buffer = this.buffer
		this.x = buffer[at]
		this.y = buffer[at + 1]
		this.z = buffer[at + 2]
		this.arg = buffer[at + 3]
		this.readAt = at + SLOTS
		return true
	}

	/**
	 * Makes room for at least one more record.
	 *
	 * A drain walks the buffer front to back, so the consumed prefix is normally
	 * the bulk of it: compacting is enough and no allocation happens. Only a
	 * queue that really is more than half live doubles.
	 */
	private reserve(): void {
		const live = this.writeAt - this.readAt
		if (this.readAt > 0 && live + SLOTS <= this.buffer.length) {
			this.buffer.copyWithin(0, this.readAt, this.writeAt)
			this.readAt = 0
			this.writeAt = live
			return
		}
		const next = new Int32Array(this.buffer.length * 2)
		next.set(this.buffer.subarray(this.readAt, this.writeAt))
		this.buffer = next
		this.readAt = 0
		this.writeAt = live
	}
}
