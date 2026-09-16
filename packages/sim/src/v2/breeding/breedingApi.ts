/**
 * The breeding surface `@voxelcraft/gameplay` calls.
 *
 * The parts that belong to gameplay stay there: which item was consumed, the
 * XP payout, hunger. This file owns the simulation half, which is love mode,
 * pairing, spawning the baby and the cooldown bookkeeping that follows from it.
 * Nothing here reads a clock or `Math.random`, so the same call sequence always
 * produces the same world.
 */
import { BREED_FOOD, BREEDING, EVENT, EVENT_V2, PARTICLE } from '@voxelcraft/core-types'
import type { EcsWorld, EntityId, ItemId, MobType, Tick, Vec3f } from '@voxelcraft/core-types'
import { Health, Intent, Transform, spawnLivingEntity } from '../../ecs'
import { MobAi, MobPath, MobTag, mobInitialAi } from '../../mob/components'
import { mobDefOf } from '../../mob/mobDefs'
import { babyColliderSize } from './babyBehavior'
import {
	BREED_HEART_PARTICLE_COUNT,
	BREED_NO_ENTITY,
	BabyTag,
	BreedCooldown,
	BreedLove,
	babyIsBaby,
	breedBusOf,
	breedIsInLoveMode,
	breedIsOnCooldown,
} from './babyComponents'

/**
 * The frozen breeding numbers plus the food table, re-exposed so gameplay never
 * has to hardcode a value or import `BREEDING` itself.
 */
export const BREED_RULES = {
	loveTicks: BREEDING.loveTicks,
	babyGrowTicks: BREEDING.babyGrowTicks,
	cooldownTicks: BREEDING.cooldownTicks,
	partnerRadius: BREEDING.partnerRadius,
	babyScale: BREEDING.babyScale,
	babySpeedFactor: BREEDING.babySpeedFactor,
	xpOnBreed: BREEDING.xpOnBreed,
	food: BREED_FOOD,
} as const

/** Shared empty result, because `BREED_FOOD` only lists breedable mobs. */
const BREED_EMPTY_FOOD: readonly ItemId[] = []

/** Items that put a mob of `type` into love mode; empty when it cannot breed. */
export function breedFoodFor(type: MobType): readonly ItemId[] {
	return BREED_FOOD[type] ?? BREED_EMPTY_FOOD
}

/** True when `item` is breeding food for `type`. */
export function breedIsFood(type: MobType, item: ItemId): boolean {
	return breedFoodFor(type).includes(item)
}

/** True when mobs of `type` can breed at all. */
export function breedCanBreed(type: MobType): boolean {
	return breedFoodFor(type).length > 0
}

/** Why a feed or pair attempt was refused. */
export type BreedRefusal =
	| 'not-a-mob'
	| 'dead'
	| 'baby'
	| 'not-breedable'
	| 'wrong-food'
	| 'cooldown'
	| 'same-entity'
	| 'different-type'
	| 'not-in-love'
	| 'too-far'
	| 'no-transform'

/** Result of `breedFeedAdult`. */
export type BreedFeedResult = { ok: true; loveTicks: number } | { ok: false; reason: BreedRefusal }

/**
 * Sets or refreshes love mode on `entity`.
 *
 * The value is written through an existing marker so readers in the same tick
 * see it: component adds made while a query is live are buffered until
 * `flush()`, and re-adding the same object also cancels a removal that was
 * buffered earlier in the tick.
 */
export function breedSetLoveTicks(world: EcsWorld, entity: EntityId, ticks: number): void {
	const love = world.get(entity, BreedLove)
	if (love) {
		love.loveTicks = ticks
		love.heartTicks = 0
		world.add(entity, BreedLove, love)
		return
	}
	world.add(entity, BreedLove, { loveTicks: ticks, heartTicks: 0 })
}

/** Sets or refreshes the breeding cooldown. Same same-tick rule as above. */
export function breedSetCooldown(world: EcsWorld, entity: EntityId, ticks: number): void {
	const cooldown = world.get(entity, BreedCooldown)
	if (cooldown) {
		cooldown.cooldownTicks = ticks
		world.add(entity, BreedCooldown, cooldown)
		return
	}
	world.add(entity, BreedCooldown, { cooldownTicks: ticks })
}

/** Ends love mode immediately. */
export function breedClearLove(world: EcsWorld, entity: EntityId): void {
	const love = world.get(entity, BreedLove)
	if (love) love.loveTicks = 0
	world.remove(entity, BreedLove)
}

/**
 * Feeds an adult and puts it into love mode for `BREEDING.loveTicks` ticks.
 *
 * `item` is optional: pass it to have the food checked against the mob type,
 * omit it when gameplay already validated the item. Feeding an adult that is
 * still on its breeding cooldown is refused, and feeding one that is already in
 * love mode refreshes the timer.
 */
export function breedFeedAdult(world: EcsWorld, entity: EntityId, item?: ItemId): BreedFeedResult {
	if (!world.alive(entity)) return { ok: false, reason: 'not-a-mob' }
	const tag = world.get(entity, MobTag)
	if (!tag) return { ok: false, reason: 'not-a-mob' }
	const health = world.get(entity, Health)
	if (health && health.current <= 0) return { ok: false, reason: 'dead' }
	if (babyIsBaby(world, entity)) return { ok: false, reason: 'baby' }
	if (!breedCanBreed(tag.type)) return { ok: false, reason: 'not-breedable' }
	if (item !== undefined && !breedIsFood(tag.type, item)) {
		return { ok: false, reason: 'wrong-food' }
	}
	if (breedIsOnCooldown(world, entity)) return { ok: false, reason: 'cooldown' }
	breedSetLoveTicks(world, entity, BREEDING.loveTicks)
	return { ok: true, loveTicks: BREEDING.loveTicks }
}

