/**
 * Water and lava flow (`fluid` subtree, owner sim-b).
 *
 * - `computeFluidAt` is a pure function of the neighbourhood: it only reads the
 *   world and always returns a fresh `FluidState`, so the same input gives the
 *   same output and nothing is mutated.
 * - Levels run from 0 (source) to `FLUID_MAX_LEVEL`, one byte per voxel through
 *   `packFluid` / `unpackFluid`. A voxel pulls its state from its neighbours:
 *   anything above pours straight down (`falling`), otherwise the state is the
 *   cheapest horizontal neighbour plus one level. Above `FLUID_MAX_LEVEL` the
 *   fluid simply stops, which is also how it drains once a source is removed.
 * - A voxel that can pour downwards never spreads sideways, and a voxel that
 *   can only spread sideways prefers the directions that lead to the closest
 *   hole within `FLUID_TICKS.downhillSearchRadius`. Both rules depend on blocks
 *   only, never on fluid levels, so the level field is monotone per cell and the
 *   simulation converges instead of oscillating.
 * - The fluid byte and the block id are kept in sync (review R-04). A cell that
 *   gains fluid over AIR also gets `BLOCK.WATER_FLOWING` / `BLOCK.LAVA_FLOWING`,
 *   a draining cell goes back to `BLOCK.AIR`, and both writes are announced with
 *   `EVENT.BlockChanged`. Flowing lava is therefore a real light source: the
 *   light engine reads emission from the block id and `simBlockProps` gives
 *   `LAVA_FLOWING` the same `MAX_LIGHT` emission as `LAVA`. A source block keeps
 *   its own id, and any other replaceable block (a plant, say) is left alone, so
 *   the engine only ever writes AIR and the two flowing ids.
 * - Water touching lava solidifies the lava: a lava source turns into obsidian,
 *   flowing lava into cobblestone. That is a block edit, so it is applied by
 *   `tick` (through `EVENT.BlockChanged`) and kept out of the pure computation.
 * - Updates are scheduled into a `FLUID_TICKS.buckets` ring with the per kind
 *   delay (`FLUID_TICKS.water` / `FLUID_TICKS.lava`). One tick examines at most
 *   `budgetCells` voxels (`PERF.fluidCellsPerTick`); the rest keeps its order
 *   and is carried to the next tick.
 * - Cost control (review R-03), all of it behaviour preserving:
 *     * integer cell keys instead of `Set<string>` and template literals;
 *     * the downhill search solves one padded tile of a y plane at a time and
 *       keeps it until a block edit can change what a cell holds, so a
 *       saturated tick searches each tile once instead of each cell sixteen
 *       times;
 *     * a cell with no fluid in itself or in any face neighbour is skipped
 *       before the downhill search runs, because `applyCell` provably cannot
 *       change it;
 *     * `tick` walks the carry over and the due bucket in place instead of
 *       rebuilding them with `concat` / `slice`.
 *   `lastTickStats` exposes the per tick work counters those bounds are about.
 * - Every constant comes from `@voxelcraft/core-types`. Nothing here is random
 *   or time dependent.
 */
import {
	BLOCK,
	CHUNK_X,
	CHUNK_Y,
	CHUNK_Z,
	EVENT,
	FACE,
	FACE_DIRS,
	FLUID,
	FLUID_EMPTY,
	FLUID_MAX_LEVEL,
	FLUID_TICKS,
	OPPOSITE_FACE,
	PERF,
	blockIndex,
	packFluid,
	worldToChunk,
	worldToLocal,
} from '@voxelcraft/core-types'
import type {
	BlockId,
	ChunkData,
	EventBus,
	FluidEngine,
	FluidKind,
	FluidState,
	SystemEntry,
	SystemFn,
	Tick,
} from '@voxelcraft/core-types'
import { simBlockProps } from '../shared/blockProps'
import type { SimVoxelWorld } from '../shared/voxelWorld'

/** Name of this system inside the contract's `SYSTEM_ORDER`. */
export const FLUID_SYSTEM_NAME = 'fluid'

