import { COMBAT, PERF, PHYSICS } from '@voxelcraft/core-types'
import type { EcsWorld, EntityId, SystemFn, Vec3f } from '@voxelcraft/core-types'
import { Collider, Health, Transform, Velocity } from '../ecs'
import { mobGetContext } from '../mob/context'
import { mobMarkDespawn } from '../mob/despawn'
import { CombatProjectile } from './components'
import { combatApplyDamage } from './damage'

/** Arrows disappear after five seconds if they hit nothing. */
export const COMBAT_ARROW_LIFE_TICKS = PERF.simTickHz * 5

/**
 * Launch velocity of a ballistic shot from `from` to `to`.
 *
 * The flight time is estimated from the straight line distance and the given
 * speed, then the vertical component is raised by `0.5 * gravity * time` so the
 * projectile arrives at the target height. Pure arithmetic on the inputs, so
 * identical inputs always produce identical trajectories.
 */
export function combatArrowVelocity(
	from: Vec3f,
	to: Vec3f,
	speed: number = COMBAT.arrowSpeed,
	gravity: number = COMBAT.arrowGravity,
): Vec3f {
	const dx = to.x - from.x
	const dy = to.y - from.y
	const dz = to.z - from.z
	const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
	if (distance <= PHYSICS.epsilon || speed <= 0) return { x: 0, y: 0, z: 0 }
	const time = distance / speed
	return { x: dx / time, y: dy / time + 0.5 * gravity * time, z: dz / time }
}

/** Arguments of `combatSpawnArrow`. */
export interface CombatArrowInput {
	owner: EntityId
	from: Vec3f
	to: Vec3f
	damage?: number
	speed?: number
	gravity?: number
	lifeTicks?: number
}

/**
 * Spawns an arrow at `from` aimed at `to`. Defaults come from `COMBAT`
 * (`arrowDamage`, `arrowSpeed`, `arrowGravity`).
 */
export function combatSpawnArrow(world: EcsWorld, input: CombatArrowInput): EntityId {
	const gravity = input.gravity ?? COMBAT.arrowGravity
	const velocity = combatArrowVelocity(
		input.from,
		input.to,
		input.speed ?? COMBAT.arrowSpeed,
		gravity,
	)
	const entity = world.create()
	world.add(entity, Transform, {
		x: input.from.x,
		y: input.from.y,
		z: input.from.z,
		yaw: 0,
		pitch: 0,
	})
	world.add(entity, Velocity, { x: velocity.x, y: velocity.y, z: velocity.z })
	world.add(entity, CombatProjectile, {
		owner: input.owner,
		damage: input.damage ?? COMBAT.arrowDamage,
		gravity,
		lifeTicks: input.lifeTicks ?? COMBAT_ARROW_LIFE_TICKS,
	})
	return entity
}

/** First living entity whose collision box contains `point`. `-1` when none. */
function combatHitAt(
	world: EcsWorld,
	point: Vec3f,
	projectile: EntityId,
	owner: EntityId,
): EntityId {
	for (const entity of world.query([Health, Transform, Collider])) {
		if (entity === projectile || entity === owner) continue
		const health = world.get(entity, Health)
		const transform = world.get(entity, Transform)
		const collider = world.get(entity, Collider)
		if (!health || !transform || !collider || health.current <= 0) continue
		const half = collider.width / 2
		if (point.x < transform.x - half || point.x > transform.x + half) continue
		if (point.z < transform.z - half || point.z > transform.z + half) continue
		if (point.y < transform.y || point.y > transform.y + collider.height) continue
		return entity
	}
	return -1
}

/**
 * `SYSTEM_ORDER` slot `projectile`.
 *
 * Integrates projectiles with `COMBAT.arrowGravity`, sub-stepping so a fast
 * arrow cannot tunnel through a block (`PHYSICS.maxSubStepBlocks`, capped by
 * `PHYSICS.maxSubSteps`). Entity hits deal the projectile damage with
 * knockback; block hits stop the arrow. Spent arrows are marked `expired` and
 * removed by the despawn system.
 */
export const combatProjectileSystem: SystemFn = (world, dt, tick) => {
	const ctx = mobGetContext(world)
	for (const entity of world.query([CombatProjectile, Transform, Velocity])) {
		const projectile = world.get(entity, CombatProjectile)
		const transform = world.get(entity, Transform)
		const velocity = world.get(entity, Velocity)
		if (!projectile || !transform || !velocity) continue
		if (projectile.lifeTicks <= 0) {
			mobMarkDespawn(world, entity, 'expired', tick)
			continue
		}
		projectile.lifeTicks--
		velocity.y -= projectile.gravity * dt
		const speed = Math.sqrt(
			velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z,
		)
		const steps = Math.min(
			PHYSICS.maxSubSteps,
			Math.max(1, Math.ceil((speed * dt) / PHYSICS.maxSubStepBlocks)),
		)
		const step = dt / steps
		for (let i = 0; i < steps; i++) {
			transform.x += velocity.x * step
			transform.y += velocity.y * step
			transform.z += velocity.z * step
			const point: Vec3f = { x: transform.x, y: transform.y, z: transform.z }
			const victim = combatHitAt(world, point, entity, projectile.owner)
			if (victim >= 0) {
				combatApplyDamage(world, {
					target: victim,
					amount: projectile.damage,
					source: projectile.owner,
					knockbackFrom: point,
					tick,
				})
				velocity.x = 0
				velocity.y = 0
				velocity.z = 0
				mobMarkDespawn(world, entity, 'expired', tick)
				break
			}
			if (!ctx) continue
			const bx = Math.floor(transform.x)
			const by = Math.floor(transform.y)
			const bz = Math.floor(transform.z)
			if (!ctx.voxels.inBounds(by) || ctx.voxels.isSolid(bx, by, bz)) {
				velocity.x = 0
				velocity.y = 0
				velocity.z = 0
				mobMarkDespawn(world, entity, 'expired', tick)
				break
			}
		}
	}
}
