/**
 * Flat FIFO of light BFS records, backed by one growable `Int32Array`.
 *
 * The engine used to queue records by pushing four or five numbers onto a
 * `number[]`. At H-05 scale that is the single biggest allocator in the light
 * path: a 225 chunk stitch pass queued millions of records, and a JS array of
 * doubles costs 8 bytes per slot plus repeated backing store reallocation.
 *
 * Every record is five int32 slots, `x, y, z, level, face`:
 *  - re-propagation records only use `face`, the cursor that lets `step` resume
 *    a half-processed voxel at the same neighbour on the next tick,
 *  - removal records also carry `level`, the brightness that used to be there.
 *
 * `peek` loads the head record into fields without consuming it, which is what
 * makes budget suspension expressible: overwrite the cursor with `setFace` and
 * stop, and the next `step` resumes exactly where this one stopped.
 */
const SLOTS = 5
const DEFAULT_RECORDS = 1024

export class LightQueue {
	private data: Int32Array
	/** Record index of the next record to read. */
	private head = 0
	/** Record index one past the last written record. */
	private tail = 0

	/** Fields of the record loaded by the last `peek`. */
	x = 0
	y = 0
	z = 0
	/** Brightness that used to be at this voxel. Removal records only. */
	level = 0
	/** Neighbour cursor, 0..6. */
	face = 0

	constructor(records: number = DEFAULT_RECORDS) {
		this.data = new Int32Array(Math.max(1, records) * SLOTS)
	}

	get size(): number {
		return this.tail - this.head
	}

	get isEmpty(): boolean {
		return this.head >= this.tail
	}

	/** Records that fit without growing. */
	get capacity(): number {
		return (this.data.length / SLOTS) | 0
	}

	clear(): void {
		this.head = 0
		this.tail = 0
	}

	/** Queues a re-propagation source. */
	pushAdd(x: number, y: number, z: number): void {
		this.push(x, y, z, 0)
	}

	/** Queues a removal, carrying the brightness being removed. */
	pushRemove(x: number, y: number, z: number, level: number): void {
		this.push(x, y, z, level)
	}

	/** Loads the head record into the fields. False when the queue is empty. */
	peek(): boolean {
		if (this.head >= this.tail) return false
		const at = this.head * SLOTS
		const data = this.data
		this.x = data[at]
		this.y = data[at + 1]
		this.z = data[at + 2]
		this.level = data[at + 3]
		this.face = data[at + 4]
		return true
	}

	/**
	 * Overwrites the head record's neighbour cursor, so a voxel suspended on a
	 * spent budget resumes at the same face instead of redoing earlier faces.
	 */
	setFace(face: number): void {
		if (this.head >= this.tail) return
		this.data[this.head * SLOTS + 4] = face
	}

	/** Consumes the head record. */
	advance(): void {
		this.head++
		if (this.head >= this.tail) {
			this.head = 0
			this.tail = 0
		}
	}

	private push(x: number, y: number, z: number, level: number): void {
		if (this.tail === this.capacity) this.reserve()
		const at = this.tail * SLOTS
		const data = this.data
		data[at] = x
		data[at + 1] = y
		data[at + 2] = z
		data[at + 3] = level
		data[at + 4] = 0
		this.tail++
	}

	/**
	 * Reclaims the consumed prefix first, and only doubles when the live records
	 * really do fill the buffer. A BFS drains as it pushes, so in practice this
	 * keeps the buffer at the high water mark of *live* records rather than of
	 * total records ever queued.
	 */
	private reserve(): void {
		if (this.head > 0) {
			this.data.copyWithin(0, this.head * SLOTS, this.tail * SLOTS)
			this.tail -= this.head
			this.head = 0
			if (this.tail < this.capacity) return
		}
		const grown = new Int32Array(this.data.length * 2)
		grown.set(this.data)
		this.data = grown
	}
}