/** Horizontal faces, in canonical `FACE` order. */
const HORIZONTAL: readonly number[] = [FACE.NegX, FACE.PosX, FACE.NegZ, FACE.PosZ]

/**
 * Integer cell keys: 21 bits of x, 21 bits of z and 8 bits of y. Bijective for
 * |x|, |z| < 2^20 and bounded by 2^50, so every key stays an exact integer.
 */
const KEY_MASK = 0x1fffff
const KEY_SPAN = KEY_MASK + 1
const KEY_Y_SPAN = 256

const planeKey = (x: number, z: number): number => (x & KEY_MASK) * KEY_SPAN + (z & KEY_MASK)

const cellKey = (x: number, y: number, z: number): number => planeKey(x, z) * KEY_Y_SPAN + y

/** Memo entries kept before a cache is dropped wholesale. Bounds memory. */
const MEMO_LIMIT = 1 << 16

/**
 * Hole distances are solved for a whole tile of a y plane at a time. The tile is
 * padded by the search radius, so an answer inside the tile is exactly the
 * answer a search started at that voxel would give: no path of at most
 * `HOLE_STEP_MAX` steps can leave the window.
 */
const TILE_SHIFT = 4
const TILE_SIZE = 1 << TILE_SHIFT
const HOLE_RADIUS = FLUID_TICKS.downhillSearchRadius
const HOLE_STEP_MAX = HOLE_RADIUS - 1
const TILE_PAD = HOLE_RADIUS
const TILE_SPAN = TILE_SIZE + TILE_PAD * 2
const TILE_CELLS = TILE_SPAN * TILE_SPAN

/** Step count standing for "no hole within the search radius". */
const HOLE_FAR = 255

/** Hole fields kept before the cache is dropped wholesale. Bounds memory. */
const TILE_LIMIT = 1024

/** A voxel can hold fluid when it is neither solid nor protected. */
export function fluidCanHold(id: BlockId): boolean {
	const props = simBlockProps(id)
	return !props.solid && props.replaceable
}

/** Source kind implied by a placed source block, or `FLUID.None`. */
export function fluidSourceKindOf(id: BlockId): FluidKind {
	if (id === BLOCK.WATER) return FLUID.Water
	if (id === BLOCK.LAVA) return FLUID.Lava
	return FLUID.None
}

/** Block id that represents flowing `kind`, or `BLOCK.AIR` for `FLUID.None`. */
export function fluidFlowingBlockOf(kind: FluidKind): BlockId {
	if (kind === FLUID.Water) return BLOCK.WATER_FLOWING
	if (kind === FLUID.Lava) return BLOCK.LAVA_FLOWING
	return BLOCK.AIR
}

/** True for the two ids the engine writes and clears itself. */
export function fluidIsFlowingBlock(id: BlockId): boolean {
	return id === BLOCK.WATER_FLOWING || id === BLOCK.LAVA_FLOWING
}

const kindOfByte = (packed: number): FluidKind => ((packed >>> 4) & 3) as FluidKind

const emptyState = (): FluidState => ({ kind: FLUID.None, level: 0, falling: false })

/** Work counters of one `tick`. Deterministic for a given world and budget. */
export interface FluidTickStats {
	/** Cells taken off the due list. Never above the tick's `budgetCells`. */
	readonly examined: number
	/** Cells whose fluid byte or block id actually changed. */
	readonly applied: number
	/** Cells the "cannot change" pre-check dropped before any search. */
	readonly skipped: number
	/** Hole distance fields solved this tick, i.e. real search work. */
	readonly holeFields: number
	/** Flow direction evaluations that missed the memo. */
	readonly flowFaceMisses: number
}

export interface FluidEngineOptions {
	world: SimVoxelWorld
	/** Optional bus for `EVENT.FluidChanged` and `EVENT.BlockChanged`. */
	events?: EventBus
}