/** Options for `breedSpawnBaby`. */
export interface BreedSpawnBabyOptions {
	/** Mob type of the baby. */
	type: MobType
	/** World position to spawn at. */
	at: Vec3f
	/** Parent the baby prefers to follow, or `BREED_NO_ENTITY`. */
	parent?: EntityId
	/** Current tick, recorded on the AI marker when given. */
	tick?: Tick
}

/**
 * Spawns a baby mob: baby sized collider, full mob component set so the regular
 * mob systems keep working on it, baby marker, and `entity.spawned` emitted.
 *
 * Called inside a live query the components land at the next `flush()`, so read
 * the baby back only after flushing.
 */
export function breedSpawnBaby(world: EcsWorld, options: BreedSpawnBabyOptions): EntityId {
	const def = mobDefOf(options.type)
	const size = babyColliderSize(def)
	const entity = spawnLivingEntity(world, {
		x: options.at.x,
		y: options.at.y,
		z: options.at.z,
		width: size.width,
		height: size.height,
		maxHealth: def.maxHealth,
	})
	world.add(entity, Intent, {
		forward: 0,
		strafe: 0,
		jump: false,
		sprint: false,
		sneak: false,
		yaw: 0,
	})
	world.add(entity, MobTag, { type: options.type, hostile: def.hostile })
	const ai = mobInitialAi()
	if (options.tick !== undefined) ai.hurtSeenTick = options.tick
	world.add(entity, MobAi, ai)
	world.add(entity, MobPath, { nodes: [], moves: [], index: 0, status: 'none', plannedAt: -1 })
	world.add(entity, BabyTag, {
		growTicks: BREEDING.babyGrowTicks,
		parent: options.parent ?? BREED_NO_ENTITY,
	})
	breedBusOf(world)?.emit(EVENT.EntitySpawned, { entity, mob: options.type, at: options.at })
	return entity
}

/** A pairing that produced a baby. */
export interface BreedPairSuccess {
	ok: true
	/** Lower of the two parent entity ids. */
	parentA: EntityId
	/** Higher of the two parent entity ids. */
	parentB: EntityId
	/** The newborn. */
	baby: EntityId
	/** Midpoint between the parents, where the baby was placed. */
	at: Vec3f
}

/** Result of `breedTryPair`. */
export type BreedPairResult = BreedPairSuccess | { ok: false; reason: BreedRefusal }

/**
 * Breeds two adults that are both in love mode and within
 * `BREEDING.partnerRadius` of each other.
 *
 * The baby appears at the midpoint, both parents leave love mode and take a
 * `BREEDING.cooldownTicks` cooldown, and `entity.bred` plus a heart burst are
 * emitted. The two parents are reported in ascending entity id order, so the
 * payload does not depend on which one was passed first.
 */
export function breedTryPair(
	world: EcsWorld,
	first: EntityId,
	second: EntityId,
	tick: Tick = 0,
): BreedPairResult {
	if (first === second) return { ok: false, reason: 'same-entity' }
	const parentA = first < second ? first : second
	const parentB = first < second ? second : first
	if (!world.alive(parentA) || !world.alive(parentB)) return { ok: false, reason: 'not-a-mob' }
	const tagA = world.get(parentA, MobTag)
	const tagB = world.get(parentB, MobTag)
	if (!tagA || !tagB) return { ok: false, reason: 'not-a-mob' }
	if (tagA.type !== tagB.type) return { ok: false, reason: 'different-type' }
	if (babyIsBaby(world, parentA) || babyIsBaby(world, parentB)) {
		return { ok: false, reason: 'baby' }
	}
	if (!breedCanBreed(tagA.type)) return { ok: false, reason: 'not-breedable' }
	if (breedIsOnCooldown(world, parentA) || breedIsOnCooldown(world, parentB)) {
		return { ok: false, reason: 'cooldown' }
	}
	if (!breedIsInLoveMode(world, parentA) || !breedIsInLoveMode(world, parentB)) {
		return { ok: false, reason: 'not-in-love' }
	}
	const a = world.get(parentA, Transform)
	const b = world.get(parentB, Transform)
	if (!a || !b) return { ok: false, reason: 'no-transform' }
	const dx = a.x - b.x
	const dz = a.z - b.z
	if (Math.sqrt(dx * dx + dz * dz) > BREEDING.partnerRadius) {
		return { ok: false, reason: 'too-far' }
	}
	const at: Vec3f = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
	const baby = breedSpawnBaby(world, { type: tagA.type, at, parent: parentA, tick })
	breedClearLove(world, parentA)
	breedClearLove(world, parentB)
	breedSetCooldown(world, parentA, BREEDING.cooldownTicks)
	breedSetCooldown(world, parentB, BREEDING.cooldownTicks)
	const bus = breedBusOf(world)
	bus?.emit(EVENT_V2.EntityBred, { parentA, parentB, baby, at })
	bus?.emit(EVENT_V2.ParticleSpawn, {
		kind: PARTICLE.Heart,
		x: at.x,
		y: at.y + mobDefOf(tagA.type).height,
		z: at.z,
		count: BREED_HEART_PARTICLE_COUNT,
	})
	return { ok: true, parentA, parentB, baby, at }
}
