import type {
	ChunkPos,
	GameSettings,
	PlayerSave,
	SaveMeta,
	WorldStore,
} from '@voxelcraft/core-types'
import {
	assertChunkPos,
	cloneMeta,
	clonePlayer,
	cloneSettings,
	closedError,
	copyBytes,
	resolvePayloadCodec,
	sortChunkPositions,
	sortWorldMetas,
	type WorldStoreOptions,
} from './support'

interface ChunkRecord {
	worldId: string
	cx: number
	cz: number
	data: Uint8Array
}

export interface MemoryWorldStore extends WorldStore {
	/** Bytes exactly as stored, i.e. still deflated when compression is on. */
	rawChunk(worldId: string, cx: number, cz: number): Uint8Array | undefined
	readonly compressed: boolean
}

/**
 * The contract keys chunks by the compound array [worldId, cx, cz]. A `Map`
 * cannot key on arrays by value, so the JSON form of that exact tuple is used
 * as the lookup key and the components are kept on the record.
 */
function keyOf(worldId: string, cx: number, cz: number): string {
	return JSON.stringify([worldId, cx, cz])
}

/** In-memory `WorldStore`, used by Node tests and as a scratch save target. */
export function createMemoryWorldStore(options: WorldStoreOptions = {}): MemoryWorldStore {
	const payloads = resolvePayloadCodec(options)
	const metas = new Map<string, SaveMeta>()
	const chunks = new Map<string, ChunkRecord>()
	const players = new Map<string, PlayerSave>()
	let settings: GameSettings | undefined
	let closed = false

	const alive = (): void => {
		if (closed) throw closedError()
	}

	return {
		compressed: payloads.compressed,

		rawChunk(worldId: string, cx: number, cz: number): Uint8Array | undefined {
			const record = chunks.get(keyOf(worldId, cx, cz))
			return record === undefined ? undefined : copyBytes(record.data)
		},

		async listWorlds(): Promise<readonly SaveMeta[]> {
			alive()
			return sortWorldMetas([...metas.values()].map(cloneMeta))
		},

		async putMeta(meta: SaveMeta): Promise<void> {
			alive()
			metas.set(meta.worldId, cloneMeta(meta))
		},

		async getMeta(worldId: string): Promise<SaveMeta | undefined> {
			alive()
			const meta = metas.get(worldId)
			return meta === undefined ? undefined : cloneMeta(meta)
		},

		async deleteWorld(worldId: string): Promise<void> {
			alive()
			metas.delete(worldId)
			players.delete(worldId)
			for (const [key, record] of [...chunks]) {
				if (record.worldId === worldId) chunks.delete(key)
			}
		},

		async getChunk(worldId: string, cx: number, cz: number): Promise<Uint8Array | undefined> {
			alive()
			assertChunkPos(cx, cz)
			const record = chunks.get(keyOf(worldId, cx, cz))
			if (record === undefined) return undefined
			return payloads.decode(record.data)
		},

		async putChunks(
			worldId: string,
			entries: readonly { cx: number; cz: number; data: Uint8Array }[],
		): Promise<void> {
			alive()
			const encoded: ChunkRecord[] = []
			for (const entry of entries) {
				assertChunkPos(entry.cx, entry.cz)
				encoded.push({
					worldId,
					cx: entry.cx,
					cz: entry.cz,
					data: await payloads.encode(entry.data),
				})
			}
			alive()
			// Encode first, publish second: the batch becomes visible all at once.
			for (const record of encoded) {
				chunks.set(keyOf(worldId, record.cx, record.cz), record)
			}
		},

		async listChunkKeys(worldId: string): Promise<readonly ChunkPos[]> {
			alive()
			const positions: ChunkPos[] = []
			for (const record of chunks.values()) {
				if (record.worldId === worldId) positions.push({ cx: record.cx, cz: record.cz })
			}
			return sortChunkPositions(positions)
		},

		async getPlayer(worldId: string): Promise<PlayerSave | undefined> {
			alive()
			const player = players.get(worldId)
			return player === undefined ? undefined : clonePlayer(player)
		},

		async putPlayer(worldId: string, player: PlayerSave): Promise<void> {
			alive()
			players.set(worldId, clonePlayer(player))
		},

		async getSettings(): Promise<GameSettings | undefined> {
			alive()
			return settings === undefined ? undefined : cloneSettings(settings)
		},

		async putSettings(next: GameSettings): Promise<void> {
			alive()
			settings = cloneSettings(next)
		},

		async close(): Promise<void> {
			closed = true
		},
	}
}
