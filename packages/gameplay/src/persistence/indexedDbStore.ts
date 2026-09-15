import {
	PERSIST,
	type ChunkPos,
	type GameSettings,
	type PlayerSave,
	type SaveMeta,
	type WorldStore,
} from '@voxelcraft/core-types'
import {
	assertChunkPos,
	closedError,
	resolvePayloadCodec,
	sortChunkPositions,
	sortWorldMetas,
	type WorldStoreOptions,
} from './support'

/**
 * IndexedDB `WorldStore`.
 *
 * Chunks live in one object store keyed by the compound key [worldId, cx, cz],
 * so a world's chunks form a contiguous key range and negative coordinates keep
 * their numeric ordering. `putChunks` writes the whole batch in a single
 * read/write transaction.
 */

export interface IndexedDbWorldStoreOptions extends WorldStoreOptions {
	/** Defaults to `globalThis.indexedDB`. Tests pass fake-indexeddb's factory. */
	factory?: IDBFactory
	/** Defaults to `globalThis.IDBKeyRange`. */
	keyRange?: typeof IDBKeyRange
	dbName?: string
	dbVersion?: number
}

interface ChunkRecord {
	worldId: string
	cx: number
	cz: number
	data: Uint8Array
}

interface PlayerRecord {
	worldId: string
	player: PlayerSave
}

interface SettingsRecord {
	key: string
	settings: GameSettings
}

const SETTINGS_KEY = 'global'

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		request.onsuccess = (): void => {
			resolve(request.result)
		}
		request.onerror = (): void => {
			reject(request.error ?? new Error('IndexedDB request failed'))
		}
	})
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		transaction.oncomplete = (): void => {
			resolve()
		}
		transaction.onabort = (): void => {
			reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
		}
		transaction.onerror = (): void => {
			reject(transaction.error ?? new Error('IndexedDB transaction failed'))
		}
	})
}

function openDatabase(
	factory: IDBFactory,
	dbName: string,
	dbVersion: number,
): Promise<IDBDatabase> {
	return new Promise<IDBDatabase>((resolve, reject) => {
		const open = factory.open(dbName, dbVersion)
		open.onupgradeneeded = (): void => {
			const db = open.result
			if (!db.objectStoreNames.contains(PERSIST.storeChunks)) {
				db.createObjectStore(PERSIST.storeChunks, { keyPath: ['worldId', 'cx', 'cz'] })
			}
			if (!db.objectStoreNames.contains(PERSIST.storeWorlds)) {
				db.createObjectStore(PERSIST.storeWorlds, { keyPath: 'worldId' })
			}
			if (!db.objectStoreNames.contains(PERSIST.storePlayers)) {
				db.createObjectStore(PERSIST.storePlayers, { keyPath: 'worldId' })
			}
			if (!db.objectStoreNames.contains(PERSIST.storeSettings)) {
				db.createObjectStore(PERSIST.storeSettings, { keyPath: 'key' })
			}
		}
		open.onsuccess = (): void => {
			resolve(open.result)
		}
		open.onerror = (): void => {
			reject(open.error ?? new Error('failed to open IndexedDB'))
		}
		open.onblocked = (): void => {
			reject(new Error('IndexedDB upgrade blocked by another open connection'))
		}
	})
}

