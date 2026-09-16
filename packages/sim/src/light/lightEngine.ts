/**
 * Sky and block light propagation (`light` subtree, owner sim-b).
 *
 * - One byte per voxel, `(sky << 4) | block`. Writes go through the contract
 *   helpers via `SimVoxelWorld`; reads go through the chunk cache in
 *   `lightTables`, which resolves the same bytes without building a chunk key
 *   string per access.
 * - BFS over the 6 face neighbours, in `lightPropagate.ts`.
 * - A block change runs removal propagation first and re-propagation after, so
 *   an incremental update ends up identical to a full recompute.
 * - Sky light is seeded from the column top, in `lightSeed.ts`. A voxel below
 *   its column top can never hold `MAX_LIGHT`, which is why clearing the column
 *   is enough to invalidate a freshly shadowed region.
 * - `stitchBoundaries(passes = 2)` carries light across chunk borders. The
 *   second pass is the convergence check diagonal (corner) paths need; passes
 *   are idempotent once converged.
 * - `step(budgetOps)` performs at most `budgetOps` light writes and resumes mid
 *   voxel, so one tick never exceeds `PERF.lightOpsPerTick`.
 * - Every constant comes from `@voxelcraft/core-types`; nothing here is random,
 *   time dependent or iteration-order dependent.
 *
 * H-05 (initial seeding cost) is addressed by doing less work, not by changing
 * any result: precomputed optics instead of a `LightProps` allocation per voxel
 * test, integer keyed chunk lookups instead of template string keys, typed
 * array queues, a memset for the uniform sky band, only the spreading frontier
 * queued, seams queued only where the voxel across them can actually brighten,
 * and no re-seed of a chunk that is already lit.
 */
import {
	CHUNK_X,
	CHUNK_Y,
	CHUNK_Z,
	EVENT,
	FACE_DIRS,
	MAX_LIGHT,
	PERF,
	SECTIONS_PER_CHUNK,
	SECTION_Y,
	lightKey,
	worldToChunk,
	worldToLocal,
} from '@voxelcraft/core-types'
import type {
	BlockId,
	ChunkData,
	EventBus,
	LightEngine,
	LightProps,
	SystemEntry,
	SystemFn,
} from '@voxelcraft/core-types'
import { lightPropsOf } from '../shared/blockProps'
import type { SimVoxelWorld } from '../shared/voxelWorld'
import { LightQueue } from './lightQueue'
import { lightBlockAt, lightDrain, lightPackedAt, lightStep, lightWritable } from './lightPropagate'
import type { LightChannel, LightContext } from './lightPropagate'
import { lightColumnTop, lightCreateSeedScratch, lightSeedChunkLocal } from './lightSeed'
import {
	lightBuildOptics,
	lightCreateChunkCache,
	opticsEmission,
	opticsOpacity,
	opticsSkyFilter,
} from './lightTables'

/** Name of this system inside the contract's `SYSTEM_ORDER`. */
export const LIGHT_SYSTEM_NAME = 'light'

const ALL_SECTIONS = (1 << SECTIONS_PER_CHUNK) - 1

/** Integer chunk key; see `lightTables` for why 16 bits per axis is enough. */
const dirtyKey = (cx: number, cz: number): number => ((cx & 0xffff) << 16) | (cz & 0xffff)

/**
 * The four outward seams of a chunk. `alongZ` means the seam plane is
 * perpendicular to x, so `lx` is pinned to `selfLine` and `lz` walks the line.
 */
const SEAMS = [
	{ dcx: -1, dcz: 0, alongZ: true, selfLine: 0, nbLine: CHUNK_X - 1 },
	{ dcx: 1, dcz: 0, alongZ: true, selfLine: CHUNK_X - 1, nbLine: 0 },
	{ dcx: 0, dcz: -1, alongZ: false, selfLine: 0, nbLine: CHUNK_Z - 1 },
	{ dcx: 0, dcz: 1, alongZ: false, selfLine: CHUNK_Z - 1, nbLine: 0 },
] as const

type Seam = (typeof SEAMS)[number]

