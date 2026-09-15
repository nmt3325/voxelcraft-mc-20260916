import type { ChunkPos, GameSettings, PlayerSave, SaveMeta } from '@voxelcraft/core-types'
import { deflateRawBytes, inflateRawBytes } from './compression'

/** How chunk bytes are transformed on the way in and out of a store. */
export interface ChunkPayloadCodec {
	readonly compressed: boolean
	encode(bytes: Uint8Array): Promise<Uint8Array>
	decode(bytes: Uint8Array): Promise<Uint8Array>
}

export interface WorldStoreOptions {
	/** Deflate chunk payloads before storing them. Defaults to `true`. */
	compress?: boolean
}

export function copyBytes(bytes: Uint8Array): Uint8Array {
	return bytes.slice()
}

export const DEFLATE_PAYLOADS: ChunkPayloadCodec = {
	compressed: true,
	encode: (bytes) => deflateRawBytes(bytes),
	decode: (bytes) => inflateRawBytes(bytes),
}

export const RAW_PAYLOADS: ChunkPayloadCodec = {
	compressed: false,
	encode: (bytes) => Promise.resolve(copyBytes(bytes)),
	decode: (bytes) => Promise.resolve(copyBytes(bytes)),
}

export function resolvePayloadCodec(options: WorldStoreOptions = {}): ChunkPayloadCodec {
	return options.compress === false ? RAW_PAYLOADS : DEFLATE_PAYLOADS
}

/** Stable order for `listChunkKeys`: cx ascending, then cz ascending. */
export function sortChunkPositions(positions: ChunkPos[]): ChunkPos[] {
	return positions.sort((a, b) => (a.cx === b.cx ? a.cz - b.cz : a.cx - b.cx))
}

/** Stable order for `listWorlds`: worldId ascending. */
export function sortWorldMetas(metas: SaveMeta[]): SaveMeta[] {
	return metas.sort((a, b) => {
		if (a.worldId === b.worldId) return 0
		return a.worldId < b.worldId ? -1 : 1
	})
}

export function cloneMeta(meta: SaveMeta): SaveMeta {
	return structuredClone(meta)
}

export function clonePlayer(player: PlayerSave): PlayerSave {
	return structuredClone(player)
}

export function cloneSettings(settings: GameSettings): GameSettings {
	return structuredClone(settings)
}

export function assertChunkPos(cx: number, cz: number): void {
	if (!Number.isInteger(cx) || !Number.isInteger(cz)) {
		throw new RangeError(`chunk coordinates must be integers, got ${String(cx)},${String(cz)}`)
	}
}

export function closedError(): Error {
	return new Error('world store is closed')
}