export async function createIndexedDbWorldStore(
	options: IndexedDbWorldStoreOptions = {},
): Promise<WorldStore> {
	const factory =
		options.factory ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB ?? undefined
	if (factory === undefined) {
		throw new Error('no IndexedDB implementation available on this runtime')
	}
	const keyRange =
		options.keyRange ??
		(globalThis as { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange ??
		undefined
	if (keyRange === undefined) {
		throw new Error('no IDBKeyRange implementation available on this runtime')
	}
	const payloads = resolvePayloadCodec(options)
	const db = await openDatabase(
		factory,
		options.dbName ?? PERSIST.dbName,
		options.dbVersion ?? PERSIST.dbVersion,
	)
	let closed = false

	const alive = (): void => {
		if (closed) throw closedError()
	}
	// Arrays sort after every primitive key, so [worldId] .. [worldId, []]
	// covers exactly the three-element keys of one world.
	const worldChunkRange = (worldId: string): IDBKeyRange =>
		keyRange.bound([worldId], [worldId, []])

	return {
		async listWorlds(): Promise<readonly SaveMeta[]> {
			alive()
			const transaction = db.transaction(PERSIST.storeWorlds, 'readonly')
			const metas = await requestResult<SaveMeta[]>(
				transaction.objectStore(PERSIST.storeWorlds).getAll(),
			)
			return sortWorldMetas(metas)
		},

		async putMeta(meta: SaveMeta): Promise<void> {
			alive()
			const transaction = db.transaction(PERSIST.storeWorlds, 'readwrite')
			transaction.objectStore(PERSIST.storeWorlds).put(meta)
			await transactionDone(transaction)
		},

		async getMeta(worldId: string): Promise<SaveMeta | undefined> {
			alive()
			const transaction = db.transaction(PERSIST.storeWorlds, 'readonly')
			return requestResult<SaveMeta | undefined>(
				transaction.objectStore(PERSIST.storeWorlds).get(worldId),
			)
		},

		async deleteWorld(worldId: string): Promise<void> {
			alive()
			const transaction = db.transaction(
				[PERSIST.storeWorlds, PERSIST.storePlayers, PERSIST.storeChunks],
				'readwrite',
			)
			transaction.objectStore(PERSIST.storeWorlds).delete(worldId)
			transaction.objectStore(PERSIST.storePlayers).delete(worldId)
			transaction.objectStore(PERSIST.storeChunks).delete(worldChunkRange(worldId))
			await transactionDone(transaction)
		},

		async getChunk(worldId: string, cx: number, cz: number): Promise<Uint8Array | undefined> {
			alive()
			assertChunkPos(cx, cz)
			const transaction = db.transaction(PERSIST.storeChunks, 'readonly')
			const record = await requestResult<ChunkRecord | undefined>(
				transaction.objectStore(PERSIST.storeChunks).get([worldId, cx, cz]),
			)
			if (record === undefined) return undefined
			return payloads.decode(new Uint8Array(record.data))
		},

		async putChunks(
			worldId: string,
			entries: readonly { cx: number; cz: number; data: Uint8Array }[],
		): Promise<void> {
			alive()
			if (entries.length === 0) return
			const records: ChunkRecord[] = []
			for (const entry of entries) {
				assertChunkPos(entry.cx, entry.cz)
				records.push({
					worldId,
					cx: entry.cx,
					cz: entry.cz,
					data: await payloads.encode(entry.data),
				})
			}
			alive()
			// Compression is awaited up front so the transaction never idles and
			// auto-commits: every record lands in this one transaction.
			const transaction = db.transaction(PERSIST.storeChunks, 'readwrite')
			const store = transaction.objectStore(PERSIST.storeChunks)
			for (const record of records) store.put(record)
			await transactionDone(transaction)
		},

		async listChunkKeys(worldId: string): Promise<readonly ChunkPos[]> {
			alive()
			const transaction = db.transaction(PERSIST.storeChunks, 'readonly')
			const keys = await requestResult<IDBValidKey[]>(
				transaction.objectStore(PERSIST.storeChunks).getAllKeys(worldChunkRange(worldId)),
			)
			const positions: ChunkPos[] = []
			for (const key of keys) {
				if (!Array.isArray(key)) continue
				const parts = key as [string, number, number]
				positions.push({ cx: parts[1], cz: parts[2] })
			}
			return sortChunkPositions(positions)
		},

		async getPlayer(worldId: string): Promise<PlayerSave | undefined> {
			alive()
			const transaction = db.transaction(PERSIST.storePlayers, 'readonly')
			const record = await requestResult<PlayerRecord | undefined>(
				transaction.objectStore(PERSIST.storePlayers).get(worldId),
			)
			return record?.player
		},

		async putPlayer(worldId: string, player: PlayerSave): Promise<void> {
			alive()
			const transaction = db.transaction(PERSIST.storePlayers, 'readwrite')
			const record: PlayerRecord = { worldId, player }
			transaction.objectStore(PERSIST.storePlayers).put(record)
			await transactionDone(transaction)
		},

		async getSettings(): Promise<GameSettings | undefined> {
			alive()
			const transaction = db.transaction(PERSIST.storeSettings, 'readonly')
			const record = await requestResult<SettingsRecord | undefined>(
				transaction.objectStore(PERSIST.storeSettings).get(SETTINGS_KEY),
			)
			return record?.settings
		},

		async putSettings(settings: GameSettings): Promise<void> {
			alive()
			const transaction = db.transaction(PERSIST.storeSettings, 'readwrite')
			const record: SettingsRecord = { key: SETTINGS_KEY, settings }
			transaction.objectStore(PERSIST.storeSettings).put(record)
			await transactionDone(transaction)
		},

		async close(): Promise<void> {
			if (closed) return
			closed = true
			db.close()
		},
	}
}
