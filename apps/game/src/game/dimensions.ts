/**
 * The dimensions this app can be in, and travel between them.
 *
 * Every dimension owns one `ChunkWorld`, i.e. its own generator, voxels, light
 * and fluids. The rules of travel are not reimplemented here: the state machine
 * of `@voxelcraft/sim` owns contact detection, the travel delay, the cooldown,
 * the 1:8 coordinate scale and the link cache. This module only supplies
 *  - a dimension registry backed by those ChunkWorlds, so both see one store,
 *  - a terrain access that generates the destination column before an entity
 *    is put there,
 *  - the fallback that erects a frame when the far side has no portal yet.
 *
 * Frames are written through `ChunkWorld.setBlock` rather than with
 * `portalTravelBuildFrame`, which writes straight into the `SimVoxelWorld`:
 * going through the ChunkWorld keeps dirty sections, the light update and the
 * save bookkeeping correct, and the layout is the contract's
 * `PORTAL.minInnerWidth` x `PORTAL.minInnerHeight` opening either way.
 *
 * Only the Overworld is persisted. The Nether is a pure function of the seed,
 * so it is regenerated on load instead of stored.
 */
import {
	BLOCK,
	BLOCK_V2,
	CHUNK_Y,
	DIMENSION,
	PORTAL,
	type DimensionId,
	type EntityId,
	type EventBusV2,
	type Vec3i,
} from '@voxelcraft/core-types'
import {
	dimCreateRegistry,
	dimParamsOf,
	portalTravelCreate,
	type DimTerrainAccess,
	type PortalTravelInstance,
	type PortalTravelResult,
	type SimEcsWorld,
} from '@voxelcraft/sim'
import { BLOCKS_V2 } from '../registries'
import { ChunkWorld, type ChunkStoreSource } from '../world/chunkWorld'

const LABELS: Readonly<Record<number, string>> = {
	[DIMENSION.Overworld]: 'Overworld',
	[DIMENSION.Nether]: 'Nether',
}

/** Voxels of air a landing spot needs above it: the player is two tall. */
const LANDING_CLEARANCE = 2

export interface DimensionOptions {
	seed: number
	ecs: SimEcsWorld
	events: EventBusV2
	/** Entity portal travel tracks, i.e. the player. */
	entity: EntityId
	/** Save source for the Overworld. */
	source?: ChunkStoreSource
	/**
	 * World the app already built for the Overworld, so restored saves stay
	 * authoritative. A missing one is created from the seed.
	 */
	overworld?: ChunkWorld
	/** Called after voxels were written, so the app can resync its meshes. */
	onWorldEdited?: (dimension: DimensionId) => void
}

export interface DimensionRuntime {
	worldOf(dimension: DimensionId): ChunkWorld
	/** Dimension the tracked entity is in. */
	readonly current: DimensionId
	/** World of `current`. */
	readonly world: ChunkWorld
	readonly travel: PortalTravelInstance
	label(dimension?: DimensionId): string
	/** Advances travel by one tick and returns the transitions that happened. */
	tick(): PortalTravelResult[]
	/** Tracks the entity in `dimension` again, e.g. after loading a save. */
	enter(dimension: DimensionId): void
	/** Erects a frame whose opening starts at `base`. Returns its anchor. */
	buildFrame(dimension: DimensionId, base: Vec3i): Vec3i
}

function isPassable(world: ChunkWorld, x: number, y: number, z: number): boolean {
	const id = world.blockAt(x, y, z)
	return id === BLOCK.AIR || !BLOCKS_V2.isSolid(id)
}

/**
 * First spot at `x, z` with solid ground and `LANDING_CLEARANCE` free voxels
 * above it, searched outwards from `preferredY`. `null` when the column is full.
 */
