import { AI_STATE, COMBAT, MOB_SPAWN, PATHFIND, PERF, PHYSICS, makeRng } from '@voxelcraft/core-types'
import type {
	AiState,
	EcsWorld,
	EntityId,
	MobDef,
	SystemFn,
	Tick,
	Vec3f,
} from '@voxelcraft/core-types'
import { CombatHurt } from '../combat/components'
import { combatApplyDamage, combatExplodeCreeper } from '../combat/damage'
import { combatSpawnArrow } from '../combat/projectile'
import { Health, Intent, Transform, type IntentComp, type TransformComp } from '../ecs'
import { pathFindPath, pathRequest } from '../pathfind/astar'
import { PATH_DIRS } from '../pathfind/moves'
import { MobAi, MobPath, MobTag, type MobAiComp } from './components'
import { MOB_RNG_SALT, mobGetContext, type MobSimContext } from './context'
import { mobDefOf, mobEyeHeight, mobShapeOf } from './mobDefs'
import { mobDistance, mobEntityPosition, mobNearestAnchor, mobPlayerAnchors } from './targets'

// Local tuning constants. The contract owns the distances, the cooldowns and
// the tick rate; these only describe how this state machine paces itself.

/** Distance at which a waypoint counts as reached, in blocks. */
export const MOB_WAYPOINT_RADIUS = 0.4
/** Ticks one wander leg lasts. */
export const MOB_WANDER_TICKS = PERF.simTickHz * 2
/** One idle tick in `MOB_WANDER_ODDS` starts a wander leg. */
export const MOB_WANDER_ODDS = PERF.simTickHz * 2
/** Ticks a passive mob keeps running after being hurt. */
export const MOB_FLEE_TICKS = PERF.simTickHz * 2
/** The first four `PATH_DIRS` entries are the cardinal directions. */
const CARDINAL_DIRS = 4

function mobClearIntent(intent: IntentComp | undefined): void {
	if (!intent) return
	intent.forward = 0
	intent.strafe = 0
	intent.jump = false
	intent.sprint = false
	intent.sneak = false
}

/**
 * Writes a movement intent towards (or with `sign = -1` away from) a world
 * position.
 *
 * Deliberately trig free: `Intent.yaw` stays 0, so `forward` is the +Z axis
 * and `strafe` the +X axis, and the normalised direction is written straight
 * into the intent. `MobDef.speed` is expressed as a fraction of
 * `PHYSICS.walkSpeed` (clamped to 1) because `Intent` carries no speed of its
 * own. Resolving the motion is the physics system's job; this only ever
 * touches `Intent`.
 */
function mobSteer(
	intent: IntentComp,
	transform: TransformComp,
	def: MobDef,
	tx: number,
	tz: number,
	sign: number,
): void {
	const dx = (tx - transform.x) * sign
	const dz = (tz - transform.z) * sign
	const length = Math.sqrt(dx * dx + dz * dz)
	intent.yaw = 0
	if (length <= PHYSICS.epsilon) {
		intent.forward = 0
		intent.strafe = 0
		return
	}
	const scale = Math.min(1, def.speed / PHYSICS.walkSpeed)
	intent.forward = (dz / length) * scale
	intent.strafe = (dx / length) * scale
}

/** Enters a state, resetting `stateTicks` and arming the creeper fuse. */
function mobEnterState(ai: MobAiComp, next: AiState): void {
	if (ai.state === next) {
		ai.stateTicks++
		return
	}
	ai.state = next
	ai.stateTicks = 0
	if (next === AI_STATE.Fuse) ai.fuseTicks = COMBAT.creeperFuseTicks
}

/** Plans a fresh path to `target` with the `PATHFIND` budgets. */
function mobRepath(
	world: EcsWorld,
	ctx: MobSimContext,
	entity: EntityId,
	transform: TransformComp,
	def: MobDef,
	target: Vec3f,
	tick: Tick,
): void {
	const path = world.get(entity, MobPath)
	if (!path) return
	const result = pathFindPath(
		pathRequest({
			start: {
				x: Math.floor(transform.x),
				y: Math.floor(transform.y),
				z: Math.floor(transform.z),
			},
			goal: {
				kind: 'near',
				at: {
					x: Math.floor(target.x),
					y: Math.floor(target.y),
					z: Math.floor(target.z),
				},
				radius: 1,
			},
			shape: mobShapeOf(def),
			view: ctx.voxels,
		}),
	)
	path.nodes = result.nodes
	path.moves = result.moves
	path.status = result.status
	// nodes[0] is the start cell, so the first waypoint worth walking to is 1.
	path.index = result.nodes.length > 1 ? 1 : 0
	path.plannedAt = tick
}

