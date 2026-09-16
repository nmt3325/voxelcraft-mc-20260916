/**
 * Data for the breeding subtree: the baby, love mode, cooldown and panic
 * components, the constants this folder owns, and the per world context the
 * systems read.
 *
 * Behaviour lives in `babyBehavior.ts`, the gameplay facing entry points live
 * in `breedingApi.ts`. Every frozen number comes from `BREEDING` in
 * `@voxelcraft/core-types`; the constants declared here are local tuning
 * values and are deliberately not part of the contract.
 */
import { BREEDING, PERF } from '@voxelcraft/core-types'
import type { EcsWorld, EntityId, EventBusV2 } from '@voxelcraft/core-types'
import { defineComponent } from '../../ecs'

/** "No entity recorded", matching the `-1` target sentinel used by mob AI. */
export const BREED_NO_ENTITY: EntityId = -1

/**
 * Local constant: ticks a damaged mob keeps fleeing. Two seconds, the same
 * reaction length `mob/ai.ts` uses for its own flee timer, so a panicking baby
 * and a panicking adult behave alike.
 */
export const BABY_PANIC_TICKS = PERF.simTickHz * 2

/**
 * Local constant: ticks between two heart bursts while a mob is in love mode.
 * Half a second, a fixed cadence that does not depend on `BREEDING.loveTicks`.
 */
export const BREED_HEART_INTERVAL_TICKS = PERF.simTickHz / 2

/** Local constant: particles per heart burst. Purely cosmetic. */
export const BREED_HEART_PARTICLE_COUNT = 3

/**
 * Local constant: a baby stops walking once it is this close in blocks to the
 * adult it follows, so it does not grind into the parent hitbox.
 */
export const BABY_FOLLOW_STOP_DISTANCE = 1

/** Local constant: the same idea for two adults walking towards each other. */
export const BREED_MATE_STOP_DISTANCE = 0.75

/** Marks a mob as a baby and remembers the parent it prefers to follow. */
export interface BabyTagComp {
	/** Ticks left before the baby grows up. Counts down once per sim tick. */
	growTicks: number
	/** Parent recorded at birth, or `BREED_NO_ENTITY`. */
	parent: EntityId
}

/** Baby marker component. */
export const BabyTag = defineComponent<BabyTagComp>('babyTag', () => ({
	growTicks: BREEDING.babyGrowTicks,
	parent: BREED_NO_ENTITY,
}))

/** Marks an adult that was fed and is looking for a partner. */
export interface BreedLoveComp {
	/** Ticks left of love mode. */
	loveTicks: number
	/** Ticks until the next heart burst; `0` emits on the next tick. */
	heartTicks: number
}

/** Love mode marker component. */
export const BreedLove = defineComponent<BreedLoveComp>('breedLove', () => ({
	loveTicks: BREEDING.loveTicks,
	heartTicks: 0,
}))

/** Blocks an adult from being fed again right after it bred. */
export interface BreedCooldownComp {
	/** Ticks left of the cooldown. */
	cooldownTicks: number
}

/** Breeding cooldown marker component. */
export const BreedCooldown = defineComponent<BreedCooldownComp>('breedCooldown', () => ({
	cooldownTicks: BREEDING.cooldownTicks,
}))

/**
 * Marks a mob that is fleeing. It carries the `Baby` prefix because this folder
 * owns it, but it applies to babies and adults alike.
 */
export interface BabyPanicComp {
	/** Ticks left of the panic reaction. */
	panicTicks: number
	/** Entity that caused the damage, or `BREED_NO_ENTITY` when unknown. */
	source: EntityId
	/** Source X recorded at panic start; used when the source is gone. */
	fromX: number
	/** Source Z recorded at panic start; used when the source is gone. */
	fromZ: number
}

/** Panic marker component. */
export const BabyPanic = defineComponent<BabyPanicComp>('babyPanic', () => ({
	panicTicks: BABY_PANIC_TICKS,
	source: BREED_NO_ENTITY,
	fromX: 0,
	fromZ: 0,
}))

/**
 * True while the entity still carries an unfinished baby marker.
 *
 * Structural edits made while a query is live are buffered until `flush()`, so
 * the tick count is checked too: a baby that grew up this tick already reads as
 * an adult even though its marker is still attached.
 */
export function babyIsBaby(world: EcsWorld, entity: EntityId): boolean {
	const baby = world.get(entity, BabyTag)
	return baby !== undefined && baby.growTicks > 0
}

/** True while the entity is in love mode. Same buffering rule as `babyIsBaby`. */
export function breedIsInLoveMode(world: EcsWorld, entity: EntityId): boolean {
	const love = world.get(entity, BreedLove)
	return love !== undefined && love.loveTicks > 0
}

/** True while the entity may not be fed again. Same buffering rule. */
export function breedIsOnCooldown(world: EcsWorld, entity: EntityId): boolean {
	const cooldown = world.get(entity, BreedCooldown)
	return cooldown !== undefined && cooldown.cooldownTicks > 0
}

/** Everything the breeding systems need besides the ECS world itself. */
export interface BreedSimContext {
	/** Bus breeding events go to. Optional; without it the events are dropped. */
	bus?: EventBusV2
}

const breedContexts = new WeakMap<EcsWorld, BreedSimContext>()

/**
 * Binds the breeding context to a world. A `SystemFn` only receives
 * `(world, dt, tick)`, so the bus is looked up here, exactly like
 * `mob/context.ts` does for the mob systems.
 */
export function breedBindContext(world: EcsWorld, context: BreedSimContext): void {
	breedContexts.set(world, context)
}

/** Context bound to `world`, or `undefined` when nothing is bound. */
export function breedGetContext(world: EcsWorld): BreedSimContext | undefined {
	return breedContexts.get(world)
}

/** Drops the context bound to `world`. */
export function breedUnbindContext(world: EcsWorld): void {
	breedContexts.delete(world)
}

/** Bus bound to `world`, or `undefined` when nothing is bound. */
export function breedBusOf(world: EcsWorld): EventBusV2 | undefined {
	return breedContexts.get(world)?.bus
}
