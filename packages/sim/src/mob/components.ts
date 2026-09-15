import { AI_STATE, MOB } from '@voxelcraft/core-types'
import type {
	AiState,
	EntityId,
	MobType,
	MoveKind,
	PathResult,
	Tick,
	Vec3i,
} from '@voxelcraft/core-types'
import { defineComponent } from '../ecs'

/** Marks an entity as a mob and caches the hostility of its definition. */
export interface MobTagComp {
	type: MobType
	hostile: boolean
}

export const MobTag = defineComponent<MobTagComp>('mobTag', () => ({
	type: MOB.Pig,
	hostile: false,
}))

/** Mutable state of the `AI_STATE` state machine. */
export interface MobAiComp {
	state: AiState
	/** Ticks spent in the current state. */
	stateTicks: number
	/** Target entity, or `-1` when the mob has no target. */
	target: EntityId
	/** Ticks until the next attack is allowed. */
	attackCooldown: number
	/** Creeper fuse countdown. Only meaningful in the `fuse` state. */
	fuseTicks: number
	/** Ticks until A* may run again (`PATHFIND.repathTicks`). */
	repathCooldown: number
	/** Ticks until the wander direction is rerolled. */
	wanderTicks: number
	/** Wander direction on X, taken from `PATH_DIRS`. */
	wanderX: number
	/** Wander direction on Z, taken from `PATH_DIRS`. */
	wanderZ: number
	/** Ticks left of a flee reaction. */
	fleeTicks: number
	/** Tick of the last hurt marker this mob already reacted to. */
	hurtSeenTick: Tick
}

/** Initial AI state of a freshly spawned mob. */
export function mobInitialAi(): MobAiComp {
	return {
		state: AI_STATE.Idle,
		stateTicks: 0,
		target: -1,
		attackCooldown: 0,
		fuseTicks: 0,
		repathCooldown: 0,
		wanderTicks: 0,
		wanderX: 0,
		wanderZ: 0,
		fleeTicks: 0,
		hurtSeenTick: -1,
	}
}

export const MobAi = defineComponent<MobAiComp>('mobAi', mobInitialAi)

/** The A* result the mob is currently following. */
export interface MobPathComp {
	nodes: Vec3i[]
	moves: MoveKind[]
	/** Index of the waypoint the mob is walking towards. */
	index: number
	status: PathResult['status'] | 'none'
	/** Tick the path was planned on, or `-1` when there is no path. */
	plannedAt: Tick
}

export const MobPath = defineComponent<MobPathComp>('mobPath', () => ({
	nodes: [],
	moves: [],
	index: 0,
	status: 'none',
	plannedAt: -1,
}))
