import {
	PERF,
	type MeshRequest,
	type MesherMessage,
	type MesherResponse,
} from '@voxelcraft/core-types'
import { createMesherWorkerState, handleMesherMessage } from './protocol'

/**
 * Mesher worker pool.
 *
 * - `new Worker(new URL('./mesher.worker.ts', import.meta.url), { type: 'module' })`
 *   is written statically so the bundler can emit the worker chunk.
 * - Falls back to inline meshing when `Worker` is unavailable (Node, tests) or
 *   when construction throws, so the renderer never has a hard worker
 *   dependency.
 * - `SharedArrayBuffer` is never required; it is only considered when the page
 *   happens to be cross-origin isolated.
 * - Request buffers are transferred, so callers must hand over freshly allocated
 *   padded arrays (see `createEmptyPadded`).
 * - `stats()` counts worker results and inline results separately, so a caller
 *   (and the E2E suite) can tell a real worker run from a silent fallback to
 *   main-thread meshing.
 */

export type MesherResponseHandler = (response: MesherResponse) => void

export interface MesherPoolOptions {
	workerCount?: number
	/** Force the inline path (used by tests, benchmarks and Node). */
	inline?: boolean
	createWorker?: () => Worker
}

export interface MesherPoolStats {
	/** Live workers owned by the pool. Zero means everything is meshed inline. */
	workers: number
	/** True while the pool has no worker and meshes on the calling thread. */
	inline: boolean
	pending: number
	meshed: number
	skipped: number
	errors: number
	/** Mesh requests accepted by the pool. */
	requested: number
	/** Accepted mesh results that were produced on the calling thread. */
	inlineMeshed: number
	/** Accepted mesh results that were produced inside a worker. */
	workerMeshed: number
}

export interface MesherPool {
	request(request: MeshRequest, onResponse: MesherResponseHandler): void
	cancel(key: string): void
	stats(): MesherPoolStats
	dispose(): void
}

/** The mesh variant carries its key on the result, the others carry it directly. */
export function responseKey(response: MesherResponse): string {
	return response.type === 'mesh' ? response.result.key : response.key
}

export function canUseSharedMemory(): boolean {
	const scope = globalThis as { crossOriginIsolated?: boolean }
	return typeof SharedArrayBuffer !== 'undefined' && scope.crossOriginIsolated === true
}

function defaultCreateWorker(): Worker {
	return new Worker(new URL('./mesher.worker.ts', import.meta.url), { type: 'module' })
}

interface WorkerSlot {
	worker: Worker
	inflight: number
}

/** Thread a settled response was meshed on. */
type MeshSource = 'worker' | 'inline'

export function createMesherPool(options: MesherPoolOptions = {}): MesherPool {
	const handlers = new Map<string, MesherResponseHandler>()
	const latestRevision = new Map<string, number>()
	const inlineState = createMesherWorkerState()
	const slots: WorkerSlot[] = []
	let requested = 0
	let meshed = 0
	let inlineMeshed = 0
	let workerMeshed = 0
	let skipped = 0
	let errors = 0
	let disposed = false

	const settle = (response: MesherResponse, source: MeshSource): void => {
		const key = responseKey(response)
		if (response.type === 'mesh') {
			const latest = latestRevision.get(key)
			if (latest !== undefined && response.result.revision < latest) {
				skipped++
				return
			}
			meshed++
			if (source === 'inline') inlineMeshed++
			else workerMeshed++
		} else if (response.type === 'error') {
			errors++
		} else {
			skipped++
		}
		const handler = handlers.get(key)
		handlers.delete(key)
		if (handler !== undefined) handler(response)
	}

	if (options.inline !== true) {
		const create = options.createWorker ?? defaultCreateWorker
		const available = options.createWorker !== undefined || typeof Worker !== 'undefined'
		const desired = Math.max(
			1,
			Math.min(options.workerCount ?? Math.min(PERF.workerCountMax, 4), PERF.workerCountMax),
		)
		if (available) {
			for (let i = 0; i < desired; i++) {
				try {
					const slot: WorkerSlot = { worker: create(), inflight: 0 }
					slot.worker.onmessage = (event: MessageEvent): void => {
						slot.inflight = Math.max(0, slot.inflight - 1)
						settle(event.data as MesherResponse, 'worker')
					}
					slot.worker.onerror = (): void => {
						slot.inflight = 0
						errors++
					}
					slots.push(slot)
				} catch {
					break
				}
			}
		}
	}

	const transferablesOf = (request: MeshRequest): ArrayBuffer[] => {
		const transfer: ArrayBuffer[] = []
		for (const view of [request.blocks, request.light, request.fluids]) {
			const buffer = view.buffer
			if (buffer instanceof ArrayBuffer && !transfer.includes(buffer)) transfer.push(buffer)
		}
		return transfer
	}

	return {
		request(request: MeshRequest, onResponse: MesherResponseHandler): void {
			if (disposed) return
			requested++
			handlers.set(request.key, onResponse)
			latestRevision.set(request.key, request.revision)
			const message: MesherMessage = { type: 'mesh', request }
			if (slots.length === 0) {
				const response = handleMesherMessage(inlineState, message)
				// Report asynchronously so callers see the same ordering either way.
				queueMicrotask(() => {
					if (response !== null && !disposed) settle(response, 'inline')
				})
				return
			}
			let target = slots[0]
			for (const slot of slots) {
				if (slot.inflight < target.inflight) target = slot
			}
			target.inflight++
			target.worker.postMessage(message, transferablesOf(request))
		},
		cancel(key: string): void {
			handlers.delete(key)
			latestRevision.delete(key)
			const message: MesherMessage = { type: 'cancel', key }
			if (slots.length === 0) {
				handleMesherMessage(inlineState, message)
				return
			}
			for (const slot of slots) slot.worker.postMessage(message)
		},
		stats(): MesherPoolStats {
			return {
				workers: slots.length,
				inline: slots.length === 0,
				pending: handlers.size,
				meshed,
				skipped,
				errors,
				requested,
				inlineMeshed,
				workerMeshed,
			}
		},
		dispose(): void {
			disposed = true
			for (const slot of slots) slot.worker.terminate()
			slots.length = 0
			handlers.clear()
			latestRevision.clear()
		},
	}
}