/** Steers along the stored path. `false` when there is nothing left to follow. */
function mobFollowPath(
	world: EcsWorld,
	entity: EntityId,
	transform: TransformComp,
	intent: IntentComp,
	def: MobDef,
): boolean {
	const path = world.get(entity, MobPath)
	if (!path) return false
	while (path.index < path.nodes.length) {
		const node = path.nodes[path.index]
		const cx = node.x + 0.5
		const cz = node.z + 0.5
		const dx = cx - transform.x
		const dz = cz - transform.z
		if (Math.sqrt(dx * dx + dz * dz) <= MOB_WAYPOINT_RADIUS) {
			path.index++
			continue
		}
		mobSteer(intent, transform, def, cx, cz, 1)
		// Climbing a step is requested through the intent, never by teleporting.
		intent.jump = node.y > Math.floor(transform.y)
		return true
	}
	return false
}

/**
 * `SYSTEM_ORDER` slot `mobAi`.
 *
 * One `AI_STATE` machine per mob: `idle` / `wander` / `chase` / `attack` /
 * `flee` / `fuse` / `dead`. Targets are acquired at
 * `MOB_SPAWN.chaseStartDistance` and dropped past
 * `MOB_SPAWN.chaseStopDistance` (hysteresis), chasing replans at most every
 * `PATHFIND.repathTicks`, attacks respect `MobDef.attackCooldownTicks` and a
 * creeper detonates after `COMBAT.creeperFuseTicks`.
 *
 * Movement is expressed purely as `Intent` plus the planned path; collision
 * response belongs to the physics system.
 */
