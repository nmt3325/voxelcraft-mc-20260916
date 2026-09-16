import { COMBAT } from '@voxelcraft/core-types'
import type { EntityId, Tick } from '@voxelcraft/core-types'
import { defineComponent } from '../ecs'

/**
 * Flight data of an in-flight projectile. The velocity itself lives on the
 * shared `Velocity` component so the rest of the simulation can read it.
 */
export interface CombatProjectileComp {
	/** Entity that fired the projectile. Never hit by its own projectile. */
	owner: EntityId
	damage: number
	/** Blocks per second squared (`COMBAT.arrowGravity` for arrows). */
	gravity: number
	/** Ticks left before the projectile despawns. */
	lifeTicks: number
}

export const CombatProjectile = defineComponent<CombatProjectileComp>('combatProjectile', () => ({
	owner: -1,
	damage: COMBAT.arrowDamage,
	gravity: COMBAT.arrowGravity,
	lifeTicks: 0,
}))

/**
 * Marker written by `combatApplyDamage` on the tick an entity takes damage.
 * The AI reads it to decide whether a passive mob should flee and who to
 * retaliate against; it is overwritten, never queued.
 */
export interface CombatHurtComp {
	amount: number
	source: EntityId | null
	tick: Tick
}

export const CombatHurt = defineComponent<CombatHurtComp>('combatHurt', () => ({
	amount: 0,
	source: null,
	tick: -1,
}))