function landingY(
	world: ChunkWorld,
	dimension: DimensionId,
	x: number,
	z: number,
	preferredY: number,
): number | null {
	const ceiling = Math.min(Math.floor(dimParamsOf(dimension).ceilingY), CHUNK_Y - 1)
	const top = Math.max(1, ceiling - LANDING_CLEARANCE)
	const start = Math.max(1, Math.min(Math.floor(preferredY), top))
	for (let offset = 0; offset <= top; offset++) {
		for (const y of [start - offset, start + offset]) {
			if (y < 1 || y > top) continue
			if (!BLOCKS_V2.isSolid(world.blockAt(x, y - 1, z))) continue
			let free = true
			for (let dy = 0; dy < LANDING_CLEARANCE; dy++) {
				if (!isPassable(world, x, y + dy, z)) free = false
			}
			if (free) return y
		}
	}
	return null
}

export function createDimensions(options: DimensionOptions): DimensionRuntime {
	const worlds = new Map<DimensionId, ChunkWorld>()
	if (options.overworld !== undefined) worlds.set(DIMENSION.Overworld, options.overworld)
	let current: DimensionId = DIMENSION.Overworld

	const worldOf = (dimension: DimensionId): ChunkWorld => {
		const existing = worlds.get(dimension)
		if (existing !== undefined) return existing
		const created = new ChunkWorld({
			seed: options.seed,
			dimension,
			source: dimension === DIMENSION.Overworld ? options.source : undefined,
		})
		worlds.set(dimension, created)
		return created
	}

	const buildFrame = (dimension: DimensionId, base: Vec3i): Vec3i => {
		const world = worldOf(dimension)
		world.ensureColumnAt(base.x, base.z)
		for (let dx = -1; dx <= PORTAL.minInnerWidth; dx++) {
			for (let dy = -1; dy <= PORTAL.minInnerHeight; dy++) {
				const y = base.y + dy
				if (y < 0 || y >= CHUNK_Y) continue
				const inside = dx >= 0 && dx < PORTAL.minInnerWidth && dy >= 0 && dy < PORTAL.minInnerHeight
				world.setBlock(base.x + dx, y, base.z, inside ? BLOCK_V2.NETHER_PORTAL : PORTAL.frameBlock)
			}
		}
		options.onWorldEdited?.(dimension)
		return { x: base.x, y: base.y, z: base.z }
	}

	// One runtime per dimension of the contract, over the ChunkWorld voxels so
	// the simulation and the renderer never disagree about a chunk.
	const registry = dimCreateRegistry({
		createWorld: (dimension) => worldOf(dimension).voxels,
	})

	const terrain: DimTerrainAccess = {
		ensureColumn: (dimension, x, z) => {
			worldOf(dimension).ensureColumnAt(x, z)
		},
		safeLandingY: (dimension, x, z, preferredY) =>
			landingY(worldOf(dimension), dimension, x, z, preferredY),
	}

	const travel = portalTravelCreate({
		registry,
		ecs: options.ecs,
		events: options.events,
		terrain,
		onMissingLink: (request): Vec3i | null => {
			const world = worldOf(request.to)
			const x = Math.floor(request.at.x)
			const z = Math.floor(request.at.z)
			world.ensureColumnAt(x, z)
			const y = landingY(world, request.to, x, z, Math.floor(request.at.y))
			return buildFrame(request.to, { x, y: y ?? Math.floor(request.at.y), z })
		},
	})
	travel.place(options.entity, current)

	return {
		worldOf,
		get current(): DimensionId {
			return current
		},
		get world(): ChunkWorld {
			return worldOf(current)
		},
		travel,
		label: (dimension) => LABELS[dimension ?? current] ?? `Dimension ${dimension ?? current}`,
		tick(): PortalTravelResult[] {
			const results = travel.tick()
			const last = results[results.length - 1]
			if (last !== undefined) current = last.to
			return results
		},
		enter(dimension: DimensionId): void {
			current = dimension
			travel.place(options.entity, dimension)
		},
		buildFrame,
	}
}
