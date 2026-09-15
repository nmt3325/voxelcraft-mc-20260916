import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import {
	GAME_MODE,
	SAVE_VERSION,
	type GameSettings,
	type SaveMeta,
} from '@voxelcraft/core-types'
import { emptyChunkSnapshot, encodeChunk } from './chunkCodec'
import { createIndexedDbWorldStore } from './indexedDbStore'

function payload(cx: number, cz: number): Uint8Array {
	const snapshot = emptyChunkSnapshot(cx, cz)
	snapshot.blocks[0] = 1 + Math.abs(cx) * 3 + Math.abs(cz)
	return encodeChunk(snapshot)
}

function meta(worldId: string, name: string): SaveMeta {
	return {
		worldId,
		name,
		seed: 42,
		createdAt: 1_700_000_000_000,
		lastPlayedAt: 1_700_000_100_000,
		gameMode: GAME_MODE.Survival,
		saveVersion: SAVE_VERSION,
		generatorVersion: 1,
	}
}

describe('IndexedDB world store', () => {
	it('writes a whole chunk batch and reads it back', async () => {
		const store = await createIndexedDbWorldStore({ dbName: 'voxelcraft-test-chunks' })
		const entries: { cx: number; cz: number; data: Uint8Array }[] = []
		for (let i = 0; i < 40; i++) entries.push({ cx: i - 20, cz: 1, data: payload(i - 20, 1) })
		await store.putChunks('w1', entries)

		const keys = await store.listChunkKeys('w1')
		expect(keys.length).toBe(40)
		// Compound array keys keep negative coordinates in numeric order.
		expect(keys[0]).toEqual({ cx: -20, cz: 1 })
		expect(keys[39]).toEqual({ cx: 19, cz: 1 })

		const stored = await store.getChunk('w1', -20, 1)
		expect(stored).toBeDefined()
		expect([...(stored ?? new Uint8Array())]).toEqual([...payload(-20, 1)])
		expect(await store.getChunk('w1', 99, 99)).toBeUndefined()
		await store.close()
	})

	it('overwrites a chunk in place', async () => {
		const store = await createIndexedDbWorldStore({ dbName: 'voxelcraft-test-overwrite' })
		await store.putChunks('w1', [{ cx: 0, cz: 0, data: payload(0, 0) }])
		await store.putChunks('w1', [{ cx: 0, cz: 0, data: payload(4, 4) }])
		expect((await store.listChunkKeys('w1')).length).toBe(1)
		expect([...((await store.getChunk('w1', 0, 0)) ?? new Uint8Array())]).toEqual([
			...payload(4, 4),
		])
		await store.close()
	})

	it('keeps worlds apart and deletes one world whole', async () => {
		const store = await createIndexedDbWorldStore({ dbName: 'voxelcraft-test-meta' })
		await store.putMeta(meta('b', 'Beta'))
		await store.putMeta(meta('a', 'Alpha'))
		expect((await store.listWorlds()).map((entry) => entry.worldId)).toEqual(['a', 'b'])
		await store.putChunks('a', [{ cx: 0, cz: 0, data: payload(0, 0) }])
		await store.putChunks('b', [
			{ cx: 0, cz: 0, data: payload(0, 0) },
			{ cx: -1, cz: -1, data: payload(-1, -1) },
		])

		await store.deleteWorld('a')
		expect(await store.getMeta('a')).toBeUndefined()
		expect(await store.listChunkKeys('a')).toEqual([])
		expect((await store.listWorlds()).map((entry) => entry.worldId)).toEqual(['b'])
		expect((await store.listChunkKeys('b')).length).toBe(2)
		await store.close()
	})

	it('stores settings globally', async () => {
		const store = await createIndexedDbWorldStore({ dbName: 'voxelcraft-test-settings' })
		expect(await store.getSettings()).toBeUndefined()
		const settings: GameSettings = {
			renderDistance: 8,
			fov: 70,
			sensitivity: 0.5,
			volume: 0.8,
			showDebug: false,
		}
		await store.putSettings(settings)
		expect(await store.getSettings()).toEqual(settings)
		await store.close()
	})

	it('refuses to work after close', async () => {
		const store = await createIndexedDbWorldStore({ dbName: 'voxelcraft-test-closed' })
		await store.close()
		await expect(store.getChunk('w1', 0, 0)).rejects.toThrow(/closed/)
	})
})
