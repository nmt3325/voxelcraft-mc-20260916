import type { MeshResult, MesherMessage, MesherResponse } from '@voxelcraft/core-types'
import { meshSection } from '../mesher/greedy'

/**
 * Transport-free half of the worker protocol.
 *
 * Keeping the message handling pure means the revision/cancel logic can be unit
 * tested in Node without spawning a Worker, and the worker entry file stays a
 * three line adapter.
 */

export interface MesherWorkerState {
	/** Keys cancelled before their mesh request was processed. */
	readonly cancelled: Set<string>
	/** Highest revision seen per section key. */
	readonly revisions: Map<string, number>
}

export function createMesherWorkerState(): MesherWorkerState {
	return { cancelled: new Set<string>(), revisions: new Map<string, number>() }
}

/** ArrayBuffers that can be transferred instead of copied back to the host. */
export function collectTransferables(result: MeshResult): ArrayBuffer[] {
	const transferables: ArrayBuffer[] = []
	for (const buffer of result.buffers) {
		transferables.push(buffer.interleaved)
		transferables.push(buffer.index)
	}
	return transferables
}

export function handleMesherMessage(
	state: MesherWorkerState,
	message: MesherMessage,
): MesherResponse | null {
	if (message.type === 'cancel') {
		state.cancelled.add(message.key)
		state.revisions.delete(message.key)
		return null
	}

	const request = message.request
	const key = request.key

	if (state.cancelled.has(key)) {
		state.cancelled.delete(key)
		return { type: 'skipped', key, reason: 'cancelled' }
	}

	const latest = state.revisions.get(key)
	if (latest !== undefined && request.revision < latest) {
		// A newer revision of this section was already meshed; drop the stale one.
		return { type: 'skipped', key, reason: 'cancelled' }
	}
	state.revisions.set(key, request.revision)

	try {
		const result = meshSection(request)
		if (result.buffers.length === 0) return { type: 'skipped', key, reason: 'empty' }
		return { type: 'mesh', result }
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)
		return { type: 'error', key, message: reason }
	}
}
