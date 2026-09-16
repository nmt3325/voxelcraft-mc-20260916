/**
 * Portal contact -> travel state machine plus the deterministic destination
 * linking helpers it needs.
 *
 * Rules, all timings taken from `PORTAL`:
 *  - contact ticks only accumulate while the entity occupies a
 *    `BLOCK_V2.NETHER_PORTAL` voxel and reset to 0 the moment it leaves;
 *  - travel fires on the tick the counter reaches `PORTAL.travelDelayTicks`
 *    while the cooldown is 0, and is rejected while the cooldown is non-zero
 *    even under uninterrupted contact;
 *  - a travel sets the cooldown to `PORTAL.cooldownTicks` and resets the
 *    counter. The cooldown loses one tick per tick starting on the tick after
 *    the travel, so it reaches 0 exactly `PORTAL.cooldownTicks` ticks later.
 *
 * Nothing here is random: the coordinate mapping, the link search order and the
 * frame builder are pure functions of their inputs.
 */
import {
	BLOCK_V2,
	CHUNK_Y,
	DIMENSION,
	DIMENSION_PARAMS,
	EVENT_V2,
	PARTICLE,
	PORTAL,
} from '@voxelcraft/core-types'
import type {
	DimensionId,
	EcsWorld,
	EntityId,
	EventBusV2,
	Vec3f,
	Vec3i,
} from '@voxelcraft/core-types'
import { Collider, Transform } from '../../ecs/components'
import type { TransformComp } from '../../ecs/components'
import type { SimVoxelWorld } from '../../shared/voxelWorld'
import type { DimRegistry } from './dimensionState'
import type { DimTerrainAccess } from './terrainAccess'

/** LOCAL constant, not in the contract: arrivals are centred in their voxel. */
const PORTAL_VOXEL_CENTER = 0.5

/** LOCAL tuning constant, not in the contract: particles spawned on arrival. */
export const DIM_PORTAL_PARTICLE_COUNT = 12

/** Dimension a portal in `from` leads to. */
export function portalTravelDestinationOf(from: DimensionId): DimensionId {
	return from === DIMENSION.Nether ? DIMENSION.Overworld : DIMENSION.Nether
}

/**
 * Maps one horizontal axis from `from` into `to`.
 *
 * Overworld -> Nether divides by the Nether `coordinateScale` and Nether ->
 * Overworld multiplies by it; writing it as the ratio of the two scales keeps
 * the two directions exactly inverse of each other.
 */
export function portalTravelScaleAxis(from: DimensionId, to: DimensionId, value: number): number {
	return (value * DIMENSION_PARAMS[from].coordinateScale) / DIMENSION_PARAMS[to].coordinateScale
}

/** Highest y an entity may occupy in `dimension`. */
export function portalTravelCeilingY(dimension: DimensionId): number {
	return Math.min(DIMENSION_PARAMS[dimension].ceilingY, CHUNK_Y - 1)
}

/** `y` is preserved across a transition, only clamped into the destination. */
export function portalTravelClampY(to: DimensionId, y: number): number {
	return Math.min(Math.max(y, 0), portalTravelCeilingY(to))
}

/**
 * Voxel a world coordinate falls into.
 *
 * Rounding rule for this whole subtree: `Math.floor`. It is monotone, has no
 * half-way case to break a tie on and treats negative coordinates exactly like
 * the voxel grid does, so a scaled position and the voxel it is looked up in
 * can never disagree.
 */
export function portalTravelVoxelOf(value: number): number {
	return Math.floor(value)
}

/**
 * Lowest portal voxel the entity's column occupies, or `null` when it touches
 * none. The column is scanned from the feet voxel up to the voxel holding the
 * top of the collider, so contact starts as soon as any part of the body is
 * inside the portal.
 */
export function portalTravelContactVoxel(
	world: SimVoxelWorld,
	position: Vec3f,
	height = 0,
): Vec3i | null {
	const x = portalTravelVoxelOf(position.x)
	const z = portalTravelVoxelOf(position.z)
	const bottom = portalTravelVoxelOf(position.y)
	const top = portalTravelVoxelOf(position.y + Math.max(0, height))
	for (let y = bottom; y <= top; y++) {
		if (world.getBlock(x, y, z) === BLOCK_V2.NETHER_PORTAL) return { x, y, z }
	}
	return null
}

/** Options of `portalTravelFindPortal`. */
export interface PortalTravelSearchOptions {
	/** Chebyshev radius in voxels. Defaults to `PORTAL.linkSearchRadius`. */
	radius?: number
	/** Lowest y considered. Defaults to 0. */
	minY?: number
	/** Highest y considered. Defaults to `CHUNK_Y - 1`. */
	maxY?: number
}

/** Tie-break between two candidates at the same distance: x, then y, then z. */
function portalBefore(a: Vec3i, b: Vec3i): boolean {
	if (a.x !== b.x) return a.x < b.x
	if (a.y !== b.y) return a.y < b.y
	return a.z < b.z
}

