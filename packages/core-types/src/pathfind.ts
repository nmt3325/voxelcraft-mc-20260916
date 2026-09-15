import type { Vec3i } from './ids'
import type { VoxelView } from './world'

export const MOVE_KIND = {
	Traverse: 'traverse',
	Diagonal: 'diagonal',
	Ascend: 'ascend',
	Descend: 'descend',
	Fall: 'fall',
	Swim: 'swim',
} as const
export type MoveKind = (typeof MOVE_KIND)[keyof typeof MOVE_KIND]

/** Heuristic must stay admissible: octile distance scaled by the cheapest move. */
export const MOVE_COST = {
	traverse: 1,
	diagonal: 1.414,
	ascend: 1.5,
	descend: 1,
	fallPerBlock: 0.3,
	swim: 2,
} as const

export interface AgentShape {
	width: number
	height: number
	jumpHeight: number
	maxFallDist: number
	canSwim: boolean
}

export type PathGoal =
	| { kind: 'block'; at: Vec3i }
	| { kind: 'near'; at: Vec3i; radius: number }
	| { kind: 'runAway'; from: Vec3i; minDistance: number }

export interface PathRequest {
	start: Vec3i
	goal: PathGoal
	shape: AgentShape
	view: VoxelView
	maxNodes: number
	maxMillis: number
}

export interface PathResult {
	status: 'found' | 'partial' | 'failed'
	/** Smoothed waypoints, nodes[0] is always start. */
	nodes: Vec3i[]
	/** moves[i] describes the step from nodes[i] to nodes[i + 1]. */
	moves: MoveKind[]
	expanded: number
	millis: number
	cost: number
}

export type FindPath = (req: PathRequest) => PathResult

export const PATHFIND = {
	repathTicks: 10,
	maxNodes: 3000,
	maxMillis: 2,
	/** Unloaded chunks are passable but expensive, never impassable. */
	unloadedPenalty: 20,
} as const