export interface FluidEngineInstance extends FluidEngine {
	/** Voxels waiting in the delay ring (plus the budget carry over). */
	readonly pending: number
	/** Work counters of the most recent `tick`. */
	readonly lastTickStats: FluidTickStats
	/** Ticks forward from `startTick` until nothing is scheduled. Returns ticks run. */
	settle(startTick?: Tick, maxTicks?: number, budgetCells?: number): number
	/** Block that a water/lava contact turns this voxel into, or `null`. */
	interactionAt(x: number, y: number, z: number): BlockId | null
	/** Schedules every fluid bearing voxel of every loaded chunk. */
	scheduleAll(): void
}

export function fluidCreateEngine(options: FluidEngineOptions): FluidEngineInstance {
	const world = options.world
	const events = options.events
	const buckets: number[][] = Array.from({ length: FLUID_TICKS.buckets }, () => [])
	const scheduled: Array<Set<number>> = Array.from(
		{ length: FLUID_TICKS.buckets },
		() => new Set<number>(),
	)
	let carry: number[] = []
	let currentTick = 0

	let examined = 0
	let applied = 0
	let skipped = 0
	let holeFields = 0
	let flowFaceMisses = 0

	const inColumn = (y: number): boolean => y >= 0 && y < CHUNK_Y

	// Block and fluid reads. Same semantics as `SimVoxelWorld.getBlock` and
	// `getFluid` (out of range y and unloaded chunks read as air, a fluid block
	// with no byte reads as its own source byte), but without rebuilding a
	// `chunkKey` string per voxel: the last chunk is remembered, and the cache
	// holds the very `ChunkData` the world writes into, so it can never serve a
	// stale block. It is dropped at every tick boundary and whenever the set of
	// loaded chunks changes.
	let cachedChunk: ChunkData | undefined
	let cachedCx = 0
	let cachedCz = 0
	let chunkCount = -1

	const chunkAt = (x: number, z: number): ChunkData | undefined => {
		const cx = worldToChunk(x)
		const cz = worldToChunk(z)
		if (cachedChunk !== undefined && cachedCx === cx && cachedCz === cz) return cachedChunk
		const chunk = world.getChunk(cx, cz)
		if (chunk === undefined) return undefined
		cachedChunk = chunk
		cachedCx = cx
		cachedCz = cz
		return chunk
	}

	const blockAt = (x: number, y: number, z: number): BlockId => {
		if (!inColumn(y)) return BLOCK.AIR
		const chunk = chunkAt(x, z)
		if (chunk === undefined) return BLOCK.AIR
		return chunk.blocks[blockIndex(worldToLocal(x), y, worldToLocal(z))]
	}

	const fluidByteAt = (x: number, y: number, z: number): number => {
		if (!inColumn(y)) return FLUID_EMPTY
		const chunk = chunkAt(x, z)
		if (chunk === undefined) return FLUID_EMPTY
		const index = blockIndex(worldToLocal(x), y, worldToLocal(z))
		const packed = chunk.fluids[index]
		if (packed !== FLUID_EMPTY) return packed
		const kind = simBlockProps(chunk.blocks[index]).fluid
		if (kind === FLUID.None) return FLUID_EMPTY
		return packFluid({ kind, level: 0, falling: false })
	}

	const canHoldAt = (x: number, y: number, z: number): boolean =>
		inColumn(y) && fluidCanHold(blockAt(x, y, z))

	// Downhill search caches. Both answer "what does the block layout allow
	// here", so they survive fluid writes and are only dropped when a block edit
	// can change `fluidCanHold` somewhere. Writing a flowing id over AIR, or
	// clearing it again, never can: both hold fluid.
	const tileFields = new Map<number, Uint8Array>()
	const faceMemo = new Map<number, number>()

	const invalidateTopology = (): void => {
		tileFields.clear()
		faceMemo.clear()
		cachedChunk = undefined
	}

	const refreshReadCaches = (): void => {
		cachedChunk = undefined
		if (chunkCount === world.chunks.size) return
		chunkCount = world.chunks.size
		tileFields.clear()
		faceMemo.clear()
	}

	const tileHoldable = new Uint8Array(TILE_CELLS)
	const tileQueue = new Int32Array(TILE_CELLS)

	/**
	 * Multi source breadth first search, inside one padded tile of a y plane,
	 * starting from every voxel that can drop its fluid into the voxel below.
	 *
	 * One tile costs about as much as four of the per voxel searches it replaces
	 * and then answers up to `TILE_SIZE * TILE_SIZE` of them, which is what keeps
	 * a saturated region inside the tick budget.
	 */
	const buildHoleField = (tx: number, tz: number, y: number): Uint8Array => {
		holeFields++
		const baseX = tx * TILE_SIZE - TILE_PAD
		const baseZ = tz * TILE_SIZE - TILE_PAD
		const field = new Uint8Array(TILE_CELLS).fill(HOLE_FAR)
		let tail = 0
		for (let ix = 0; ix < TILE_SPAN; ix++) {
			for (let iz = 0; iz < TILE_SPAN; iz++) {
				const at = ix * TILE_SPAN + iz
				const wx = baseX + ix
				const wz = baseZ + iz
				const holdable = canHoldAt(wx, y, wz)
				tileHoldable[at] = holdable ? 1 : 0
				if (holdable && canHoldAt(wx, y - 1, wz)) {
					field[at] = 0
					tileQueue[tail++] = at
				}
			}
		}
		for (let head = 0; head < tail; head++) {
			const at = tileQueue[head]
			const next = field[at] + 1
			if (next > HOLE_STEP_MAX) continue
			const ix = (at / TILE_SPAN) | 0
			const iz = at - ix * TILE_SPAN
			if (ix > 0) {
				const n = at - TILE_SPAN
				if (tileHoldable[n] === 1 && field[n] > next) {
					field[n] = next
					tileQueue[tail++] = n
				}
			}
			if (ix + 1 < TILE_SPAN) {
				const n = at + TILE_SPAN
				if (tileHoldable[n] === 1 && field[n] > next) {
					field[n] = next
					tileQueue[tail++] = n
				}
			}
			if (iz > 0) {
				const n = at - 1
				if (tileHoldable[n] === 1 && field[n] > next) {
					field[n] = next
					tileQueue[tail++] = n
				}
			}
			if (iz + 1 < TILE_SPAN) {
				const n = at + 1
				if (tileHoldable[n] === 1 && field[n] > next) {
					field[n] = next
					tileQueue[tail++] = n
				}
			}
		}
		return field
	}

	/**
	 * Steps through the same y plane, over voxels that can hold fluid, to the
	 * closest hole, plus one. Depends on blocks only, so the allowed flow
	 * directions stay fixed while the fluid moves.
	 */
	const holeDistanceFrom = (x: number, y: number, z: number): number => {
		if (!canHoldAt(x, y, z)) return Number.POSITIVE_INFINITY
		if (canHoldAt(x, y - 1, z)) return 1
		const tx = x >> TILE_SHIFT
		const tz = z >> TILE_SHIFT
		const key = cellKey(tx, y, tz)
		let field = tileFields.get(key)
		if (field === undefined) {
			if (tileFields.size >= TILE_LIMIT) tileFields.clear()
			field = buildHoleField(tx, tz, y)
			tileFields.set(key, field)
		}
		const ix = x - (tx * TILE_SIZE - TILE_PAD)
		const iz = z - (tz * TILE_SIZE - TILE_PAD)
		const steps = field[ix * TILE_SPAN + iz]
		return steps === HOLE_FAR ? Number.POSITIVE_INFINITY : steps + 1
	}

	/** Bit mask, by `FACE` index, of the faces this voxel may spread to. */
	const flowFaceMask = (x: number, y: number, z: number): number => {
		const key = cellKey(x, y, z)
		const cached = faceMemo.get(key)
		if (cached !== undefined) return cached
		flowFaceMisses++
		let best = Number.POSITIVE_INFINITY
		for (const face of HORIZONTAL) {
			const dir = FACE_DIRS[face]
			const distance = holeDistanceFrom(x + dir.x, y, z + dir.z)
			if (distance < best) best = distance
		}
		const all = !Number.isFinite(best)
		let mask = 0
		for (const face of HORIZONTAL) {
			const dir = FACE_DIRS[face]
			if (all || holeDistanceFrom(x + dir.x, y, z + dir.z) === best) mask |= 1 << face
		}
		if (faceMemo.size >= MEMO_LIMIT) faceMemo.clear()
		faceMemo.set(key, mask)
		return mask
	}

	/**
	 * Pure: reads the neighbourhood and returns the state this voxel should hold.
	 * No writes, no scheduling, no hidden state.
	 */
	const computeFluidAt = (x: number, y: number, z: number): FluidState => {
		if (!inColumn(y)) return emptyState()
		const id = blockAt(x, y, z)
		const own = fluidSourceKindOf(id)
		if (own !== FLUID.None) return { kind: own, level: 0, falling: false }
		if (!fluidCanHold(id)) return emptyState()

		// Anything above pours straight down; a falling voxel acts like a source.
		if (inColumn(y + 1)) {
			const above = kindOfByte(fluidByteAt(x, y + 1, z))
			if (above !== FLUID.None) return { kind: above, level: 0, falling: true }
		}

		let bestKind: FluidKind = FLUID.None
		let bestLevel = FLUID_MAX_LEVEL + 1
		for (const face of HORIZONTAL) {
			const dir = FACE_DIRS[face]
			const nx = x + dir.x
			const nz = z + dir.z
			const neighbour = fluidByteAt(nx, y, nz)
			const kind = kindOfByte(neighbour)
			if (kind === FLUID.None) continue
			// A voxel that can pour downwards does not spread sideways.
			if (canHoldAt(nx, y - 1, nz)) continue
			const isSource = fluidSourceKindOf(blockAt(nx, y, nz)) !== FLUID.None
			const falling = (neighbour & 8) !== 0
			if (!isSource && !falling) {
				if (((flowFaceMask(nx, y, nz) >>> OPPOSITE_FACE[face]) & 1) === 0) continue
			}
			const candidate = (isSource || falling ? 0 : neighbour & 7) + 1
			if (candidate > FLUID_MAX_LEVEL) continue
			const better =
				candidate < bestLevel ||
				(candidate === bestLevel && bestKind === FLUID.Lava && kind === FLUID.Water)
			if (!better) continue
			bestKind = kind
			bestLevel = candidate
		}
		if (bestKind === FLUID.None) return emptyState()
		return { kind: bestKind, level: bestLevel, falling: false }
	}

	const bucketIndex = (at: number): number =>
		((at % FLUID_TICKS.buckets) + FLUID_TICKS.buckets) % FLUID_TICKS.buckets

	/** Delay implied by the fluid a voxel holds. Empty cells behave like water. */
	const delayAt = (x: number, y: number, z: number): number =>
		kindOfByte(fluidByteAt(x, y, z)) === FLUID.Lava ? FLUID_TICKS.lava : FLUID_TICKS.water

	/**
	 * Enqueues one voxel into the delay ring. The delay is clamped to
	 * `FLUID_TICKS.maxDelay`, which is strictly below `FLUID_TICKS.buckets`, so a
	 * voxel scheduled while its own bucket is being drained always lands in a
	 * later bucket and can never be processed twice within one tick.
	 */
	const schedule = (x: number, y: number, z: number, delay: number): void => {
		if (!inColumn(y)) return
		const clamped = Math.max(1, Math.min(FLUID_TICKS.maxDelay, Math.floor(delay)))
		const index = bucketIndex(currentTick + clamped)
		const key = cellKey(x, y, z)
		const seen = scheduled[index]
		if (seen.has(key)) return
		seen.add(key)
		buckets[index].push(x, y, z)
	}

	/** Schedules this voxel and its 6 face neighbours. */
	const scheduleAround = (x: number, y: number, z: number): void => {
		schedule(x, y, z, delayAt(x, y, z))
		for (const dir of FACE_DIRS) {
			const nx = x + dir.x
			const ny = y + dir.y
			const nz = z + dir.z
			schedule(nx, ny, nz, delayAt(nx, ny, nz))
		}
	}

	/**
	 * Contract entry point: re-evaluate this voxel and its 6 face neighbours. A
	 * caller reaching for this may have edited a block, which can change what the
	 * neighbourhood holds, so the downhill memo is dropped here. The engine's own
	 * fluid writes use `scheduleAround` and keep it.
	 */
	const onNeighborChanged = (x: number, y: number, z: number): void => {
		invalidateTopology()
		scheduleAround(x, y, z)
	}

	/**
	 * Water meeting lava turns the lava into stone: a source becomes obsidian, a
	 * flowing voxel becomes cobblestone. This is a lookup only, the block edit is
	 * applied by `tick`, which keeps `computeFluidAt` pure.
	 */
	const interactionAt = (x: number, y: number, z: number): BlockId | null => {
		const here = fluidByteAt(x, y, z)
		if (kindOfByte(here) !== FLUID.Lava) return null
		for (const dir of FACE_DIRS) {
			if (kindOfByte(fluidByteAt(x + dir.x, y + dir.y, z + dir.z)) !== FLUID.Water) continue
			// Level 0 and not falling, i.e. a source: the low nibble carries both.
			return (here & 0x0f) === 0 ? BLOCK.OBSIDIAN : BLOCK.COBBLESTONE
		}
		return null
	}

	/**
	 * Block id a cell should carry while it holds `kind`. Sources keep their own
	 * id, AIR and the flowing ids follow the fluid, and any other replaceable
	 * block is left untouched so the engine only owns the ids it writes.
	 */
	const blockForFluid = (id: BlockId, kind: FluidKind): BlockId => {
		if (fluidSourceKindOf(id) !== FLUID.None) return id
		if (kind === FLUID.None) return fluidIsFlowingBlock(id) ? BLOCK.AIR : id
		if (id === BLOCK.AIR || fluidIsFlowingBlock(id)) return fluidFlowingBlockOf(kind)
		return id
	}

	/**
	 * Cheap pre-check. An empty cell whose 6 face neighbours are all empty has
	 * nothing to drain and nothing to receive, so `computeFluidAt` returns empty
	 * and `interactionAt` returns null: `applyCell` would provably be a no-op.
	 * Skipping it keeps the downhill search off the many empty cells that every
	 * single change schedules.
	 */
	const canChange = (x: number, y: number, z: number): boolean => {
		if (fluidByteAt(x, y, z) !== FLUID_EMPTY) return true
		for (const dir of FACE_DIRS) {
			if (fluidByteAt(x + dir.x, y + dir.y, z + dir.z) !== FLUID_EMPTY) return true
		}
		return false
	}

	/** Brings one voxel to the state `computeFluidAt` prescribes. Did it change? */
	const applyCell = (x: number, y: number, z: number): boolean => {
		if (!inColumn(y)) return false
		const solidified = interactionAt(x, y, z)
		if (solidified !== null) {
			const before = blockAt(x, y, z)
			world.setFluid(x, y, z, FLUID_EMPTY)
			world.setBlock(x, y, z, solidified)
			// A solid block changes what this cell can hold.
			invalidateTopology()
			events?.emit(EVENT.FluidChanged, { x, y, z, packed: FLUID_EMPTY })
			events?.emit(EVENT.BlockChanged, { x, y, z, before, after: solidified })
			scheduleAround(x, y, z)
			return true
		}
		const current = fluidByteAt(x, y, z)
		const next = computeFluidAt(x, y, z)
		const packed = next.kind === FLUID.None ? FLUID_EMPTY : packFluid(next)
		const before = blockAt(x, y, z)
		const after = blockForFluid(before, next.kind)
		if (packed === current && after === before) return false
		if (packed === FLUID_EMPTY) {
			// Block first: while a flowing id is still in place, an empty byte would
			// read back as a source byte.
			if (after !== before) world.setBlock(x, y, z, after)
			world.setFluid(x, y, z, FLUID_EMPTY)
		} else {
			world.setFluid(x, y, z, packed)
			if (after !== before) world.setBlock(x, y, z, after)
		}
		events?.emit(EVENT.FluidChanged, { x, y, z, packed })
		if (after !== before) events?.emit(EVENT.BlockChanged, { x, y, z, before, after })
		scheduleAround(x, y, z)
		return true
	}

	const pendingCount = (): number => {
		let total = carry.length
		for (const bucket of buckets) total += bucket.length
		return total / 3
	}

	const examine = (x: number, y: number, z: number): void => {
		examined++
		if (!canChange(x, y, z)) {
			skipped++
			return
		}
		if (applyCell(x, y, z)) applied++
	}

	/**
	 * Processes the voxels due at `now`, carry over first. At most `budgetCells`
	 * voxels are examined, which is the hard per tick cap; leftovers keep their
	 * order and move to the next tick, so the budget only changes how many ticks
	 * the simulation needs, never the state it converges to.
	 */
	const tick = (now: Tick, budgetCells: number): number => {
		currentTick = now
		examined = 0
		applied = 0
		skipped = 0
		holeFields = 0
		flowFaceMisses = 0
		refreshReadCaches()
		const budget = Math.max(0, Math.floor(budgetCells))
		if (budget === 0) return 0
		const index = bucketIndex(now)
		const held = carry
		const due = buckets[index]
		carry = []
		buckets[index] = []
		scheduled[index].clear()
		let heldCursor = 0
		let dueCursor = 0
		while (heldCursor < held.length && examined < budget) {
			examine(held[heldCursor], held[heldCursor + 1], held[heldCursor + 2])
			heldCursor += 3
		}
		while (dueCursor < due.length && examined < budget) {
			examine(due[dueCursor], due[dueCursor + 1], due[dueCursor + 2])
			dueCursor += 3
		}
		if (heldCursor < held.length || dueCursor < due.length) {
			const rest: number[] = []
			for (let i = heldCursor; i < held.length; i++) rest.push(held[i])
			for (let i = dueCursor; i < due.length; i++) rest.push(due[i])
			carry = rest
		}
		return examined
	}

	/**
	 * Schedules every fluid bearing voxel, and its neighbours, of every chunk. A
	 * fluid block whose byte was never written counts as fluid bearing, so a world
	 * restored from block ids alone still gets its levels rebuilt.
	 */
	const scheduleAll = (): void => {
		invalidateTopology()
		for (const chunk of world.orderedChunks()) {
			const baseX = chunk.cx * CHUNK_X
			const baseZ = chunk.cz * CHUNK_Z
			for (let lz = 0; lz < CHUNK_Z; lz++) {
				for (let lx = 0; lx < CHUNK_X; lx++) {
					for (let y = 0; y < CHUNK_Y; y++) {
						const at = blockIndex(lx, y, lz)
						if (
							chunk.fluids[at] === FLUID_EMPTY &&
							simBlockProps(chunk.blocks[at]).fluid === FLUID.None
						) {
							continue
						}
						scheduleAround(baseX + lx, y, baseZ + lz)
					}
				}
			}
		}
	}

	const settle = (
		startTick: Tick = 0,
		maxTicks: number = 4096,
		budgetCells: number = PERF.fluidCellsPerTick,
	): number => {
		let ticks = 0
		let at = startTick
		while (ticks < maxTicks && pendingCount() > 0) {
			tick(at, budgetCells)
			at++
			ticks++
		}
		return ticks
	}

	return {
		onNeighborChanged,
		computeFluidAt,
		tick,
		settle,
		interactionAt,
		scheduleAll,
		get pending(): number {
			return pendingCount()
		},
		get lastTickStats(): FluidTickStats {
			return { examined, applied, skipped, holeFields, flowFaceMisses }
		},
	}
}

/** `SystemFn` spending one tick of the fluid budget. Registered by sim-a. */
export function fluidCreateSystem(
	engine: FluidEngine,
	budgetCells: number = PERF.fluidCellsPerTick,
): SystemFn {
	return (_world, _dt, now) => {
		engine.tick(now, budgetCells)
	}
}

/** Entry for the `fluid` slot of the contract's `SYSTEM_ORDER`. */
export function fluidSystemEntry(
	engine: FluidEngine,
	budgetCells: number = PERF.fluidCellsPerTick,
): SystemEntry {
	return { name: FLUID_SYSTEM_NAME, fn: fluidCreateSystem(engine, budgetCells) }
}
