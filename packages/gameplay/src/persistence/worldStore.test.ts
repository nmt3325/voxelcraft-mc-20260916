import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
	GAME_MODE,
	INVENTORY,
	ITEM,
	PERSIST,
	SAVE_VERSION,
	type GameSettings,
	type InventoryState,
	type ItemStack,
	type PlayerSave,
	type SaveMeta,
} from '@voxelcraft/core-types'
import { emptyChunkSnapshot, encodeChunk } from './chunkCodec'
import { createFsWorldStore } from './fsStore'
import { createMemoryWorldStore } from './memoryStore'
import { createChunkWriteQueue, type WriteTimer } from './writeQueue'

/** A compressible but non-trivial chunk payload. */
function payload(seed: number): Uint8Array {
	const snapshot = emptyChunkSnapshot()
	for (let i = 0; i < 4096; i++) snapshot.blocks[i] = (i + seed) % 8 === 0 ? 1 : 2
	return encodeChunk(snapshot)
}

function meta(worldId: string, name: string): SaveMeta {
	return {
		worldId,
		name,
		seed: 1234,
		createdAt: 1_700_000_000_000,
		lastPlayedAt: 1_700_000_500_000,
		gameMode: GAME_MODE.Survival,
		saveVersion: SAVE_VERSION,
		generatorVersion: 1,
	}
}

function inventory(): InventoryState {
	const stack: ItemStack = { item: ITEM.STICK, count: 3, damage: 0 }
	const slots: (ItemStack | null)[] = Array.from({ length: INVENTORY.totalSlots }, () => null)
	slots[0] = stack
	return { slots, selectedHotbar: 2, cursor: null, crafting: [null, null, null, null] }
}

function player(respawn: PlayerSave['respawn']): PlayerSave {
	return {
		position: { x: 1.5, y: 70.25, z: -3.75 },
		yaw: 1.25,
		pitch: -0.5,
		health: 18,
		gameMode: GAME_MODE.Survival,
		inventory: inventory(),
		respawn,
		tick: 4321,
	}
}

const SETTINGS: GameSettings = {
	renderDistance: 10,
	fov: 75,
	sensitivity: 0.4,
	volume: 0.6,
	showDebug: true,
}

