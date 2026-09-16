import { EVENT, MOB, MOB_SPAWN, makeRng, worldToChunk } from '@voxelcraft/core-types'
import type { EcsWorld, EntityId, MobType, SystemFn, Tick } from '@voxelcraft/core-types'
import { Intent, spawnLivingEntity } from '../ecs'
import type { SimVoxelWorld } from '../shared'
import { MobAi, MobPath, MobTag, mobInitialAi } from './components'
import { MOB_RNG_SALT, mobGetContext, type MobSimContext } from './context'
import { mobDefOf } from './mobDefs'
import { mobDistance, mobPlayerAnchors, type MobAnchor } from './targets'

// Local tuning constants. None of these re-declare a contract number:
// `MOB_SPAWN` owns the caps and the distances, but not the shape of the
// sampling volume, so that is derived and documented here.

/** Blocks scanned downwards from the sampled altitude while looking for a floor. */
export const MOB_SPAWN_SURFACE_SCAN = 8
/** Vertical spread of a spawn attempt around the player altitude, in blocks. */
export const MOB_SPAWN_VERTICAL_SPAN = MOB_SPAWN_SURFACE_SCAN
/** Horizontal spread of the extra members of a spawn group, in blocks. */
export const MOB_SPAWN_GROUP_SPREAD = 2
/** One attempt in `MOB_SPAWN_HOSTILE_ODDS` targets the passive pool. */
export const MOB_SPAWN_HOSTILE_ODDS = 4

/** Hostile spawn pool, in `MOB` order. */
export const MOB_SPAWN_HOSTILE_TYPES: readonly MobType[] = [
	MOB.Zombie,
	MOB.Skeleton,
	MOB.Creeper,
	MOB.Spider,
]

/** Passive spawn pool, in `MOB` order. */
export const MOB_SPAWN_PASSIVE_TYPES: readonly MobType[] = [
	MOB.Pig,
	MOB.Cow,
	MOB.Sheep,
	MOB.Chicken,
]

/** Where a mob is placed: block column plus the exact spawn position. */
export interface MobSpawnPoint {
	x: number
	y: number
	z: number
}

/**
 * Spawn rules for one block position, `(x, y, z)` being the block the feet
 * occupy:
 *  - the column must be in a loaded chunk,
 *  - the block below must be solid,
 *  - the body must fit without intersecting blocks or liquid,
 *  - block light must be at most `MobDef.spawnMaxBlockLight`, which is what
 *    keeps hostiles in the dark and lets passives spawn anywhere.
 */
export function mobCanSpawnAt(
	voxels: SimVoxelWorld,
	type: MobType,
	x: number,
	y: number,
	z: number,
): boolean {
	const def = mobDefOf(type)
	if (!voxels.isLoaded(worldToChunk(x), worldToChunk(z))) return false
	if (!voxels.inBounds(y) || !voxels.inBounds(y - 1)) return false
	if (!voxels.isSolid(x, y - 1, z)) return false
	const cells = Math.max(1, Math.ceil(def.height))
	for (let i = 0; i < cells; i++) {
		const cy = y + i
		if (!voxels.inBounds(cy)) return false
		if (voxels.isSolid(x, cy, z)) return false
		if (voxels.isLiquid(x, cy, z)) return false
	}
	return voxels.getBlockLightAt(x, y, z) <= def.spawnMaxBlockLight
}

/**
 * Highest standable Y at or below `yFrom` within `maxDrop` blocks, or `-1`.
 * Only the floor and the head block are checked here; the full body test is
 * `mobCanSpawnAt`.
 */
export function mobFindSpawnSurface(
	voxels: SimVoxelWorld,
	x: number,
	yFrom: number,
	z: number,
	maxDrop: number = MOB_SPAWN_SURFACE_SCAN,
): number {
	for (let i = 0; i <= maxDrop; i++) {
		const y = yFrom - i
		if (!voxels.inBounds(y) || !voxels.inBounds(y - 1)) continue
		if (voxels.isSolid(x, y - 1, z) && !voxels.isSolid(x, y, z)) return y
	}
	return -1
}

/** Live mob counts, split the same way `MOB_SPAWN` splits the caps. */
export function mobCountPopulation(world: EcsWorld): { hostile: number; passive: number } {
	let hostile = 0
	let passive = 0
	for (const entity of world.query([MobTag])) {
		const tag = world.get(entity, MobTag)
		if (!tag) continue
		if (tag.hostile) hostile++
		else passive++
	}
	return { hostile, passive }
}

/**
 * `MOB_SPAWN.minDistance` from every player and within
 * `MOB_SPAWN.maxDistance` of at least one.
 */
export function mobInSpawnBand(
	anchors: readonly MobAnchor[],
	x: number,
	y: number,
	z: number,
): boolean {
	let withinOuter = false
	for (const anchor of anchors) {
		const dist = mobDistance(anchor.x, anchor.y, anchor.z, x, y, z)
		if (dist < MOB_SPAWN.minDistance) return false
		if (dist <= MOB_SPAWN.maxDistance) withinOuter = true
	}
	return withinOuter
}

