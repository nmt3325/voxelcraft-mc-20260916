/**
 * Behaviour for babies, love mode and panic.
 *
 * Every function here only writes `Intent`, never a position, so the physics
 * system stays the single mover. Scans follow the ascending entity id order
 * `world.query` guarantees and nothing calls `Math.random`, so replaying a
 * tick reproduces it exactly.
 *
 * Directions are written as `(forward, strafe)` with `intent.yaw` left at 0,
 * the convention `mob/ai.ts` already uses: `intentToWorld` maps that pair
 * straight onto world `(z, x)`. It also avoids `Math.atan2`, whose result is
 * implementation defined and would break bit identical replays, the same
 * reason `shared/math.ts` exists.
 */
import { BREEDING, EVENT, EVENT_V2, PARTICLE, PHYSICS } from '@voxelcraft/core-types'
import type {
	EcsWorld,
	EntityId,
	EventBusV2,
	MobDef,
	MobType,
	SystemFn,
} from '@voxelcraft/core-types'
import { Collider, Health, Intent, Transform, type IntentComp } from '../../ecs'
import { MobTag } from '../../mob/components'
import { mobDefOf } from '../../mob/mobDefs'
import {
	BABY_FOLLOW_STOP_DISTANCE,
	BABY_PANIC_TICKS,
	BREED_HEART_INTERVAL_TICKS,
	BREED_HEART_PARTICLE_COUNT,
	BREED_MATE_STOP_DISTANCE,
	BREED_NO_ENTITY,
	BabyPanic,
	BabyTag,
	BreedCooldown,
	BreedLove,
	babyIsBaby,
	breedBusOf,
	breedIsInLoveMode,
	type BabyPanicComp,
} from './babyComponents'

/** Horizontal distance in blocks. */
function babyDistance(ax: number, az: number, bx: number, bz: number): number {
	const dx = ax - bx
	const dz = az - bz
	return Math.sqrt(dx * dx + dz * dz)
}

/** Collider a baby of `def` uses: the adult box scaled by `BREEDING.babyScale`. */
export function babyColliderSize(def: MobDef): { width: number; height: number } {
	return {
		width: def.width * BREEDING.babyScale,
		height: def.height * BREEDING.babyScale,
	}
}

/**
 * Intent magnitude a mob walks with, mirroring `mobSteer`: mob speeds are
 * blocks per second and the intent is the fraction of `PHYSICS.walkSpeed` that
 * produces them. Babies add `BREEDING.babySpeedFactor`.
 */
export function babyMoveScale(def: MobDef, isBaby: boolean): number {
	const speed = isBaby ? def.speed * BREEDING.babySpeedFactor : def.speed
	return Math.min(1, speed / PHYSICS.walkSpeed)
}

/** Clears the horizontal movement wish, leaving jump and yaw alone. */
export function babyStopIntent(intent: IntentComp): void {
	intent.forward = 0
	intent.strafe = 0
}

/**
 * Points `intent` at a target, or straight away from it when `away` is set.
 * `scale` is the intent magnitude from `babyMoveScale`.
 */
export function babySteerIntent(
	intent: IntentComp,
	fromX: number,
	fromZ: number,
	toX: number,
	toZ: number,
	scale: number,
	away = false,
): void {
	const sign = away ? -1 : 1
	const dx = (toX - fromX) * sign
	const dz = (toZ - fromZ) * sign
	const length = Math.sqrt(dx * dx + dz * dz)
	intent.yaw = 0
	intent.sprint = false
	intent.sneak = false
	if (length <= PHYSICS.epsilon) {
		babyStopIntent(intent)
		return
	}
	intent.strafe = (dx / length) * scale
	intent.forward = (dz / length) * scale
}

/** One mob as seen by the breeding movement pass. */
interface BreedMobView {
	entity: EntityId
	type: MobType
	x: number
	z: number
	isBaby: boolean
	inLove: boolean
}

/** Live mobs with a transform, in ascending entity id order. */
function breedCollectMobs(world: EcsWorld): BreedMobView[] {
	const mobs: BreedMobView[] = []
	for (const entity of world.query([MobTag, Transform])) {
		const tag = world.get(entity, MobTag)
		const transform = world.get(entity, Transform)
		if (!tag || !transform) continue
		const health = world.get(entity, Health)
		if (health && health.current <= 0) continue
		mobs.push({
			entity,
			type: tag.type,
			x: transform.x,
			z: transform.z,
			isBaby: babyIsBaby(world, entity),
			inLove: breedIsInLoveMode(world, entity),
		})
	}
	return mobs
}

/**
 * Adult a baby follows: the parent recorded at birth while it is alive, the
 * same type and inside `BREEDING.partnerRadius`, otherwise the nearest adult
 * of that type. Ties go to the lower entity id because the scan is ascending.
 */