describe('memory world store', () => {
	it('round-trips chunks through deflate by default', async () => {
		const store = createMemoryWorldStore()
		const bytes = payload(0)
		await store.putChunks('w1', [{ cx: 0, cz: 0, data: bytes }])

		expect(store.compressed).toBe(true)
		const raw = store.rawChunk('w1', 0, 0)
		expect(raw).toBeDefined()
		expect((raw ?? bytes).length).toBeLessThan(bytes.length)
		expect([...((await store.getChunk('w1', 0, 0)) ?? new Uint8Array())]).toEqual([...bytes])
		expect(await store.getChunk('w1', 1, 0)).toBeUndefined()
		await store.close()
	})

	it('can store chunks uncompressed', async () => {
		const store = createMemoryWorldStore({ compress: false })
		const bytes = payload(1)
		await store.putChunks('w1', [{ cx: -2, cz: 7, data: bytes }])
		expect(store.compressed).toBe(false)
		expect([...(store.rawChunk('w1', -2, 7) ?? new Uint8Array())]).toEqual([...bytes])
		expect([...((await store.getChunk('w1', -2, 7)) ?? new Uint8Array())]).toEqual([...bytes])
		await store.close()
	})

	it('keeps negative chunk coordinates ordered', async () => {
		const store = createMemoryWorldStore({ compress: false })
		await store.putChunks('w1', [
			{ cx: 3, cz: -5, data: payload(2) },
			{ cx: -1, cz: 2, data: payload(3) },
			{ cx: 0, cz: 0, data: payload(4) },
			{ cx: -1, cz: -1, data: payload(5) },
		])
		expect(await store.listChunkKeys('w1')).toEqual([
			{ cx: -1, cz: -1 },
			{ cx: -1, cz: 2 },
			{ cx: 0, cz: 0 },
			{ cx: 3, cz: -5 },
		])
		expect(await store.listChunkKeys('other')).toEqual([])
		await store.close()
	})

	it('stores worlds, players and settings and hands out copies', async () => {
		const store = createMemoryWorldStore()
		await store.putMeta(meta('b', 'Beta'))
		await store.putMeta(meta('a', 'Alpha'))
		expect((await store.listWorlds()).map((entry) => entry.worldId)).toEqual(['a', 'b'])

		const loaded = await store.getMeta('a')
		expect(loaded?.name).toBe('Alpha')
		if (loaded !== undefined) loaded.name = 'mutated'
		expect((await store.getMeta('a'))?.name).toBe('Alpha')

		await store.putPlayer('a', player(null))
		expect(await store.getPlayer('a')).toEqual(player(null))
		await store.putPlayer('a', player({ x: 4, y: 65, z: -9 }))
		expect((await store.getPlayer('a'))?.respawn).toEqual({ x: 4, y: 65, z: -9 })
		expect(await store.getPlayer('missing')).toBeUndefined()

		expect(await store.getSettings()).toBeUndefined()
		await store.putSettings(SETTINGS)
		expect(await store.getSettings()).toEqual(SETTINGS)
		await store.close()
	})

	it('deletes one world without touching the others', async () => {
		const store = createMemoryWorldStore({ compress: false })
		await store.putMeta(meta('a', 'Alpha'))
		await store.putMeta(meta('b', 'Beta'))
		await store.putPlayer('a', player(null))
		await store.putChunks('a', [{ cx: 0, cz: 0, data: payload(6) }])
		await store.putChunks('b', [{ cx: 0, cz: 0, data: payload(7) }])

		await store.deleteWorld('a')
		expect(await store.getMeta('a')).toBeUndefined()
		expect(await store.getPlayer('a')).toBeUndefined()
		expect(await store.listChunkKeys('a')).toEqual([])
		expect(await store.getMeta('b')).toBeDefined()
		expect((await store.listChunkKeys('b')).length).toBe(1)
		await store.close()
	})

	it('refuses to work after close', async () => {
		const store = createMemoryWorldStore()
		await store.close()
		await expect(store.getChunk('w1', 0, 0)).rejects.toThrow(/closed/)
		await expect(store.listWorlds()).rejects.toThrow(/closed/)
	})
})

