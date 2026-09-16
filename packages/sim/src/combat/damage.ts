import { COMBAT, EVENT, PHYSICS } from '@voxelcraft/core-types'
import type { EcsWorld, EntityId, SystemFn, Tick, Vec3f } from '@voxelcraft/core-types'
import { Despawn, Health, PhysicsState, PlayerTag, Transform, Velocity } from '../ecs'
import { mobGetContext } from '../mob/context'
import { CombatHurt } from './components'

/** Arguments of `combatApplyDamage`. */
export interface CombatDamageInput {
	target: EntityId
	/** Damage in half hearts. Values `<= 0` are ignored. */
	amount: number
	/** Entity responsible for the damage, or `null` for the environment. */
	source?: EntityId | null
	/** When set, knockback is applied away from this position. */
	knockbackFrom?: Vec3f
	tick: Tick
	/** Ignores the remaining invulnerability window (fall damage, explosions). */
	bypassInvulnerable?: boolean
}

/**
 * Applies damage to an entity and returns `true` when the hit landed.
 *
 * Damage is refused while `Health.invulnerableTicks` is still counting down
 * unless `bypassInvulnerable` is set. A hit that lands always restarts the
 * window with `COMBAT.invulnerableTicks`, records a `CombatHurt` marker for
 * the AI and emits `entity.damaged`.
 */
export function combatApplyDamage(world: EcsWorld, input: CombatDamageInput): boolean {
	const health = world.get(input.target, Health)
	if (!health || health.current <= 0) return false
	if (input.bypassInvulnerable !== true && health.invulnerableTicks > 0) return false
	const amount = input.amount > 0 ? input.amount : 0
	if (amount === 0) return false
	const source = input.source ?? null
	health.current = Math.max(0, health.current - amount)
	health.invulnerableTicks = COMBAT.invulnerableTicks
	const hurt = world.get(input.target, CombatHurt)
	if (hurt) {
		hurt.amount = amount
		hurt.source = source
		hurt.tick = input.tick
	} else {
		world.add(input.target, CombatHurt, { amount, source, tick: input.tick })
	}
	if (input.knockbackFrom) combatApplyKnockback(world, input.target, input.knockbackFrom)
	mobGetContext(world)?.bus?.emit(EVENT.EntityDamaged, { entity: input.target, amount, source })
	if (health.current <= 0) combatKillEntity(world, input.target, input.tick)
	return true
}

/**
 * Pushes an entity away from `from` with `PHYSICS.knockbackHorizontal` and
 * `PHYSICS.knockbackVertical`. Only `Velocity` is touched: resolving the
 * resulting motion is the physics system's job.
 */
export function combatApplyKnockback(world: EcsWorld, target: EntityId, from: Vec3f): boolean {
	const velocity = world.get(target, Velocity)
	const transform = world.get(target, Transform)
	if (!velocity || !transform) return false
	let dx = transform.x - from.x
	let dz = transform.z - from.z
	const lengthSq = dx * dx + dz * dz
	if (lengthSq > PHYSICS.epsilon * PHYSICS.epsilon) {
		const length = Math.sqrt(lengthSq)
		dx /= length
		dz /= length
	} else {
		dx = 0
		dz = 0
	}
	velocity.x += dx * PHYSICS.knockbackHorizontal
	velocity.z += dz * PHYSICS.knockbackHorizontal
	velocity.y += PHYSICS.knockbackVertical
	return true
}

/** Zeroes health, marks the entity dead for the despawn system, emits `entity.died`. */
export function combatKillEntity(world: EcsWorld, entity: EntityId, tick: Tick): void {
	const health = world.get(entity, Health)
	if (health) health.current = 0
	const transform = world.get(entity, Transform)
	const at: Vec3f = transform
		? { x: transform.x, y: transform.y, z: transform.z }
		: { x: 0, y: 0, z: 0 }
	const despawn = world.get(entity, Despawn)
	if (despawn) {
		despawn.reason = 'dead'
		despawn.tick = tick
	} else {
		world.add(entity, Despawn, { reason: 'dead', tick })
	}
	mobGetContext(world)?.bus?.emit(EVENT.EntityDied, { entity, at })
}

