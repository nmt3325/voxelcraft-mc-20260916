/**
 * Contracts between the server modules. The world store, the edit validator,
 * the chunk streamer and the tick loop all import from here instead of from
 * each other, so the pieces can be written and tested independently.
 *
 * Deliberately local: apps/server does not depend on @voxelcraft/world, so a
 * terrain change in another subtree can never turn the network gates red.
 */
import type { BlockId, DimensionId, EntityId } from '@voxelcraft/core-types'

/** One 16 x 256 x 16 column of authoritative blocks. */
export interface ChunkColumn {
	readonly cx: number
	readonly cz: number
	/** BlockId per voxel, CHUNK_VOLUME long, indexed by blockIndex(x, y, z). */
	readonly blocks: Uint16Array
	/** Packed fluid byte per voxel, CHUNK_VOLUME long. */
	readonly fluids: Uint8Array
	/** Bumped on every accepted edit, so a streamer can detect a stale send. */
	revision: number
}

export interface ServerWorld {
	readonly seed: number
	readonly dimension: DimensionId
	/** Generates the column on first touch. Never returns undefined. */
	chunk(cx: number, cz: number): ChunkColumn
	block(x: number, y: number, z: number): BlockId
	/** False when the coordinate is outside the buildable world. */
	setBlock(x: number, y: number, z: number, block: BlockId): boolean
	/** First free y above the highest non-air block of the column. */
	surfaceY(x: number, z: number): number
	/** How many columns have been generated so far. */
	readonly loadedChunks: number
}

export interface PlayerState {
	readonly id: EntityId
	readonly name: string
	x: number
	y: number
	z: number
	yaw: number
	pitch: number
	health: number
	hotbar: number
	/** Last INPUT_BIT field the server accepted. */
	bits: number
	/** Highest client tick the server has applied for this player. */
	lastTick: number
}

/** A position the client asked for, before the server clamps it. */
export interface DesiredMove {
	x: number
	y: number
	z: number
	yaw: number
	pitch: number
}

export type EditRejection = 'out_of_world' | 'out_of_reach' | 'unknown_block' | 'stale_tick'

export type EditVerdict = { ok: true; block: BlockId } | { ok: false; reason: EditRejection }