describe('filesystem world store', () => {
	it('persists a whole save and reopens it', async () => {
		const root = await mkdtemp(`${tmpdir()}/voxelcraft-fs-`)
		try {
			const store = await createFsWorldStore({ root })
			expect(await store.listWorlds()).toEqual([])
			expect(await store.getChunk('w1', 0, 0)).toBeUndefined()
			expect(await store.getMeta('w1')).toBeUndefined()
			expect(await store.listChunkKeys('w1')).toEqual([])

			const bytes = payload(8)
			await store.putMeta(meta('w1', 'Overworld'))
			await store.putPlayer('w1', player({ x: -2, y: 64, z: 8 }))
			await store.putSettings(SETTINGS)
			await store.putChunks('w1', [
				{ cx: 0, cz: 0, data: bytes },
				{ cx: -3, cz: 4, data: payload(9) },
			])
			await store.close()

			// A fresh store on the same root sees everything.
			const reopened = await createFsWorldStore({ root })
			expect((await reopened.listWorlds()).map((entry) => entry.name)).toEqual(['Overworld'])
			expect(await reopened.listChunkKeys('w1')).toEqual([
				{ cx: -3, cz: 4 },
				{ cx: 0, cz: 0 },
			])
			expect([...((await reopened.getChunk('w1', 0, 0)) ?? new Uint8Array())]).toEqual([...bytes])
			expect(await reopened.getPlayer('w1')).toEqual(player({ x: -2, y: 64, z: 8 }))
			expect(await reopened.getSettings()).toEqual(SETTINGS)

			await reopened.deleteWorld('w1')
			expect(await reopened.listWorlds()).toEqual([])
			expect(await reopened.listChunkKeys('w1')).toEqual([])
			await reopened.close()
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})

	it('can skip compression on disk', async () => {
		const root = await mkdtemp(`${tmpdir()}/voxelcraft-fs-raw-`)
		try {
			const store = await createFsWorldStore({ root, compress: false })
			const bytes = payload(10)
			await store.putChunks('w1', [{ cx: 1, cz: 1, data: bytes }])
			expect([...((await store.getChunk('w1', 1, 1)) ?? new Uint8Array())]).toEqual([...bytes])
			await store.close()
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})
})

interface ManualTimer extends WriteTimer {
	readonly scheduled: number[]
	fire(): void
}

function manualTimer(): ManualTimer {
	const pending = new Map<number, () => void>()
	const scheduled: number[] = []
	let nextId = 1
	return {
		scheduled,
		set(callback: () => void, ms: number): unknown {
			const id = nextId
			nextId += 1
			pending.set(id, callback)
			scheduled.push(ms)
			return id
		},
		clear(handle: unknown): void {
			pending.delete(handle as number)
		},
		fire(): void {
			const due = [...pending.values()]
			pending.clear()
			for (const callback of due) callback()
		},
	}
}

describe('chunk write queue', () => {
	it('uses the contract batch size and interval', () => {
		expect(PERSIST.writeBatchChunks).toBe(32)
		expect(PERSIST.writeIntervalMs).toBe(1500)
	})

	it('flushes as soon as the batch is full', async () => {
		const store = createMemoryWorldStore({ compress: false })
		const timer = manualTimer()
		const queue = createChunkWriteQueue(store, 'w1', { timer })

		for (let i = 0; i < PERSIST.writeBatchChunks - 1; i++) queue.queue(i, 0, payload(i))
		expect(queue.pending).toBe(PERSIST.writeBatchChunks - 1)
		expect(queue.batches).toEqual([])

		queue.queue(PERSIST.writeBatchChunks - 1, 0, payload(99))
		await queue.flush()
		expect(queue.batches).toEqual([PERSIST.writeBatchChunks])
		expect(queue.pending).toBe(0)
		expect((await store.listChunkKeys('w1')).length).toBe(PERSIST.writeBatchChunks)
		expect(queue.lastError).toBeNull()
		await queue.close()
		await store.close()
	})

	it('flushes on the interval timer for a partial batch', async () => {
		const store = createMemoryWorldStore({ compress: false })
		const timer = manualTimer()
		const queue = createChunkWriteQueue(store, 'w1', { timer })

		queue.queue(0, 0, payload(1))
		queue.queue(1, 0, payload(2))
		// One timer only: it is anchored on the oldest pending chunk.
		expect(timer.scheduled).toEqual([PERSIST.writeIntervalMs])
		expect(queue.batches).toEqual([])

		timer.fire()
		await queue.flush()
		expect(queue.batches).toEqual([2])
		expect((await store.listChunkKeys('w1')).length).toBe(2)
		await queue.close()
		await store.close()
	})

	it('collapses repeated writes to the same chunk and copies the data', async () => {
		const store = createMemoryWorldStore({ compress: false })
		const queue = createChunkWriteQueue(store, 'w1', { timer: manualTimer() })

		const first = payload(11)
		const second = payload(12)
		queue.queue(5, 5, first)
		queue.queue(5, 5, second)
		expect(queue.pending).toBe(1)
		// Mutating the caller's buffer afterwards must not change what is stored.
		second[CHUNK_MUTATION_OFFSET] ^= 0xff
		await queue.flush()
		expect(queue.batches).toEqual([1])
		const stored = store.rawChunk('w1', 5, 5)
		expect([...(stored ?? new Uint8Array())]).toEqual([...payload(12)])
		await queue.close()
		await store.close()
	})

	it('flushes on close and rejects later writes', async () => {
		const store = createMemoryWorldStore({ compress: false })
		const queue = createChunkWriteQueue(store, 'w1', { timer: manualTimer() })
		queue.queue(2, 2, payload(13))
		await queue.close()
		expect(queue.pending).toBe(0)
		expect(queue.batches).toEqual([1])
		expect(await store.getChunk('w1', 2, 2)).toBeDefined()
		expect(() => {
			queue.queue(0, 0, payload(14))
		}).toThrow(/closed/)
		await store.close()
	})
})

/** Any byte inside the payload body works for the copy-on-queue check. */
const CHUNK_MUTATION_OFFSET = 20