/**
 * `SYSTEM_ORDER` slot `combat`.
 *
 * Counts the invulnerability windows down, converts the fall damage produced
 * by the physics system into real damage and regenerates players every
 * `COMBAT.regenIntervalTicks`.
 */
export const combatSystem: SystemFn = (world, _dt, tick) => {
	for (const entity of world.query([Health])) {
		const health = world.get(entity, Health)
		if (!health) continue
		if (health.invulnerableTicks > 0) health.invulnerableTicks--
		const physics = world.get(entity, PhysicsState)
		if (physics && physics.pendingFallDamage > 0) {
			const amount = physics.pendingFallDamage
			physics.pendingFallDamage = 0
			combatApplyDamage(world, {
				target: entity,
				amount,
				source: null,
				tick,
				bypassInvulnerable: true,
			})
		}
		if (
			health.current > 0 &&
			health.current < health.max &&
			tick > 0 &&
			tick % COMBAT.regenIntervalTicks === 0 &&
			world.has(entity, PlayerTag)
		) {
			health.current = Math.min(health.max, health.current + 1)
		}
	}
}

/** Arguments of `combatExplode`. */
export interface CombatExplosionInput {
	at: Vec3f
	/** Blocks. Damage falls off linearly to zero at this distance. */
	radius: number
	/** Damage at the centre of the blast. */
	damage: number
	source?: EntityId | null
	/** Entity excluded from the blast, usually the exploding mob itself. */
	skip?: EntityId | null
	tick: Tick
}

/**
 * Damages every entity within `radius`, scaled linearly by distance, and
 * knocks it away from the blast. Blocks are left untouched: terrain damage is
 * not part of this subtree. Returns the number of entities hurt.
 */
export function combatExplode(world: EcsWorld, input: CombatExplosionInput): number {
	const radius = input.radius > 0 ? input.radius : 0
	if (radius === 0) return 0
	const skip = input.skip ?? null
	let hits = 0
	for (const entity of world.query([Health, Transform])) {
		if (entity === skip) continue
		const health = world.get(entity, Health)
		const transform = world.get(entity, Transform)
		if (!health || !transform || health.current <= 0) continue
		const dx = transform.x - input.at.x
		const dy = transform.y - input.at.y
		const dz = transform.z - input.at.z
		const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
		if (distance > radius) continue
		const amount = Math.max(1, Math.round(input.damage * (1 - distance / radius)))
		const hurt = combatApplyDamage(world, {
			target: entity,
			amount,
			source: input.source ?? null,
			knockbackFrom: input.at,
			tick: input.tick,
			bypassInvulnerable: true,
		})
		if (hurt) hits++
	}
	mobGetContext(world)?.bus?.emit(EVENT.SoundPlay, {
		name: 'entity.generic.explode',
		at: { x: input.at.x, y: input.at.y, z: input.at.z },
		volume: 4,
		pitch: 1,
	})
	return hits
}

/**
 * Detonates a creeper using `COMBAT.creeperRadius` and `COMBAT.creeperDamage`.
 * The creeper is consumed by its own blast.
 */
export function combatExplodeCreeper(world: EcsWorld, creeper: EntityId, tick: Tick): number {
	const transform = world.get(creeper, Transform)
	if (!transform) return 0
	const hits = combatExplode(world, {
		at: { x: transform.x, y: transform.y, z: transform.z },
		radius: COMBAT.creeperRadius,
		damage: COMBAT.creeperDamage,
		source: creeper,
		skip: creeper,
		tick,
	})
	combatKillEntity(world, creeper, tick)
	return hits
}
