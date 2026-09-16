/**
 * The BFS core of the light engine: removal and re-propagation.
 *
 * Split out of `lightEngine.ts` unchanged in behaviour. Entering a voxel costs
 * `1 + opacity`, plus `skyFilter` on the sky channel, and sky light `MAX_LIGHT`
 * falls straight down through `skyPassThrough` voxels without attenuation.
 *
 * The H-05 change here is what a neighbour test costs, not what it decides.
 * Every read used to go through `SimVoxelWorld`, which resolves a chunk by
 * building the `chunkKey(cx, cz)` template string, and every optics lookup
 * allocated a fresh `LightProps`. One neighbour test did three string
 * allocations and one object allocation; the stitch phase alone ran about
 * fifteen million of them. Reads now go through the numerically keyed chunk
 * cache and the precomputed optics tables. Writes still go through the world
 * setters, so every bit of their bookkeeping is preserved.
 */
import {
	BLOCK,
	CHUNK_Y,
	FACE,
	FACE_DIRS,
	MAX_LIGHT,
	PERF,
	blockIndex,
	worldToChunk,
	worldToLocal,
} from '@voxelcraft/core-types'
import type { BlockId } from '@voxelcraft/core-types'
import type { SimVoxelWorld } from '../shared/voxelWorld'
import { LightQueue } from './lightQueue'
import { opticsOpacity, opticsSkyFilter, opticsSkyPass } from './lightTables'
import type { LightChunkCache, LightOptics } from './lightTables'

/** Light byte above the world ceiling: full sky, no block light. */
const ABOVE_CEILING_BYTE = MAX_LIGHT << 4

export interface LightChannel {
	readonly sky: boolean
	readonly add: LightQueue
	readonly remove: LightQueue
	get(x: number, y: number, z: number): number
	set(x: number, y: number, z: number, value: number): void
	/** Light the voxel produces on its own: emission, or direct sky. */
	source(x: number, y: number, z: number): number
}

export interface LightContext {
	readonly world: SimVoxelWorld
	readonly optics: LightOptics
	readonly chunks: LightChunkCache
	/** Propagation is restricted to one chunk while a fresh chunk is seeded. */
	confined: boolean
	confineCx: number
	confineCz: number
	markDirty(x: number, y: number, z: number): void
}

/**
 * Packed light byte, matching `SimVoxelWorld` outside the loaded region: full
 * sky above the ceiling, dark below the floor or in an unloaded chunk.
 */
export function lightPackedAt(ctx: LightContext, x: number, y: number, z: number): number {
	if (y < 0) return 0
	if (y >= CHUNK_Y) return ABOVE_CEILING_BYTE
	const chunk = ctx.chunks.at(x, z)
	if (chunk === undefined) return 0
	return chunk.light[blockIndex(worldToLocal(x), y, worldToLocal(z))]
}

export function lightBlockAt(ctx: LightContext, x: number, y: number, z: number): BlockId {
	if (y < 0 || y >= CHUNK_Y) return BLOCK.AIR
	const chunk = ctx.chunks.at(x, z)
	if (chunk === undefined) return BLOCK.AIR
	return chunk.blocks[blockIndex(worldToLocal(x), y, worldToLocal(z))]
}

/** Light is only ever written inside loaded chunks. */
export function lightWritable(ctx: LightContext, x: number, y: number, z: number): boolean {
	if (y < 0 || y >= CHUNK_Y) return false
	const cx = worldToChunk(x)
	const cz = worldToChunk(z)
	if (ctx.confined && (cx !== ctx.confineCx || cz !== ctx.confineCz)) return false
	return ctx.chunks.chunkAt(cx, cz) !== undefined
}

/** Level a neighbour receives across `face`, or <= 0 when nothing arrives. */
export function lightAttenuate(
	ctx: LightContext,
	level: number,
	targetId: BlockId,
	sky: boolean,
	face: number,
): number {
	const optics = ctx.optics
	if (sky && level === MAX_LIGHT && face === FACE.NegY && opticsSkyPass(optics, targetId) !== 0) {
		return MAX_LIGHT
	}
	return level - 1 - opticsOpacity(optics, targetId) - (sky ? opticsSkyFilter(optics, targetId) : 0)
}