export interface LightSample {
	sky: number
	block: number
}

export interface LightEngineOptions {
	world: SimVoxelWorld
	/** Optional bus. `EVENT.LightUpdated` is emitted from `drainDirtySections`. */
	events?: EventBus
	/** Optional optics override. Defaults to the shared `lightPropsOf`. */
	propsOf?: (id: BlockId) => LightProps
}

export interface LightEngineInstance extends LightEngine {
	/** Queued BFS records over both channels (removal + re-propagation). */
	readonly pending: number
	/** Repeats `step` until the queues are empty. Returns the writes performed. */
	drain(maxOps?: number): number
	sample(x: number, y: number, z: number): LightSample
	/** `seedChunk` for every loaded chunk, then `stitchBoundaries(passes)`. */
	seedAll(passes?: number): void
	/**
	 * Re-seeds a chunk that is already marked lit. `seedChunk` skips those, so
	 * this is the escape hatch for a chunk whose blocks were replaced wholesale
	 * rather than edited through `onBlockChanged`.
	 */
	reseedChunk(cx: number, cz: number): void
}

export function lightCreateEngine(options: LightEngineOptions): LightEngineInstance {
	const world = options.world
	const events = options.events
	const propsOf = options.propsOf ?? lightPropsOf
	const optics = lightBuildOptics(propsOf)
	const chunks = lightCreateChunkCache(world)
	const scratch = lightCreateSeedScratch()
	const dirty = new Map<number, { cx: number; cz: number; mask: number }>()

	const markDirty = (x: number, y: number, z: number): void => {
		const cx = worldToChunk(x)
		const cz = worldToChunk(z)
		const bit = 1 << ((y / SECTION_Y) | 0)
		const key = dirtyKey(cx, cz)
		const entry = dirty.get(key)
		if (entry) entry.mask |= bit
		else dirty.set(key, { cx, cz, mask: bit })
	}

	const ctx: LightContext = {
		world,
		optics,
		chunks,
		confined: false,
		confineCx: 0,
		confineCz: 0,
		markDirty,
	}

	/** First y above the highest sky blocking voxel of the column. */
	const columnTop = (x: number, z: number): number => {
		const chunk = chunks.at(x, z)
		if (chunk === undefined) return 0
		return lightColumnTop(chunk, optics, worldToLocal(x), worldToLocal(z))
	}

	const skyChannel: LightChannel = {
		sky: true,
		add: new LightQueue(),
		remove: new LightQueue(),
		get: (x, y, z) => lightPackedAt(ctx, x, y, z) >>> 4,
		set: (x, y, z, value) => world.setSkyLightAt(x, y, z, value),
		source: (x, y, z) => (y >= columnTop(x, z) ? MAX_LIGHT : 0),
	}

	const blockChannel: LightChannel = {
		sky: false,
		add: new LightQueue(),
		remove: new LightQueue(),
		get: (x, y, z) => lightPackedAt(ctx, x, y, z) & 0x0f,
		set: (x, y, z, value) => world.setBlockLightAt(x, y, z, value),
		source: (x, y, z) => opticsEmission(optics, lightBlockAt(ctx, x, y, z)),
	}

	const drain = (maxOps: number = Number.MAX_SAFE_INTEGER): number =>
		lightDrain(ctx, skyChannel, blockChannel, maxOps)

	const step = (budgetOps: number): number => lightStep(ctx, skyChannel, blockChannel, budgetOps)

	const write = (channel: LightChannel, x: number, y: number, z: number, value: number): void => {
		channel.set(x, y, z, value)
		markDirty(x, y, z)
	}

	/**
	 * Full recompute of one freshly generated chunk. Propagation is confined to
	 * the chunk, the neighbour seams are handled by `stitchBoundaries`.
	 */
	const seedChunk = (cx: number, cz: number, force: boolean = false): void => {
		const chunk = chunks.chunkAt(cx, cz)
		if (chunk === undefined) return
		// A chunk that is already lit is not freshly generated, so seeding it again
		// would recompute a field it already holds.
		if (chunk.lit && !force) return
		lightSeedChunkLocal(chunk, optics, scratch, skyChannel.add, blockChannel.add)
		ctx.confined = true
		ctx.confineCx = cx
		ctx.confineCz = cz
		drain()
		ctx.confined = false
		chunk.lit = true
		const key = dirtyKey(cx, cz)
		const entry = dirty.get(key)
		if (entry) entry.mask |= ALL_SECTIONS
		else dirty.set(key, { cx, cz, mask: ALL_SECTIONS })
	}

	/**
	 * Queues the voxels on one seam that can actually brighten the voxel across
	 * it. Re-queueing every lit border voxel, as this used to, is what made
	 * stitching two thirds of the H-05 cost: a converged seam enqueued millions
	 * of records that each did six neighbour tests and wrote nothing. The filter
	 * cannot change the outcome, because a record whose outward neighbour is
	 * already at least as bright has nothing to give and the chunk's interior is
	 * converged before any pass starts.
	 */
	const stitchSeam = (chunk: ChunkData, seam: Seam): void => {
		const nb = chunks.chunkAt(chunk.cx + seam.dcx, chunk.cz + seam.dcz)
		if (nb === undefined) return
		const baseX = chunk.cx * CHUNK_X
		const baseZ = chunk.cz * CHUNK_Z
		const selfLight = chunk.light
		const nbLight = nb.light
		const nbBlocks = nb.blocks
		for (let i = 0; i < CHUNK_Z; i++) {
			const selfSlot = seam.alongZ ? (i << 4) | seam.selfLine : (seam.selfLine << 4) | i
			const nbSlot = seam.alongZ ? (i << 4) | seam.nbLine : (seam.nbLine << 4) | i
			const x = baseX + (seam.alongZ ? seam.selfLine : i)
			const z = baseZ + (seam.alongZ ? i : seam.selfLine)
			for (let y = 0; y < CHUNK_Y; y++) {
				const packed = selfLight[(y << 8) | selfSlot]
				if (packed === 0) continue
				const nbIndex = (y << 8) | nbSlot
				const nbId = nbBlocks[nbIndex]
				const nbPacked = nbLight[nbIndex]
				const sky = packed >>> 4
				if (sky > 0) {
					// A seam face is horizontal, so the straight-down `skyPassThrough`
					// shortcut of `lightAttenuate` can never apply here.
					const next =
						sky - 1 - opticsOpacity(optics, nbId) - opticsSkyFilter(optics, nbId)
					if (next > 0 && (nbPacked >>> 4) < next) skyChannel.add.pushAdd(x, y, z)
				}
				const block = packed & 0x0f
				if (block > 0) {
					const next = block - 1 - opticsOpacity(optics, nbId)
					if (next > 0 && (nbPacked & 0x0f) < next) blockChannel.add.pushAdd(x, y, z)
				}
			}
		}
	}

	/**
	 * Carries light across chunk seams. The first pass moves light one chunk
	 * outwards and the second closes the diagonal (corner to corner) paths.
	 * Extra passes are no-ops.
	 */
	const stitchBoundaries = (passes: number = 2): void => {
		const total = Math.max(1, Math.floor(passes))
		for (let pass = 0; pass < total; pass++) {
			for (const chunk of world.orderedChunks()) {
				for (const seam of SEAMS) stitchSeam(chunk, seam)
			}
			drain()
		}
	}

	/**
	 * Differential update for one block edit. Call it after the world write; the
	 * queues are consumed by `step` (or `drain`).
	 */
	const onBlockChanged = (
		x: number,
		y: number,
		z: number,
		before: LightProps,
		after: LightProps,
	): void => {
		if (!lightWritable(ctx, x, y, z)) return
		// Fluid level edits and other optics-neutral changes cannot move light.
		if (lightKey(before) === lightKey(after)) return

		const previous = blockChannel.get(x, y, z)
		if (previous > 0) {
			write(blockChannel, x, y, z, 0)
			blockChannel.remove.pushRemove(x, y, z, previous)
		}
		if (after.emission > 0) {
			write(blockChannel, x, y, z, after.emission)
			blockChannel.add.pushAdd(x, y, z)
		}

		// Sky: refresh the whole column. Voxels below the column top can only be
		// lit indirectly, so a stale MAX_LIGHT there is exactly the shadow to clear.
		const top = columnTop(x, z)
		for (let cy = CHUNK_Y - 1; cy >= 0; cy--) {
			const current = skyChannel.get(x, cy, z)
			if (cy >= top) {
				if (current < MAX_LIGHT) {
					write(skyChannel, x, cy, z, MAX_LIGHT)
					skyChannel.add.pushAdd(x, cy, z)
				}
			} else if (current === MAX_LIGHT) {
				write(skyChannel, x, cy, z, 0)
				skyChannel.remove.pushRemove(x, cy, z, MAX_LIGHT)
			}
		}
		const darker =
			after.opacity + after.skyFilter > before.opacity + before.skyFilter ||
			(before.skyPassThrough && !after.skyPassThrough)
		const ownSky = skyChannel.get(x, y, z)
		if (darker && ownSky > 0 && ownSky < MAX_LIGHT) {
			write(skyChannel, x, y, z, 0)
			skyChannel.remove.pushRemove(x, y, z, ownSky)
		}

		// Surviving neighbours heal whatever the removals over-cleared.
		for (const dir of FACE_DIRS) {
			skyChannel.add.pushAdd(x + dir.x, y + dir.y, z + dir.z)
			blockChannel.add.pushAdd(x + dir.x, y + dir.y, z + dir.z)
		}
		skyChannel.add.pushAdd(x, y, z)
		blockChannel.add.pushAdd(x, y, z)
	}

	/**
	 * Drains the accumulated (cx, cz, sectionMask) triples into `out`, ordered by
	 * chunk. `chunk.dirtySections` is owned by the scheduler, so consumers should
	 * OR these masks into their own re-mesh bookkeeping.
	 */
	const drainDirtySections = (out: Int32Array): number => {
		const capacity = (out.length / 3) | 0
		if (capacity === 0) return 0
		const entries = [...dirty.values()].sort((a, b) =>
			a.cx === b.cx ? a.cz - b.cz : a.cx - b.cx,
		)
		let count = 0
		for (const entry of entries) {
			if (count >= capacity) break
			out[count * 3] = entry.cx
			out[count * 3 + 1] = entry.cz
			out[count * 3 + 2] = entry.mask
			dirty.delete(dirtyKey(entry.cx, entry.cz))
			events?.emit(EVENT.LightUpdated, {
				cx: entry.cx,
				cz: entry.cz,
				sectionMask: entry.mask,
			})
			count++
		}
		return count
	}

	return {
		seedChunk,
		reseedChunk: (cx: number, cz: number): void => seedChunk(cx, cz, true),
		stitchBoundaries,
		onBlockChanged,
		step,
		drainDirtySections,
		drain,
		get pending(): number {
			return (
				skyChannel.remove.size +
				blockChannel.remove.size +
				skyChannel.add.size +
				blockChannel.add.size
			)
		},
		sample: (x: number, y: number, z: number): LightSample => ({
			sky: skyChannel.get(x, y, z),
			block: blockChannel.get(x, y, z),
		}),
		seedAll: (passes: number = 2): void => {
			for (const chunk of world.orderedChunks()) seedChunk(chunk.cx, chunk.cz)
			stitchBoundaries(passes)
		},
	}
}

/** `SystemFn` spending one tick of the light budget. Registered by sim-a. */
export function lightCreateSystem(
	engine: LightEngine,
	budgetOps: number = PERF.lightOpsPerTick,
): SystemFn {
	return (_world, _dt, _tick) => {
		engine.step(budgetOps)
	}
}

/** Entry for the `light` slot of the contract's `SYSTEM_ORDER`. */
export function lightSystemEntry(
	engine: LightEngine,
	budgetOps: number = PERF.lightOpsPerTick,
): SystemEntry {
	return { name: LIGHT_SYSTEM_NAME, fn: lightCreateSystem(engine, budgetOps) }
}
