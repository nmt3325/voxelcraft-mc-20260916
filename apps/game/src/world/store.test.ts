/**
 * Persistence-side contract of the app's world: the real IndexedDB store from
 * `@voxelcraft/gameplay` (dbName `voxelcraft`, SAVE_VERSION 1, chunk key
 * worldId/cx/cz) plus the in-memory adapter used by unit tests. The reload
 * assertions mirror the E2E scenario: edit, save, reopen, identical state.
 */
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import {
	BLOCK,
	CHUNK_Y,
	GAME_MODE,
	PERSIST,
	SAVE_VERSION,
	WORLD_GEN_VERSION,
	type GameSettings,
	type PlayerSave,
} from '@voxelcraft/core-types'
import { createInventoryState, createMemoryWorldStore } from '@voxelcraft/gameplay'
import { ChunkWorld } from './chunkWorld'
import { createSaveMeta, indexedDbAvailable, openWorldPersistence } from './store'

const SEED = 1337

const SETTINGS: GameSettings = {
	renderDistance: 2,
	fov: 75,
	sensitivity: 0.0022,
	volume: 0.4,
	showDebug: true,
}

function playerSave(): PlayerSave {
	return {
		position: { x: 8.5, y: 70, z: 8.5 },
		yaw: 0.25,
		pitch: -0.1,
		health: 18,
		gameMode: GAME_MODE.Survival,
		inventory: createInventoryState(),
		respawn: null,
		tick: 42,
	}
}

function surfaceY(world: ChunkWorld, x: number, z: number): number {
	for (let y = CHUNK_Y - 1; y >= 0; y--) {
		if (world.blockAt(x, y, z) !== BLOCK.AIR) return y
	}
	return -1
}

/** A generated spawn chunk with one block broken and one block placed. */
function editedWorld(): { world: ChunkWorld; y: number } {
	const world = new ChunkWorld({ seed: SEED })
	world.ensureDecorated(0, 0)
	const y = surfaceY(world, 4, 4)
	expect(world.setBlock(4, y, 4, BLOCK.AIR)).toBe(true)
	expect(world.setBlock(4, y + 1, 4, BLOCK.GLASS)).toBe(true)
	return { world, y }
}

describe('world persistence', () => {
	it('saves to IndexedDB and reloads identical state', async () => {
		const worldId = 'idb-world'
		expect(indexedDbAvailable()).toBe(true)
		expect(PERSIST.dbName).toBe('voxelcraft')

		const first = await openWorldPersistence({ worldId })
		expect(first.backend).toBe('indexeddb')
		const { world, y } = editedWorld()
		const expectedHash = world.stateHash()
		await first.save({
			meta: createSaveMeta({ worldId, name: 'Saved world', seed: SEED }),
			player: playerSave(),
			settings: SETTINGS,
			chunks: world.savePayloads(),
		})
		await first.close()

		const second = await openWorldPersistence({ worldId })
		const meta = await second.loadMeta()
		expect(meta?.name).toBe('Saved world')
		expect(meta?.seed).toBe(SEED)
		expect(meta?.saveVersion).toBe(SAVE_VERSION)
		expect(meta?.generatorVersion).toBe(WORLD_GEN_VERSION)

		const keys = await second.chunkKeys()
		expect(keys.map((key) => `${key.cx},${key.cz}`)).toEqual(['0,0'])

		const restored = new ChunkWorld({
			seed: meta?.seed ?? 0,
			source: {
				has: (cx, cz) => keys.some((key) => key.cx === cx && key.cz === cz),
				load: (cx, cz) => second.loadChunk(cx, cz),
			},
		})
		await restored.restoreFromStore(0, 0)
		restored.stitchLight()
		expect(restored.hasTerrain(0, 0)).toBe(true)
		expect(restored.isModified(0, 0)).toBe(true)
		expect(restored.blockAt(4, y, 4)).toBe(BLOCK.AIR)
		expect(restored.blockAt(4, y + 1, 4)).toBe(BLOCK.GLASS)
		expect(restored.stateHash()).toBe(expectedHash)

		const player = await second.loadPlayer()
		expect(player?.tick).toBe(42)
		expect(player?.health).toBe(18)
		expect(player?.gameMode).toBe(GAME_MODE.Survival)
		expect(player?.position.x).toBeCloseTo(8.5)
		expect(await second.loadSettings()).toEqual(SETTINGS)
		expect((await second.listWorlds()).map((entry) => entry.worldId)).toContain(worldId)
		await second.close()
	})

	it('flushes queued chunks on the next save', async () => {
		const worldId = 'queued-world'
		const persistence = await openWorldPersistence({ worldId })
		const { world } = editedWorld()
		const payload = world.savePayloads()[0]
		persistence.queueChunk(3, -2, payload.data)
		await persistence.save({
			meta: createSaveMeta({ worldId, seed: SEED }),
			player: playerSave(),
			settings: SETTINGS,
			chunks: [],
		})
		const stored = await persistence.loadChunk(3, -2)
		expect(stored).toBeInstanceOf(Uint8Array)
		expect(stored?.byteLength).toBe(payload.data.byteLength)
		await persistence.close()
	})

	it('accepts an injected in-memory store and deletes worlds', async () => {
		const worldId = 'memory-world'
		const store = createMemoryWorldStore()
		const persistence = await openWorldPersistence({ worldId, store })
		expect(persistence.backend).toBe('injected')
		expect(persistence.worldId).toBe(worldId)

		const { world, y } = editedWorld()
		await persistence.save({
			meta: createSaveMeta({ worldId, seed: SEED }),
			player: playerSave(),
			settings: SETTINGS,
			chunks: world.savePayloads(),
		})
		expect((await persistence.listWorlds()).map((entry) => entry.worldId)).toEqual([worldId])

		const reopened = await openWorldPersistence({ worldId, store })
		const keys = await reopened.chunkKeys()
		const restored = new ChunkWorld({
			seed: SEED,
			source: {
				has: (cx, cz) => keys.some((key) => key.cx === cx && key.cz === cz),
				load: (cx, cz) => reopened.loadChunk(cx, cz),
			},
		})
		await restored.restoreFromStore(0, 0)
		expect(restored.blockAt(4, y + 1, 4)).toBe(BLOCK.GLASS)
		expect(restored.stateHash()).toBe(world.stateHash())

		await reopened.deleteWorld(worldId)
		expect(await reopened.listWorlds()).toEqual([])
		expect(await reopened.loadChunk(0, 0)).toBeUndefined()
		await reopened.close()
		await persistence.close()
	})
})