/**
 * Nearest `BLOCK_V2.NETHER_PORTAL` voxel around `origin`, or `null`.
 *
 * Shells of growing Chebyshev radius are scanned in ascending `(dx, dy, dz)`
 * order; the winner is the smallest squared Euclidean distance, ties broken by
 * ascending x, then y, then z. Every voxel of shell `s` is at least `s` away,
 * so the scan stops as soon as the best candidate is strictly closer than the
 * next shell: same answer as scanning the whole cube, without paying for it.
 */
export function portalTravelFindPortal(
	world: SimVoxelWorld,
	origin: Vec3i,
	options: PortalTravelSearchOptions = {},
): Vec3i | null {
	const radius = Math.max(0, Math.floor(options.radius ?? PORTAL.linkSearchRadius))
	const minY = options.minY ?? 0
	const maxY = options.maxY ?? CHUNK_Y - 1
	let best: Vec3i | null = null
	let bestDistance = Number.POSITIVE_INFINITY
	for (let shell = 0; shell <= radius; shell++) {
		if (best !== null && bestDistance < shell * shell) break
		for (let dx = -shell; dx <= shell; dx++) {
			for (let dy = -shell; dy <= shell; dy++) {
				const y = origin.y + dy
				if (y < minY || y > maxY) continue
				const onEdge = Math.max(Math.abs(dx), Math.abs(dy)) === shell
				const step = onEdge || shell === 0 ? 1 : 2 * shell
				for (let dz = -shell; dz <= shell; dz += step) {
					const x = origin.x + dx
					const z = origin.z + dz
					if (world.getBlock(x, y, z) !== BLOCK_V2.NETHER_PORTAL) continue
					const distance = dx * dx + dy * dy + dz * dz
					const candidate: Vec3i = { x, y, z }
					if (best === null || distance < bestDistance) {
						best = candidate
						bestDistance = distance
					} else if (distance === bestDistance && portalBefore(candidate, best)) {
						best = candidate
					}
				}
			}
		}
	}
	return best
}

/** Result of `portalTravelBuildFrame`. */
export interface PortalTravelFrame {
	/** Bottom left voxel of the opening: where an arriving entity is placed. */
	readonly anchor: Vec3i
	/** Every portal voxel of the opening, ascending by x then y. */
	readonly inner: readonly Vec3i[]
}

/**
 * Builds the smallest legal portal at `base`, deterministically.
 *
 * `base` is the bottom left voxel of the opening, which is
 * `PORTAL.minInnerWidth` wide along +x and `PORTAL.minInnerHeight` tall in the
 * plane `z === base.z` - the canonical orientation of this subtree. The opening
 * is filled with `BLOCK_V2.NETHER_PORTAL` and ringed, corners included, with
 * `PORTAL.frameBlock`. Rows outside `0 .. CHUNK_Y - 1` are skipped instead of
 * clamped, so a frame at the build limit is cut off rather than folded onto
 * itself. Lighting is left to the caller, which owns the light engine.
 */
export function portalTravelBuildFrame(world: SimVoxelWorld, base: Vec3i): PortalTravelFrame {
	const width = PORTAL.minInnerWidth
	const height = PORTAL.minInnerHeight
	const inner: Vec3i[] = []
	for (let dx = -1; dx <= width; dx++) {
		for (let dy = -1; dy <= height; dy++) {
			const x = base.x + dx
			const y = base.y + dy
			if (y < 0 || y >= CHUNK_Y) continue
			const inside = dx >= 0 && dx < width && dy >= 0 && dy < height
			world.setBlock(x, y, base.z, inside ? BLOCK_V2.NETHER_PORTAL : PORTAL.frameBlock)
			if (inside) inner.push({ x, y, z: base.z })
		}
	}
	return { anchor: { x: base.x, y: base.y, z: base.z }, inner }
}

/** Per-entity portal bookkeeping. */
export interface PortalTravelState {
	/** Dimension the entity is currently simulated in. */
	dimension: DimensionId
	/** Ticks of uninterrupted contact with a portal voxel. */
	contactTicks: number
	/** Remaining ticks before this entity may travel again. */
	cooldownTicks: number
}

/** One completed transition. */
export interface PortalTravelResult {
	readonly entity: EntityId
	readonly from: DimensionId
	readonly to: DimensionId
	/** Position the entity was moved to. */
	readonly at: Vec3f
	/** Portal voxel that was used, in the source dimension. */
	readonly portal: Vec3i
	/** Portal voxel linked on the far side, `null` when none was found. */
	readonly link: Vec3i | null
}

/** Handed to `onMissingLink` when the destination has no portal in range. */
export interface PortalTravelLinkRequest {
	readonly entity: EntityId
	readonly from: DimensionId
	readonly to: DimensionId
	/** Scaled and clamped destination, before linking. */
	readonly at: Vec3f
	/** Destination world, ready to be written by `portalTravelBuildFrame`. */
	readonly world: SimVoxelWorld
}