export const mobAiSystem: SystemFn = (world, _dt, tick) => {
	const ctx = mobGetContext(world)
	const anchors = mobPlayerAnchors(world)
	for (const entity of world.query([MobTag, MobAi, Transform])) {
		const tag = world.get(entity, MobTag)
		const ai = world.get(entity, MobAi)
		const transform = world.get(entity, Transform)
		if (!tag || !ai || !transform) continue
		const def = mobDefOf(tag.type)
		const intent = world.get(entity, Intent)
		const health = world.get(entity, Health)
		if (health && health.current <= 0) {
			mobClearIntent(intent)
			ai.state = AI_STATE.Dead
			ai.target = -1
			continue
		}
		if (ai.attackCooldown > 0) ai.attackCooldown--
		if (ai.repathCooldown > 0) ai.repathCooldown--
		if (ai.fleeTicks > 0) ai.fleeTicks--

		// React to damage taken since the last tick.
		const hurt = world.get(entity, CombatHurt)
		if (hurt && hurt.tick > ai.hurtSeenTick) {
			ai.hurtSeenTick = hurt.tick
			if (tag.hostile) {
				if (hurt.source !== null && hurt.source >= 0) ai.target = hurt.source
			} else {
				ai.fleeTicks = MOB_FLEE_TICKS
				ai.target = hurt.source ?? -1
			}
		}

		// Target bookkeeping, with the chase start / stop hysteresis.
		let targetPos = ai.target >= 0 ? mobEntityPosition(world, ai.target) : undefined
		if (!targetPos) ai.target = -1
		let targetDist = targetPos
			? mobDistance(transform.x, transform.y, transform.z, targetPos.x, targetPos.y, targetPos.z)
			: Number.POSITIVE_INFINITY
		if (tag.hostile) {
			if (ai.target >= 0 && targetDist > MOB_SPAWN.chaseStopDistance) {
				ai.target = -1
				targetPos = undefined
				targetDist = Number.POSITIVE_INFINITY
			}
			if (ai.target < 0) {
				const nearest = mobNearestAnchor(anchors, transform.x, transform.y, transform.z)
				if (nearest && nearest.dist <= MOB_SPAWN.chaseStartDistance) {
					ai.target = nearest.anchor.entity
					targetPos = { x: nearest.anchor.x, y: nearest.anchor.y, z: nearest.anchor.z }
					targetDist = nearest.dist
				}
			}
		}

		// Pick the next state. A lit fuse keeps burning while the target is
		// anywhere near, otherwise a creeper would defuse on a single step back.
		let next: AiState
		if (!tag.hostile && ai.fleeTicks > 0) {
			next = AI_STATE.Flee
		} else if (
			def.explodes &&
			ai.state === AI_STATE.Fuse &&
			ai.target >= 0 &&
			targetDist <= MOB_SPAWN.chaseStopDistance
		) {
			next = AI_STATE.Fuse
		} else if (tag.hostile && ai.target >= 0 && targetPos) {
			if (targetDist <= def.attackReach) next = def.explodes ? AI_STATE.Fuse : AI_STATE.Attack
			else next = AI_STATE.Chase
		} else if (ai.wanderTicks > 0) {
			next = AI_STATE.Wander
		} else {
			next = AI_STATE.Idle
		}
		mobEnterState(ai, next)

		switch (ai.state) {
			case AI_STATE.Chase: {
				if (ctx && targetPos && ai.repathCooldown === 0) {
					mobRepath(world, ctx, entity, transform, def, targetPos, tick)
					ai.repathCooldown = PATHFIND.repathTicks
				}
				if (intent) {
					const following = mobFollowPath(world, entity, transform, intent, def)
					if (!following && targetPos) {
						mobSteer(intent, transform, def, targetPos.x, targetPos.z, 1)
					}
				}
				break
			}
			case AI_STATE.Attack: {
				mobClearIntent(intent)
				if (!targetPos || ai.attackCooldown > 0) break
				if (def.ranged) {
					combatSpawnArrow(world, {
						owner: entity,
						from: {
							x: transform.x,
							y: transform.y + mobEyeHeight(def),
							z: transform.z,
						},
						to: {
							x: targetPos.x,
							y: targetPos.y + PHYSICS.playerHeight * 0.5,
							z: targetPos.z,
						},
					})
				} else {
					combatApplyDamage(world, {
						target: ai.target,
						amount: def.attackDamage,
						source: entity,
						knockbackFrom: { x: transform.x, y: transform.y, z: transform.z },
						tick,
					})
				}
				ai.attackCooldown = def.attackCooldownTicks
				break
			}
			case AI_STATE.Fuse: {
				mobClearIntent(intent)
				if (ai.fuseTicks > 0) ai.fuseTicks--
				if (ai.fuseTicks <= 0) {
					combatExplodeCreeper(world, entity, tick)
					ai.state = AI_STATE.Dead
					ai.target = -1
				}
				break
			}
			case AI_STATE.Flee: {
				if (!intent) break
				const from = ai.target >= 0 ? mobEntityPosition(world, ai.target) : undefined
				if (from) {
					mobSteer(intent, transform, def, from.x, from.z, -1)
				} else {
					mobSteer(
						intent,
						transform,
						def,
						transform.x + ai.wanderX,
						transform.z + ai.wanderZ,
						1,
					)
				}
				intent.sprint = true
				break
			}
			case AI_STATE.Wander: {
				if (ai.wanderTicks > 0) ai.wanderTicks--
				if (intent) {
					mobSteer(
						intent,
						transform,
						def,
						transform.x + ai.wanderX,
						transform.z + ai.wanderZ,
						1,
					)
				}
				break
			}
			case AI_STATE.Idle: {
				mobClearIntent(intent)
				const rng = makeRng(ctx ? ctx.seed : 0, MOB_RNG_SALT.wander, tick, entity)
				if (rng.nextInt(MOB_WANDER_ODDS) === 0) {
					const dir = PATH_DIRS[rng.nextInt(CARDINAL_DIRS)]
					ai.wanderX = dir.dx
					ai.wanderZ = dir.dz
					ai.wanderTicks = MOB_WANDER_TICKS
				}
				break
			}
			default: {
				mobClearIntent(intent)
				break
			}
		}
	}
}