function babyFollowTarget(
	world: EcsWorld,
	baby: BreedMobView,
	mobs: readonly BreedMobView[],
): BreedMobView | undefined {
	const tag = world.get(baby.entity, BabyTag)
	const parent = tag ? tag.parent : BREED_NO_ENTITY
	let best: BreedMobView | undefined
	let bestDistance = Number.POSITIVE_INFINITY
	for (const other of mobs) {
		if (other.entity === baby.entity || other.type !== baby.type || other.isBaby) continue
		const distance = babyDistance(baby.x, baby.z, other.x, other.z)
		if (distance > BREEDING.partnerRadius) continue
		if (other.entity === parent) return other
		if (distance < bestDistance) {
			best = other
			bestDistance = distance
		}
	}
	return best
}

/** Nearest other adult of the same type that is also in love mode. */
function breedMateTarget(
	lover: BreedMobView,
	mobs: readonly BreedMobView[],
): BreedMobView | undefined {
	let best: BreedMobView | undefined
	let bestDistance = Number.POSITIVE_INFINITY
	for (const other of mobs) {
		if (other.entity === lover.entity || other.type !== lover.type) continue
		if (other.isBaby || !other.inLove) continue
		const distance = babyDistance(lover.x, lover.z, other.x, other.z)
		if (distance > BREEDING.partnerRadius) continue
		if (distance < bestDistance) {
			best = other
			bestDistance = distance
		}
	}
	return best
}

/** Position a panicking mob runs away from. */
function babyPanicOrigin(world: EcsWorld, panic: BabyPanicComp): { x: number; z: number } {
	if (panic.source !== BREED_NO_ENTITY && world.alive(panic.source)) {
		const transform = world.get(panic.source, Transform)
		if (transform) return { x: transform.x, z: transform.z }
	}
	return { x: panic.fromX, z: panic.fromZ }
}

/** Walks `mob` towards `target`, standing still inside `stopAt` blocks. */
function breedWalkTowards(
	intent: IntentComp,
	mob: BreedMobView,
	target: BreedMobView,
	scale: number,
	stopAt: number,
): void {
	if (babyDistance(mob.x, mob.z, target.x, target.z) <= stopAt) {
		babyStopIntent(intent)
		return
	}
	babySteerIntent(intent, mob.x, mob.z, target.x, target.z, scale)
}

/**
 * Writes this tick's movement wish. Panic outranks following a parent, which
 * outranks walking towards a partner; a mob doing none of the three keeps the
 * intent the mob AI gave it.
 */
function breedApplyMovement(world: EcsWorld, mobs: readonly BreedMobView[]): void {
	for (const mob of mobs) {
		const intent = world.get(mob.entity, Intent)
		if (!intent) continue
		const scale = babyMoveScale(mobDefOf(mob.type), mob.isBaby)
		const panic = world.get(mob.entity, BabyPanic)
		if (panic && panic.panicTicks > 0) {
			const origin = babyPanicOrigin(world, panic)
			babySteerIntent(intent, mob.x, mob.z, origin.x, origin.z, scale, true)
			continue
		}
		if (mob.isBaby) {
			const parent = babyFollowTarget(world, mob, mobs)
			if (!parent) {
				babyStopIntent(intent)
				continue
			}
			breedWalkTowards(intent, mob, parent, scale, BABY_FOLLOW_STOP_DISTANCE)
			continue
		}
		if (!mob.inLove) continue
		const partner = breedMateTarget(mob, mobs)
		if (partner) breedWalkTowards(intent, mob, partner, scale, BREED_MATE_STOP_DISTANCE)
	}
}

/** Counts panic down and drops the marker when it runs out. */
function babyTickPanic(world: EcsWorld): void {
	for (const entity of world.query([BabyPanic])) {
		const panic = world.get(entity, BabyPanic)
		if (!panic) continue
		if (panic.panicTicks > 0) panic.panicTicks -= 1
		if (panic.panicTicks <= 0) world.remove(entity, BabyPanic)
	}
}

/** Emits one heart burst above `entity`. */
function breedEmitHearts(world: EcsWorld, entity: EntityId, bus: EventBusV2 | undefined): void {
	if (!bus) return
	const transform = world.get(entity, Transform)
	if (!transform) return
	const collider = world.get(entity, Collider)
	bus.emit(EVENT_V2.ParticleSpawn, {
		kind: PARTICLE.Heart,
		x: transform.x,
		y: transform.y + (collider ? collider.height : 0),
		z: transform.z,
		count: BREED_HEART_PARTICLE_COUNT,
	})
}

/**
 * Counts love mode down and emits a heart burst every
 * `BREED_HEART_INTERVAL_TICKS` ticks, starting on the first tick of love mode.
 */