/** Options for `portalTravelCreate`. */
export interface PortalTravelOptions {
	registry: DimRegistry
	ecs: EcsWorld
	events: EventBusV2
	/** Optional terrain hook, see `DimTerrainAccess`. */
	terrain?: DimTerrainAccess
	/** Link search radius. Defaults to `PORTAL.linkSearchRadius`. */
	linkSearchRadius?: number
	/**
	 * Called when no portal exists within the search radius, i.e. this is the
	 * "report it and let the caller decide" hook. Returning a voxel - for example
	 * the anchor of a fresh `portalTravelBuildFrame` - links the travel to it;
	 * returning `null` leaves the entity at the scaled destination.
	 */
	onMissingLink?: (request: PortalTravelLinkRequest) => Vec3i | null
}

/** Portal travel state machine over a set of tracked entities. */
export interface PortalTravelInstance {
	/** Starts tracking `entity` in `dimension` and resets its counters. */
	place(entity: EntityId, dimension: DimensionId): void
	/** Stops tracking `entity`. */
	forget(entity: EntityId): void
	/** Dimension of `entity`, or the Overworld when it is not tracked. */
	dimensionOf(entity: EntityId): DimensionId
	/** Live view of the counters of `entity`. */
	stateOf(entity: EntityId): Readonly<PortalTravelState> | undefined
	/** Tracked entities, ascending. */
	tracked(): EntityId[]
	/**
	 * Advances every tracked entity by one tick, in ascending entity order, and
	 * returns the travels that happened. Entities the ECS no longer knows are
	 * dropped.
	 */
	tick(): PortalTravelResult[]
}

/** Builds the portal travel state machine described at the top of this file. */
export function portalTravelCreate(options: PortalTravelOptions): PortalTravelInstance {
	const states = new Map<EntityId, PortalTravelState>()
	const radius = options.linkSearchRadius ?? PORTAL.linkSearchRadius

	const travel = (
		entity: EntityId,
		state: PortalTravelState,
		transform: TransformComp,
		portal: Vec3i,
	): PortalTravelResult => {
		const from = state.dimension
		const to = portalTravelDestinationOf(from)
		const world = options.registry.worldOf(to)
		const scaled: Vec3f = {
			x: portalTravelScaleAxis(from, to, transform.x),
			y: portalTravelClampY(to, transform.y),
			z: portalTravelScaleAxis(from, to, transform.z),
		}
		const column = { x: portalTravelVoxelOf(scaled.x), z: portalTravelVoxelOf(scaled.z) }
		options.terrain?.ensureColumn(to, column.x, column.z)
		let link = portalTravelFindPortal(
			world,
			{ x: column.x, y: portalTravelVoxelOf(scaled.y), z: column.z },
			{ radius, maxY: portalTravelCeilingY(to) },
		)
		if (link === null && options.onMissingLink) {
			link = options.onMissingLink({ entity, from, to, at: scaled, world })
		}
		let at: Vec3f = link
			? { x: link.x + PORTAL_VOXEL_CENTER, y: link.y, z: link.z + PORTAL_VOXEL_CENTER }
			: scaled
		if (link === null && options.terrain) {
			const landing = options.terrain.safeLandingY(to, column.x, column.z, at.y)
			if (landing !== null) at = { x: at.x, y: portalTravelClampY(to, landing), z: at.z }
		}
		state.dimension = to
		state.contactTicks = 0
		state.cooldownTicks = PORTAL.cooldownTicks
		transform.x = at.x
		transform.y = at.y
		transform.z = at.z
		options.events.emit(EVENT_V2.PortalUsed, { entity, at: { ...portal } })
		options.events.emit(EVENT_V2.DimensionChanged, { entity, from, to, at: { ...at } })
		options.events.emit(EVENT_V2.ParticleSpawn, {
			kind: PARTICLE.Portal,
			x: at.x,
			y: at.y,
			z: at.z,
			count: DIM_PORTAL_PARTICLE_COUNT,
		})
		return { entity, from, to, at, portal, link }
	}

	return {
		place(entity, dimension) {
			states.set(entity, { dimension, contactTicks: 0, cooldownTicks: 0 })
		},
		forget(entity) {
			states.delete(entity)
		},
		dimensionOf(entity) {
			return states.get(entity)?.dimension ?? DIMENSION.Overworld
		},
		stateOf(entity) {
			return states.get(entity)
		},
		tracked() {
			return [...states.keys()].sort((a, b) => a - b)
		},
		tick() {
			const results: PortalTravelResult[] = []
			for (const entity of [...states.keys()].sort((a, b) => a - b)) {
				const state = states.get(entity)
				if (!state) continue
				if (!options.ecs.alive(entity)) {
					states.delete(entity)
					continue
				}
				let travelled = false
				const transform = options.ecs.get(entity, Transform)
				if (transform) {
					const collider = options.ecs.get(entity, Collider)
					const contact = portalTravelContactVoxel(
						options.registry.worldOf(state.dimension),
						transform,
						collider?.height ?? 0,
					)
					state.contactTicks = contact === null ? 0 : state.contactTicks + 1
					const ready =
						contact !== null &&
						state.contactTicks >= PORTAL.travelDelayTicks &&
						state.cooldownTicks === 0
					if (ready && contact !== null) {
						results.push(travel(entity, state, transform, contact))
						travelled = true
					}
				}
				if (!travelled && state.cooldownTicks > 0) state.cooldownTicks -= 1
			}
			return results
		},
	}
}
