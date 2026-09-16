import { BLOCK, sectionKey, type MesherResponse } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import {
	createEmptyPadded,
	createMeshRequest,
	fillPaddedLight,
	setPaddedBlock,
} from '../mesher/padded'
import { createMesherPool } from '../worker/pool'
import {
	collectTransferables,
	createMesherWorkerState,
	handleMesherMessage,
} from '../worker/protocol'

type MesherMessage = Parameters<typeof handleMesherMessage>[1]

function request(revision: number, fill?: (blocks: Uint16Array) => void) {
	const padded = createEmptyPadded()
	fillPaddedLight(padded.light, 15, 0)
	if (fill) fill(padded.blocks)
	return createMeshRequest({
		key: sectionKey(1, 2, 3),
		cx: 1,
		cz: 3,
		sy: 2,
		revision,
		padded,
	})
}

const oneStone = (blocks: Uint16Array): void => {
	setPaddedBlock(blocks, 1, 1, 1, BLOCK.STONE)
}

/**
 * In-process stand-in for a real Worker, so the pool's worker path and its
 * telemetry can be covered without a bundler or a browser.
 */
class FakeMesherWorker {
	onmessage: ((event: MessageEvent) => void) | null = null
	onerror: ((event: unknown) => void) | null = null
	terminated = false
	private readonly state = createMesherWorkerState()

	postMessage(message: MesherMessage): void {
		const response = handleMesherMessage(this.state, message)
		if (response === null) return
		queueMicrotask(() => {
			this.onmessage?.({ data: response } as unknown as MessageEvent)
		})
	}

	terminate(): void {
		this.terminated = true
	}
}

describe('mesher worker protocol', () => {
	it('meshes a request and exposes transferable buffers', () => {
		const state = createMesherWorkerState()
		const response = handleMesherMessage(state, { type: 'mesh', request: request(1, oneStone) })
		expect(response?.type).toBe('mesh')
		if (response?.type !== 'mesh') throw new Error('expected a mesh response')
		expect(response.result.revision).toBe(1)
		expect(collectTransferables(response.result)).toHaveLength(2)
	})

	it('skips empty sections', () => {
		const state = createMesherWorkerState()
		const response = handleMesherMessage(state, { type: 'mesh', request: request(1) })
		expect(response).toEqual({ type: 'skipped', key: sectionKey(1, 2, 3), reason: 'empty' })
	})

	it('honours cancellation', () => {
		const state = createMesherWorkerState()
		expect(handleMesherMessage(state, { type: 'cancel', key: sectionKey(1, 2, 3) })).toBeNull()
		const response = handleMesherMessage(state, { type: 'mesh', request: request(2, oneStone) })
		expect(response).toEqual({ type: 'skipped', key: sectionKey(1, 2, 3), reason: 'cancelled' })
	})

	it('drops stale revisions', () => {
		const state = createMesherWorkerState()
		expect(handleMesherMessage(state, { type: 'mesh', request: request(5, oneStone) })?.type).toBe(
			'mesh',
		)
		const stale = handleMesherMessage(state, { type: 'mesh', request: request(4, oneStone) })
		expect(stale?.type).toBe('skipped')
		expect(handleMesherMessage(state, { type: 'mesh', request: request(6, oneStone) })?.type).toBe(
			'mesh',
		)
	})
})

describe('mesher pool', () => {
	it('falls back to inline meshing without workers', async () => {
		const pool = createMesherPool({ inline: true })
		expect(pool.stats().inline).toBe(true)
		expect(pool.stats().workers).toBe(0)

		const response = await new Promise<MesherResponse>((resolve) => {
			pool.request(request(1, oneStone), resolve)
		})
		expect(response.type).toBe('mesh')
		const stats = pool.stats()
		expect(stats.meshed).toBe(1)
		expect(stats.pending).toBe(0)
		expect(stats.requested).toBe(1)
		// The counters have to name the main thread as the source of this mesh.
		expect(stats.inlineMeshed).toBe(1)
		expect(stats.workerMeshed).toBe(0)
		pool.dispose()
	})

	it('reports cancellation through the pool', async () => {
		const pool = createMesherPool({ inline: true })
		const key = sectionKey(1, 2, 3)
		pool.cancel(key)
		const response = await new Promise<MesherResponse>((resolve) => {
			pool.request(request(2, oneStone), resolve)
		})
		expect(response).toEqual({ type: 'skipped', key, reason: 'cancelled' })
		expect(pool.stats().skipped).toBe(1)
		pool.dispose()
	})

	it('counts worker meshing apart from the inline fallback', async () => {
		const fakes: FakeMesherWorker[] = []
		const pool = createMesherPool({
			workerCount: 2,
			createWorker: () => {
				const fake = new FakeMesherWorker()
				fakes.push(fake)
				return fake as unknown as Worker
			},
		})
		expect(pool.stats().workers).toBe(2)
		expect(pool.stats().inline).toBe(false)

		const response = await new Promise<MesherResponse>((resolve) => {
			pool.request(request(1, oneStone), resolve)
		})
		expect(response.type).toBe('mesh')
		const stats = pool.stats()
		expect(stats.meshed).toBe(1)
		expect(stats.workerMeshed).toBe(1)
		expect(stats.inlineMeshed).toBe(0)
		expect(stats.errors).toBe(0)
		expect(stats.pending).toBe(0)

		pool.dispose()
		expect(fakes).toHaveLength(2)
		expect(fakes.every((fake) => fake.terminated)).toBe(true)
	})
})
