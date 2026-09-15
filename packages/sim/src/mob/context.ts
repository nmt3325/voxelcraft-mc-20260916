import type { EcsWorld, EventBus } from '@voxelcraft/core-types'
import type { SimVoxelWorld } from '../shared'

/**
 * Ambient simulation context required by the mob / AI / combat systems.
 *
 * `SystemFn` only receives `(world, dt, tick)`, so the voxel world, the world
 * seed and the event bus are bound to the ECS world once at setup time and
 * looked up from the systems. Nothing here participates in state maths beyond
 * the seed, which keeps every decision deterministic.
 */
export interface MobSimContext {
	/** Voxel world used for spawn checks, pathfinding and projectile collision. */
	voxels: SimVoxelWorld
	/** World seed. Mixed into every random decision through `makeRng`. */
	seed: number
	/** Optional event bus used to publish spawn / damage / death events. */
	bus?: EventBus
	/** When `false`, `mobSpawnSystem` skips all spawn attempts. Defaults to `true`. */
	spawningEnabled?: boolean
}

const CONTEXTS = new WeakMap<EcsWorld, MobSimContext>()

/** Binds (or replaces) the mob simulation context of an ECS world. */
export function mobBindContext(world: EcsWorld, ctx: MobSimContext): MobSimContext {
	CONTEXTS.set(world, ctx)
	return ctx
}

/** Returns the mob simulation context of an ECS world, if one was bound. */
export function mobGetContext(world: EcsWorld): MobSimContext | undefined {
	return CONTEXTS.get(world)
}

/** Removes the mob simulation context of an ECS world. */
export function mobUnbindContext(world: EcsWorld): void {
	CONTEXTS.delete(world)
}

/**
 * Fixed salts mixed into `makeRng` so that unrelated decisions taken on the
 * same tick never share a random stream.
 */
export const MOB_RNG_SALT = {
	spawnAttempt: 0x6d6f6201,
	spawnGroup: 0x6d6f6202,
	wander: 0x6d6f6203,
} as const