/**
 * Creates one mob: the shared living component set from `spawnLivingEntity`
 * plus `Intent`, `MobTag`, `MobAi` and `MobPath`. Emits `entity.spawned`.
 */
export function mobSpawnMob(
	world: EcsWorld,
	ctx: MobSimContext,
	type: MobType,
	at: MobSpawnPoint,
	tick: Tick,
): EntityId {
	const def = mobDefOf(type)
	const entity = spawnLivingEntity(world, {
		x: at.x,
		y: at.y,
		z: at.z,
		width: def.width,
		height: def.height,
		maxHealth: def.maxHealth,
	})
	const ai = mobInitialAi()
	// Hurt markers older than the spawn tick are not this mob's business.
	ai.hurtSeenTick = tick
	world.add(entity, Intent, {
		forward: 0,
		strafe: 0,
		jump: false,
		sprint: false,
		sneak: false,
		yaw: 0,
	})
	world.add(entity, MobTag, { type, hostile: def.hostile })
	world.add(entity, MobAi, ai)
	world.add(entity, MobPath, { nodes: [], moves: [], index: 0, status: 'none', plannedAt: -1 })
	ctx.bus?.emit(EVENT.EntitySpawned, { entity, mob: type, at: { x: at.x, y: at.y, z: at.z } })
	return entity
}

/**
 * `SYSTEM_ORDER` slot `mobSpawn`.
 *
 * Runs `MOB_SPAWN.attemptsPerTick` attempts per tick. Every attempt draws from
 * a fresh `makeRng(seed, salt, tick, attempt)` stream, so the result depends
 * only on the seed, the tick and the attempt index and never on iteration
 * order or wall clock. Candidates must sit in the
 * `minDistance..maxDistance` band around a player, pass `mobCanSpawnAt` and
 * fit under `mobCapHostile` / `mobCapPassive`; the caps are also tracked
 * locally because component adds are only visible after `flush()`.
 */
export const mobSpawnSystem: SystemFn = (world, _dt, tick) => {
	const ctx = mobGetContext(world)
	if (!ctx || ctx.spawningEnabled === false) return
	const anchors = mobPlayerAnchors(world)
	if (anchors.length === 0) return
	const population = mobCountPopulation(world)
	let hostile = population.hostile
	let passive = population.passive
	const span = MOB_SPAWN.maxDistance
	for (let attempt = 0; attempt < MOB_SPAWN.attemptsPerTick; attempt++) {
		if (hostile >= MOB_SPAWN.mobCapHostile && passive >= MOB_SPAWN.mobCapPassive) return
		const rng = makeRng(ctx.seed, MOB_RNG_SALT.spawnAttempt, tick, attempt)
		const anchor = anchors[rng.nextInt(anchors.length)]
		const x = Math.floor(anchor.x) + rng.nextInt(span * 2 + 1) - span
		const z = Math.floor(anchor.z) + rng.nextInt(span * 2 + 1) - span
		const yFrom =
			Math.floor(anchor.y) +
			rng.nextInt(MOB_SPAWN_VERTICAL_SPAN * 2 + 1) -
			MOB_SPAWN_VERTICAL_SPAN
		let wantHostile = rng.nextInt(MOB_SPAWN_HOSTILE_ODDS) > 0
		if (wantHostile && hostile >= MOB_SPAWN.mobCapHostile) wantHostile = false
		if (!wantHostile && passive >= MOB_SPAWN.mobCapPassive) {
			if (hostile >= MOB_SPAWN.mobCapHostile) continue
			wantHostile = true
		}
		const pool = wantHostile ? MOB_SPAWN_HOSTILE_TYPES : MOB_SPAWN_PASSIVE_TYPES
		const type = pool[rng.nextInt(pool.length)]
		const def = mobDefOf(type)
		const groupSpan = Math.max(1, def.spawnGroupMax - def.spawnGroupMin + 1)
		const group = def.spawnGroupMin + rng.nextInt(groupSpan)
		for (let member = 0; member < group; member++) {
			const atCap = wantHostile
				? hostile >= MOB_SPAWN.mobCapHostile
				: passive >= MOB_SPAWN.mobCapPassive
			if (atCap) break
			const spread = member === 0 ? 0 : MOB_SPAWN_GROUP_SPREAD
			const mx = spread === 0 ? x : x + rng.nextInt(spread * 2 + 1) - spread
			const mz = spread === 0 ? z : z + rng.nextInt(spread * 2 + 1) - spread
			const my = mobFindSpawnSurface(ctx.voxels, mx, yFrom, mz)
			if (my < 0) continue
			if (!mobInSpawnBand(anchors, mx + 0.5, my, mz + 0.5)) continue
			if (!mobCanSpawnAt(ctx.voxels, type, mx, my, mz)) continue
			mobSpawnMob(world, ctx, type, { x: mx + 0.5, y: my, z: mz + 0.5 }, tick)
			if (wantHostile) hostile++
			else passive++
		}
	}
}
