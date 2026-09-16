/**
 * World persistence for apps/game.
 *
 * This is the real `@voxelcraft/gameplay` persistence layer: an IndexedDB
 * `WorldStore` on `PERSIST.dbName` ("voxelcraft"), `SAVE_VERSION` 1 metadata,
 * chunk payloads keyed by [worldId, cx, cz], and the batched chunk write queue.
 * Node and unit tests inject a store instead (memory or filesystem adapter),
 * and a runtime without IndexedDB falls back to the memory store so the game
 * still boots instead of logging an error.
 */
import {
	GAME_MODE,
	PERF,
	PERSIST,
	SAVE_VERSION,
	WORLD_GEN_VERSION,
	type ChunkPos,
	type GameMode,
	type GameSettings,
	type PlayerSave,
	type SaveMeta,
	type WorldStore,
} from '@voxelcraft/core-types'
import {
	createChunkWriteQueue,
	createIndexedDbWorldStore,
	createMemoryWorldStore,
	type ChunkWriteQueue,
} from '@voxelcraft/gameplay'

/** Settings used for a brand new profile. */
export const DEFAULT_SETTINGS: GameSettings = {
	renderDistance: PERF.renderDistanceDefault,
	fov: PERF.fovDefault,
	sensitivity: PERF.sensitivityDefault,
	volume: 0.6,
	showDebug: false,
}

export type StoreBackend = 'indexeddb' | 'memory' | 'injected'

export interface WorldPersistenceOptions {
	worldId: string
	/** Injected store. Used by unit tests and by the Node adapters. */
	store?: WorldStore
	dbName?: string
	/** Reported when the store has to be created; defaults to `console.warn`. */
	onWarning?: (message: string, error?: unknown) => void
}

export interface SaveInput {
	meta: SaveMeta
	player: PlayerSave
	settings: GameSettings
	chunks: readonly { cx: number; cz: number; data: Uint8Array }[]
}

export interface WorldPersistence {
	readonly store: WorldStore
	readonly worldId: string
	readonly backend: StoreBackend
	listWorlds(): Promise<readonly SaveMeta[]>
	loadMeta(worldId?: string): Promise<SaveMeta | undefined>
	loadPlayer(): Promise<PlayerSave | undefined>
	loadSettings(): Promise<GameSettings>
	chunkKeys(): Promise<readonly ChunkPos[]>
	loadChunk(cx: number, cz: number): Promise<Uint8Array | undefined>
	/** Queues a chunk for the batched writer (32 chunks / 1.5 s). */
	queueChunk(cx: number, cz: number, data: Uint8Array): void
	/** Writes metadata, the player, settings and every queued chunk. */
	save(input: SaveInput): Promise<void>
	deleteWorld(worldId: string): Promise<void>
	close(): Promise<void>
}

export function indexedDbAvailable(): boolean {
	const scope = globalThis as { indexedDB?: IDBFactory; IDBKeyRange?: typeof IDBKeyRange }
	return scope.indexedDB !== undefined && scope.IDBKeyRange !== undefined
}

export interface SaveMetaInput {
	worldId: string
	name?: string
	seed: number
	createdAt?: number
	lastPlayedAt?: number
	gameMode?: GameMode
	generatorVersion?: number
}

/** `SaveMeta` with the contract's save and generator versions filled in. */
export function createSaveMeta(input: SaveMetaInput): SaveMeta {
	const now = input.lastPlayedAt ?? Date.now()
	return {
		worldId: input.worldId,
		name: input.name ?? input.worldId,
		seed: input.seed >>> 0,
		createdAt: input.createdAt ?? now,
		lastPlayedAt: now,
		gameMode: input.gameMode ?? GAME_MODE.Creative,
		saveVersion: SAVE_VERSION,
		generatorVersion: input.generatorVersion ?? WORLD_GEN_VERSION,
	}
}

async function resolveStore(
	options: WorldPersistenceOptions,
): Promise<{ store: WorldStore; backend: StoreBackend }> {
	if (options.store !== undefined) return { store: options.store, backend: 'injected' }
	const warn =
		options.onWarning ??
		((message: string, error?: unknown): void => {
			console.warn(`[voxelcraft] ${message}`, error)
		})
	if (!indexedDbAvailable()) {
		warn('IndexedDB is unavailable, saving to memory only')
		return { store: createMemoryWorldStore(), backend: 'memory' }
	}
	try {
		const store = await createIndexedDbWorldStore({ dbName: options.dbName ?? PERSIST.dbName })
		return { store, backend: 'indexeddb' }
	} catch (error) {
		warn('IndexedDB could not be opened, saving to memory only:', error)
		return { store: createMemoryWorldStore(), backend: 'memory' }
	}
}

export async function openWorldPersistence(
	options: WorldPersistenceOptions,
): Promise<WorldPersistence> {
	const { store, backend } = await resolveStore(options)
	const worldId = options.worldId
	let queue: ChunkWriteQueue = createChunkWriteQueue(store, worldId, {
		onError: (error: unknown) => {
			console.warn('[voxelcraft] chunk write failed:', error)
		},
	})

	return {
		store,
		worldId,
		backend,
		listWorlds(): Promise<readonly SaveMeta[]> {
			return store.listWorlds()
		},
		loadMeta(id: string = worldId): Promise<SaveMeta | undefined> {
			return store.getMeta(id)
		},
		loadPlayer(): Promise<PlayerSave | undefined> {
			return store.getPlayer(worldId)
		},
		async loadSettings(): Promise<GameSettings> {
			const stored = await store.getSettings()
			return { ...DEFAULT_SETTINGS, ...(stored ?? {}) }
		},
		chunkKeys(): Promise<readonly ChunkPos[]> {
			return store.listChunkKeys(worldId)
		},
		loadChunk(cx: number, cz: number): Promise<Uint8Array | undefined> {
			return store.getChunk(worldId, cx, cz)
		},
		queueChunk(cx: number, cz: number, data: Uint8Array): void {
			queue.queue(cx, cz, data)
		},
		async save(input: SaveInput): Promise<void> {
			for (const chunk of input.chunks) queue.queue(chunk.cx, chunk.cz, chunk.data)
			await queue.flush()
			await store.putMeta(input.meta)
			await store.putPlayer(worldId, input.player)
			await store.putSettings(input.settings)
		},
		async deleteWorld(id: string): Promise<void> {
			await store.deleteWorld(id)
			if (id === worldId) {
				// The queue holds payloads for a world that no longer exists.
				queue = createChunkWriteQueue(store, worldId)
			}
		},
		async close(): Promise<void> {
			await queue.close()
			await store.close()
		},
	}
}
