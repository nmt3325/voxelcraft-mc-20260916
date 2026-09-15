import type { ChunkPos, Vec3f, Vec3i } from './ids'
import type { InventoryState } from './items'

export const SAVE_VERSION = 1

export const GAME_MODE = { Survival: 0, Creative: 1 } as const
export type GameMode = (typeof GAME_MODE)[keyof typeof GAME_MODE]

export interface SaveMeta {
	worldId: string
	name: string
	seed: number
	createdAt: number
	lastPlayedAt: number
	gameMode: GameMode
	saveVersion: number
	generatorVersion: number
}

export interface PlayerSave {
	position: Vec3f
	yaw: number
	pitch: number
	health: number
	gameMode: GameMode
	inventory: InventoryState
	/** Bed respawn point, null means world spawn. */
	respawn: Vec3i | null
	tick: number
}

export interface GameSettings {
	renderDistance: number
	fov: number
	sensitivity: number
	volume: number
	showDebug: boolean
}

/**
 * Storage adapter. IndexedDB in the browser, filesystem in Node tests.
 * Keys are compound arrays [worldId, cx, cz]: never template strings, so that
 * negative coordinates keep their ordering for range queries.
 */
export interface WorldStore {
	listWorlds(): Promise<readonly SaveMeta[]>
	putMeta(meta: SaveMeta): Promise<void>
	getMeta(worldId: string): Promise<SaveMeta | undefined>
	deleteWorld(worldId: string): Promise<void>
	getChunk(worldId: string, cx: number, cz: number): Promise<Uint8Array | undefined>
	/** All entries must be written in a single transaction. */
	putChunks(
		worldId: string,
		entries: readonly { cx: number; cz: number; data: Uint8Array }[],
	): Promise<void>
	listChunkKeys(worldId: string): Promise<readonly ChunkPos[]>
	getPlayer(worldId: string): Promise<PlayerSave | undefined>
	putPlayer(worldId: string, player: PlayerSave): Promise<void>
	getSettings(): Promise<GameSettings | undefined>
	putSettings(settings: GameSettings): Promise<void>
	close(): Promise<void>
}

export const PERSIST = {
	writeBatchChunks: 32,
	writeIntervalMs: 1500,
	dbName: 'voxelcraft',
	dbVersion: 1,
	storeChunks: 'chunks',
	storeWorlds: 'worlds',
	storePlayers: 'players',
	storeSettings: 'settings',
} as const
