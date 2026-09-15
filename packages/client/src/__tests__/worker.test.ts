import { BLOCK, sectionKey, type MesherResponse } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import {
	createEmptyPadded,
	createMeshRequest,
	fillPaddedLight,
	setPaddedBlock,
} from '../mesher/padded'
import { createMesherPool } from '../worker/pool'
import { collectTransferables, createMesherWorkerState, handleMesherMessage } from '../worker/protocol'

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

		const response = await new Promise<MesherResponse>((resolve) => {
			pool.request(request(1, oneStone), resolve)
		})
		expect(response.type).toBe('mesh')
		expect(pool.stats().meshed).toBe(1)
		expect(pool.stats().pending).toBe(0)
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
})