/** Re-propagation pass. Returns the running write count. */
export function lightRunAdd(
	ctx: LightContext,
	channel: LightChannel,
	budget: number,
	startOps: number,
): number {
	const queue = channel.add
	let ops = startOps
	while (queue.peek()) {
		if (ops >= budget) break
		const x = queue.x
		const y = queue.y
		const z = queue.z
		let face = queue.face
		const level = channel.get(x, y, z)
		if (level <= 0) {
			queue.advance()
			continue
		}
		let suspended = false
		for (; face < 6; face++) {
			if (ops >= budget) {
				suspended = true
				break
			}
			const dir = FACE_DIRS[face]
			const nx = x + dir.x
			const ny = y + dir.y
			const nz = z + dir.z
			if (!lightWritable(ctx, nx, ny, nz)) continue
			const next = lightAttenuate(ctx, level, lightBlockAt(ctx, nx, ny, nz), channel.sky, face)
			if (next <= 0) continue
			if (channel.get(nx, ny, nz) >= next) continue
			channel.set(nx, ny, nz, next)
			ctx.markDirty(nx, ny, nz)
			ops++
			queue.pushAdd(nx, ny, nz)
		}
		if (suspended) {
			// Resume this voxel at the same face on the next step.
			queue.setFace(face)
			break
		}
		queue.advance()
	}
	return ops
}

/**
 * Removal pass. A neighbour dimmer than the level that used to be here was lit
 * by this voxel, so it is cleared back to its own source level and the removal
 * continues. A neighbour at least as bright survives and is queued for
 * re-propagation, which is what heals the hole.
 */
export function lightRunRemove(
	ctx: LightContext,
	channel: LightChannel,
	budget: number,
	startOps: number,
): number {
	const queue = channel.remove
	let ops = startOps
	while (queue.peek()) {
		if (ops >= budget) break
		const x = queue.x
		const y = queue.y
		const z = queue.z
		const level = queue.level
		let face = queue.face
		let suspended = false
		for (; face < 6; face++) {
			if (ops >= budget) {
				suspended = true
				break
			}
			const dir = FACE_DIRS[face]
			const nx = x + dir.x
			const ny = y + dir.y
			const nz = z + dir.z
			if (!lightWritable(ctx, nx, ny, nz)) continue
			const current = channel.get(nx, ny, nz)
			if (current === 0) continue
			if (current < level) {
				const own = channel.source(nx, ny, nz)
				channel.set(nx, ny, nz, own)
				ctx.markDirty(nx, ny, nz)
				ops++
				queue.pushRemove(nx, ny, nz, current)
				if (own > 0) channel.add.pushAdd(nx, ny, nz)
			} else {
				channel.add.pushAdd(nx, ny, nz)
			}
		}
		if (suspended) {
			queue.setFace(face)
			break
		}
		queue.advance()
	}
	return ops
}

/** Removals run before additions so a stale value is never re-spread. */
export function lightStep(
	ctx: LightContext,
	sky: LightChannel,
	block: LightChannel,
	budgetOps: number,
): number {
	const budget = Math.max(0, Math.floor(budgetOps))
	if (budget === 0) return 0
	let ops = lightRunRemove(ctx, sky, budget, 0)
	ops = lightRunRemove(ctx, block, budget, ops)
	ops = lightRunAdd(ctx, sky, budget, ops)
	ops = lightRunAdd(ctx, block, budget, ops)
	return ops
}

/** Repeats `lightStep` until the queues are empty. Returns the writes done. */
export function lightDrain(
	ctx: LightContext,
	sky: LightChannel,
	block: LightChannel,
	maxOps: number = Number.MAX_SAFE_INTEGER,
): number {
	let total = 0
	for (;;) {
		const remaining = maxOps - total
		if (remaining <= 0) break
		const did = lightStep(ctx, sky, block, Math.min(PERF.lightOpsPerTick, remaining))
		total += did
		// A step that writes nothing has consumed every queued record.
		if (did === 0) break
	}
	return total
}
