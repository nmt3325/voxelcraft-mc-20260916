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
 * - Water touching lava solidifies the lava: a lava source turns into obsidian,
 *   flowing lava into cobblestone. That is a block edit, so it is applied by
 *   `tick` (through `EVENT.BlockChanged`) and kept out of the pure computation.
 * - Updates are scheduled into a `FLUID_TICKS.buckets` ring with the per kind
 *   delay (`FLUID_TICKS.water` / `FLUID_TICKS.lava`). One tick processes at most
 *   `budgetCells` voxels (`PERF.fluidCellsPerTick`); the rest keeps its order
 *   and is carried to the next tick.
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
} from '@voxelcraft/core-types'
import type {
	BlockId,
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

const emptyState = (): FluidState => ({ kind: FLUID.None, level: 0, falling: false })

export interface FluidEngineOptions {
	world: SimVoxelWorld
	/** Optional bus for `EVENT.FluidChanged` and `EVENT.BlockChanged`. */
	events?: EventBus
}

export interface FluidEngineInstance extends FluidEngine {
	/** Voxels waiting in the delay ring (plus the budget carry over). */
	readonly pending: number
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
	const scheduled: Array<Set<string>> = Array.from(
		{ length: FLUID_TICKS.buckets },
		() => new Set<string>(),
	)
	let carry: number[] = []
	let currentTick = 0

	const inColumn = (y: number): boolean => y >= 0 && y < CHUNK_Y

	const canHoldAt = (x: number, y: number, z: number): boolean =>
		inColumn(y) && fluidCanHold(world.getBlock(x, y, z))

	/**
	 * Steps through the same y plane, over voxels that can hold fluid, to the
	 * closest hole. Depends on blocks only, so the allowed flow directions stay
	 * fixed while the fluid moves.
	 */
	const holeDistanceFrom = (x: number, y: number, z: number, radius: number): number => {
		if (!canHoldAt(x, y, z)) return Number.POSITIVE_INFINITY
		if (canHoldAt(x, y - 1, z)) return 1
		const visited = new Set<string>([`${x},${z}`])
		let frontier: number[] = [x, z]
		for (let distance = 2; distance <= radius; distance++) {
			const next: number[] = []
			for (let i = 0; i < frontier.length; i += 2) {
				for (const face of HORIZONTAL) {
					const dir = FACE_DIRS[face]
					const nx = frontier[i] + dir.x
					const nz = frontier[i + 1] + dir.z
					const key = `${nx},${nz}`
					if (visited.has(key)) continue
					visited.add(key)
					if (!canHoldAt(nx, y, nz)) continue
					if (canHoldAt(nx, y - 1, nz)) return distance
					next.push(nx, nz)
				}
			}
			if (next.length === 0) break
			frontier = next
		}
		return Number.POSITIVE_INFINITY
	}

	/** Faces this voxel may spread to: the closest downhill, else all four. */
	const flowFaces = (x: number, y: number, z: number): number[] => {
		const distances = HORIZONTAL.map((face) => {
			const dir = FACE_DIRS[face]
			return holeDistanceFrom(x + dir.x, y, z + dir.z, FLUID_TICKS.downhillSearchRadius)
		})
		let best = Number.POSITIVE_INFINITY
		for (const distance of distances) if (distance < best) best = distance
		if (!Number.isFinite(best)) return [...HORIZONTAL]
		return HORIZONTAL.filter((_face, index) => distances[index] === best)
	}

	/**
	 * Pure: reads the neighbourhood and returns the state this voxel should hold.
	 * No writes, no scheduling, no hidden state.
	 */
	const computeFluidAt = (x: number, y: number, z: number): FluidState => {
		if (!inColumn(y)) return emptyState()
		const id = world.getBlock(x, y, z)
		const own = fluidSourceKindOf(id)
		if (own !== FLUID.None) return { kind: own, level: 0, falling: false }
		if (!fluidCanHold(id)) return emptyState()

		// Anything above pours straight down; a falling voxel acts like a source.
		if (inColumn(y + 1)) {
			const above = world.fluidStateAt(x, y + 1, z)
			if (above.kind !== FLUID.None) return { kind: above.kind, level: 0, falling: true }
		}

		let bestKind: FluidKind = FLUID.None
		let bestLevel = FLUID_MAX_LEVEL + 1
		for (const face of HORIZONTAL) {
			const dir = FACE_DIRS[face]
			const nx = x + dir.x
			const nz = z + dir.z
			const neighbour = world.fluidStateAt(nx, y, nz)
			if (neighbour.kind === FLUID.None) continue
			// A voxel that can pour downwards does not spread sideways.
			if (canHoldAt(nx, y - 1, nz)) continue
			const isSource = fluidSourceKindOf(world.getBlock(nx, y, nz)) !== FLUID.None
			if (!isSource && !neighbour.falling) {
				if (!flowFaces(nx, y, nz).includes(OPPOSITE_FACE[face])) continue
			}
			const candidate = (isSource || neighbour.falling ? 0 : neighbour.level) + 1
			if (candidate > FLUID_MAX_LEVEL) continue
			const better =
				candidate < bestLevel ||
				(candidate === bestLevel &&
					bestKind === FLUID.Lava &&
					neighbour.kind === FLUID.Water)
			if (!better) continue
			bestKind = neighbour.kind
			bestLevel = candidate
		}
		if (bestKind === FLUID.None) return emptyState()
		return { kind: bestKind, level: bestLevel, falling: false }
	}

	const keyOf = (x: number, y: number, z: number): string => `${x},${y},${z}`

	const bucketIndex = (at: number): number =>
		((at % FLUID_TICKS.buckets) + FLUID_TICKS.buckets) % FLUID_TICKS.buckets

	/** Delay implied by the fluid a voxel holds. Empty cells behave like water. */
	const delayAt = (x: number, y: number, z: number): number =>
		world.fluidStateAt(x, y, z).kind === FLUID.Lava ? FLUID_TICKS.lava : FLUID_TICKS.water

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
		const key = keyOf(x, y, z)
		if (scheduled[index].has(key)) return
		scheduled[index].add(key)
		buckets[index].push(x, y, z)
	}

	/** Contract entry point: re-evaluate this voxel and its 6 face neighbours. */
	const onNeighborChanged = (x: number, y: number, z: number): void => {
		schedule(x, y, z, delayAt(x, y, z))
		for (const dir of FACE_DIRS) {
			const nx = x + dir.x
			const ny = y + dir.y
			const nz = z + dir.z
			schedule(nx, ny, nz, delayAt(nx, ny, nz))
		}
	}

	/**
	 * Water meeting lava turns the lava into stone: a source becomes obsidian, a
	 * flowing voxel becomes cobblestone. This is a lookup only, the block edit is
	 * applied by `tick`, which keeps `computeFluidAt` pure.
	 */
	const interactionAt = (x: number, y: number, z: number): BlockId | null => {
		const here = world.fluidStateAt(x, y, z)
		if (here.kind !== FLUID.Lava) return null
		for (const dir of FACE_DIRS) {
			if (world.fluidStateAt(x + dir.x, y + dir.y, z + dir.z).kind !== FLUID.Water) continue
			return here.level === 0 && !here.falling ? BLOCK.OBSIDIAN : BLOCK.COBBLESTONE
		}
		return null
	}

	/** Brings one voxel to the state `computeFluidAt` prescribes for it. */
	const applyCell = (x: number, y: number, z: number): void => {
		if (!inColumn(y)) return
		const solidified = interactionAt(x, y, z)
		if (solidified !== null) {
			const before = world.getBlock(x, y, z)
			world.setFluid(x, y, z, FLUID_EMPTY)
			world.setBlock(x, y, z, solidified)
			events?.emit(EVENT.FluidChanged, { x, y, z, packed: FLUID_EMPTY })
			events?.emit(EVENT.BlockChanged, { x, y, z, before, after: solidified })
			onNeighborChanged(x, y, z)
			return
		}
		const current = world.fluidStateAt(x, y, z)
		const next = computeFluidAt(x, y, z)
		const same =
			next.kind === current.kind &&
			next.level === current.level &&
			next.falling === current.falling
		if (same) return
		if (next.kind === FLUID.None) {
			const id = world.getBlock(x, y, z)
			if (id === BLOCK.WATER_FLOWING || id === BLOCK.LAVA_FLOWING) {
				world.setBlock(x, y, z, BLOCK.AIR)
			}
			world.setFluid(x, y, z, FLUID_EMPTY)
			events?.emit(EVENT.FluidChanged, { x, y, z, packed: FLUID_EMPTY })
		} else {
			const packed = packFluid(next)
			world.setFluid(x, y, z, packed)
			events?.emit(EVENT.FluidChanged, { x, y, z, packed })
		}
		onNeighborChanged(x, y, z)
	}

	const pendingCount = (): number => {
		let total = carry.length
		for (const bucket of buckets) total += bucket.length
		return total / 3
	}

	/**
	 * Processes the voxels due at `now`, carry over first. Leftovers keep their
	 * order and move to the next tick, so the budget only changes how many ticks
	 * the simulation needs, never the state it converges to.
	 */
	const tick = (now: Tick, budgetCells: number): number => {
		currentTick = now
		const budget = Math.max(0, Math.floor(budgetCells))
		if (budget === 0) return 0
		const index = bucketIndex(now)
		const due = carry.concat(buckets[index])
		carry = []
		buckets[index] = []
		scheduled[index].clear()
		let processed = 0
		let cursor = 0
		while (cursor < due.length && processed < budget) {
			applyCell(due[cursor], due[cursor + 1], due[cursor + 2])
			cursor += 3
			processed++
		}
		if (cursor < due.length) carry = due.slice(cursor)
		return processed
	}

	/** Schedules every fluid bearing voxel, and its neighbours, of every chunk. */
	const scheduleAll = (): void => {
		for (const chunk of world.orderedChunks()) {
			const baseX = chunk.cx * CHUNK_X
			const baseZ = chunk.cz * CHUNK_Z
			for (let lz = 0; lz < CHUNK_Z; lz++) {
				for (let lx = 0; lx < CHUNK_X; lx++) {
					for (let y = 0; y < CHUNK_Y; y++) {
						const at = blockIndex(lx, y, lz)
						if (
							chunk.fluids[at] === FLUID_EMPTY &&
							fluidSourceKindOf(chunk.blocks[at]) === FLUID.None
						) {
							continue
						}
						onNeighborChanged(baseX + lx, y, baseZ + lz)
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