function breedTickLove(world: EcsWorld, bus: EventBusV2 | undefined): void {
	for (const entity of world.query([BreedLove])) {
		const love = world.get(entity, BreedLove)
		if (!love) continue
		if (love.loveTicks <= 0) {
			world.remove(entity, BreedLove)
			continue
		}
		love.loveTicks -= 1
		if (love.heartTicks > 0) love.heartTicks -= 1
		if (love.heartTicks <= 0) {
			breedEmitHearts(world, entity, bus)
			love.heartTicks = BREED_HEART_INTERVAL_TICKS
		}
		if (love.loveTicks <= 0) world.remove(entity, BreedLove)
	}
}

/** Counts the breeding cooldown down and drops the marker when it runs out. */
function breedTickCooldown(world: EcsWorld): void {
	for (const entity of world.query([BreedCooldown])) {
		const cooldown = world.get(entity, BreedCooldown)
		if (!cooldown) continue
		if (cooldown.cooldownTicks > 0) cooldown.cooldownTicks -= 1
		if (cooldown.cooldownTicks <= 0) world.remove(entity, BreedCooldown)
	}
}

/**
 * Promotes a baby to an adult: adult collider back, marker gone and
 * `entity.grown` emitted. Exported so a host can grow a baby on command.
 */
export function babyGrowUp(world: EcsWorld, entity: EntityId, bus = breedBusOf(world)): void {
	const baby = world.get(entity, BabyTag)
	if (baby) baby.growTicks = 0
	const tag = world.get(entity, MobTag)
	const collider = world.get(entity, Collider)
	if (tag && collider) {
		const def = mobDefOf(tag.type)
		collider.width = def.width
		collider.height = def.height
	}
	world.remove(entity, BabyTag)
	if (tag) bus?.emit(EVENT_V2.EntityGrown, { entity, mob: tag.type })
}

/**
 * Counts every baby down and grows the ones that reach zero, which happens on
 * exactly the `BREEDING.babyGrowTicks`th tick after birth.
 */
function babyTickGrowth(world: EcsWorld, bus: EventBusV2 | undefined): void {
	for (const entity of world.query([BabyTag])) {
		const baby = world.get(entity, BabyTag)
		if (!baby) continue
		if (baby.growTicks > 0) baby.growTicks -= 1
		if (baby.growTicks > 0) continue
		babyGrowUp(world, entity, bus)
	}
}

/**
 * Starts or restarts a panic reaction on `entity`.
 *
 * The source position is recorded so the mob keeps running the right way even
 * when the attacker dies mid panic. Without a usable source the mob just
 * stands still, because there is no direction to flee in.
 */
export function babyBeginPanic(world: EcsWorld, entity: EntityId, source: EntityId | null): void {
	if (!world.alive(entity)) return
	const self = world.get(entity, Transform)
	const sourceEntity = source === null ? BREED_NO_ENTITY : source
	const known = sourceEntity !== BREED_NO_ENTITY && world.alive(sourceEntity)
	const from = known ? world.get(sourceEntity, Transform) : undefined
	const fromX = from ? from.x : self ? self.x : 0
	const fromZ = from ? from.z : self ? self.z : 0
	const panic = world.get(entity, BabyPanic)
	if (panic) {
		panic.panicTicks = BABY_PANIC_TICKS
		panic.source = sourceEntity
		panic.fromX = fromX
		panic.fromZ = fromZ
		// Adding again is a no-op for a live marker and undoes a removal that was
		// buffered earlier in the same tick.
		world.add(entity, BabyPanic, panic)
		return
	}
	world.add(entity, BabyPanic, {
		panicTicks: BABY_PANIC_TICKS,
		source: sourceEntity,
		fromX,
		fromZ,
	})
}

/**
 * Subscribes panic to `EVENT.EntityDamaged` on `bus` and returns the
 * unsubscribe function, so the combat systems never learn about this folder.
 */
export function babyBindPanicToEventBus(world: EcsWorld, bus: EventBusV2): () => void {
	return bus.on(EVENT.EntityDamaged, (payload) => {
		babyBeginPanic(world, payload.entity, payload.source)
	})
}

/**
 * Per tick bookkeeping for babies, love mode, cooldown and panic.
 *
 * Shaped like a `SystemFn` so a future `SYSTEM_ORDER` slot can take it as is,
 * but deliberately not registered: v1.1.0 has no breeding slot and
 * `sim/src/schedule/` is not ours to edit. The host calls it once per tick,
 * after `mobAi`, so baby, love and panic intents win over the generic wander.
 *
 * Movement runs before the countdowns, which is what makes the boundaries
 * exact: a baby still moves on its last baby tick and a panicking mob flees for
 * the full `BABY_PANIC_TICKS`.
 */
export const breedTickSystem: SystemFn = (world, _dt, _tick) => {
	const bus = breedBusOf(world)
	breedApplyMovement(world, breedCollectMobs(world))
	babyTickPanic(world)
	breedTickLove(world, bus)
	breedTickCooldown(world)
	babyTickGrowth(world, bus)
}
