import { PERSIST, type WorldStore } from '@voxelcraft/core-types'
import { copyBytes } from './support'

/**
 * Chunk write batching: a flush happens once `PERSIST.writeBatchChunks` chunks
 * are pending, or `PERSIST.writeIntervalMs` after the oldest pending chunk,
 * whichever comes first. Repeated writes to the same chunk collapse, so a
 * hot-edited chunk is only stored once per batch.
 *
 * The timer is injectable so tests can drive it without wall-clock waits.
 */

export interface WriteTimer {
	set(callback: () => void, ms: number): unknown
	clear(handle: unknown): void
}

export const DEFAULT_WRITE_TIMER: WriteTimer = {
	set: (callback, ms) => setTimeout(callback, ms) as unknown,
	clear: (handle) => {
		clearTimeout(handle as Parameters<typeof clearTimeout>[0])
	},
}

export interface ChunkWriteQueueOptions {
	/** Flush once this many chunks are pending. Defaults to `PERSIST.writeBatchChunks`. */
	batchChunks?: number
	/** Flush this long after the oldest pending chunk. Defaults to `PERSIST.writeIntervalMs`. */
	intervalMs?: number
	timer?: WriteTimer
	/** Called when a timer-triggered flush fails; manual flushes reject instead. */
	onError?: (error: unknown) => void
}

export interface ChunkWriteQueue {
	/** Chunks waiting for the next flush. */
	readonly pending: number
	/** Size of every batch handed to `putChunks`, oldest first. */
	readonly batches: readonly number[]
	readonly lastError: unknown
	queue(cx: number, cz: number, data: Uint8Array): void
	flush(): Promise<void>
	close(): Promise<void>
}

interface PendingChunk {
	cx: number
	cz: number
	data: Uint8Array
}

export function createChunkWriteQueue(
	store: WorldStore,
	worldId: string,
	options: ChunkWriteQueueOptions = {},
): ChunkWriteQueue {
	const batchChunks = Math.max(1, options.batchChunks ?? PERSIST.writeBatchChunks)
	const intervalMs = Math.max(0, options.intervalMs ?? PERSIST.writeIntervalMs)
	const timer = options.timer ?? DEFAULT_WRITE_TIMER
	const pending = new Map<string, PendingChunk>()
	const batches: number[] = []
	let handle: unknown = null
	let chain: Promise<void> = Promise.resolve()
	let lastError: unknown = null
	let closed = false

	const cancelTimer = (): void => {
		if (handle === null) return
		timer.clear(handle)
		handle = null
	}

	const flushOnce = async (): Promise<void> => {
		if (pending.size === 0) return
		const entries = [...pending.values()]
		pending.clear()
		batches.push(entries.length)
		await store.putChunks(worldId, entries)
	}

	const runFlush = (): Promise<void> => {
		cancelTimer()
		const result = chain.then(flushOnce)
		chain = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}

	const flushInBackground = (): void => {
		void runFlush().catch((error: unknown) => {
			lastError = error
			options.onError?.(error)
		})
	}

	return {
		get pending(): number {
			return pending.size
		},
		get batches(): readonly number[] {
			return batches
		},
		get lastError(): unknown {
			return lastError
		},

		queue(cx: number, cz: number, data: Uint8Array): void {
			if (closed) throw new Error('chunk write queue is closed')
			pending.set(`${cx},${cz}`, { cx, cz, data: copyBytes(data) })
			if (pending.size >= batchChunks) {
				flushInBackground()
				return
			}
			if (handle === null) {
				handle = timer.set(() => {
					handle = null
					flushInBackground()
				}, intervalMs)
			}
		},

		flush(): Promise<void> {
			return runFlush()
		},

		async close(): Promise<void> {
			cancelTimer()
			await runFlush()
			closed = true
		},
	}
}
