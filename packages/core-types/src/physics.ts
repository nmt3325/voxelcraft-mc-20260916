import type { Face, Vec3f, Vec3i } from './ids'
import type { VoxelView } from './world'

export interface AABB {
	minX: number
	minY: number
	minZ: number
	maxX: number
	maxY: number
	maxZ: number
}

/** Units are blocks and seconds. Frozen for v1. */
export const PHYSICS = {
	gravity: 32,
	terminalVelocity: 78.4,
	walkSpeed: 4.317,
	sprintSpeed: 5.612,
	sneakSpeed: 1.295,
	swimSpeed: 2.2,
	jumpVelocity: 8.4,
	playerWidth: 0.6,
	playerHeight: 1.8,
	playerEyeHeight: 1.62,
	sneakEyeHeight: 1.54,
	stepHeight: 0.6,
	epsilon: 1e-3,
	/** Split movement so no sub step exceeds this distance (tunnelling guard). */
	maxSubStepBlocks: 0.45,
	maxSubSteps: 8,
	reach: 5,
	fallDamageFreeBlocks: 3,
	waterDrag: 0.8,
	waterBuoyancy: 0.5,
	knockbackHorizontal: 5.2,
	knockbackVertical: 3.6,
} as const

export interface MoveResult {
	box: AABB
	dx: number
	dy: number
	dz: number
	onGround: boolean
	hitX: boolean
	hitY: boolean
	hitZ: boolean
	steppedUp: boolean
	inWater: boolean
	inLava: boolean
}

/** Axis resolution order is fixed: Y, then X, then Z. */
export type MoveEntity = (
	box: AABB,
	velocity: Vec3f,
	view: VoxelView,
	opts: { stepHeight: number; epsilon: number; maxSubStepBlocks: number },
) => MoveResult

export interface RayHit {
	block: Vec3i
	normal: Vec3i
	distance: number
	face: Face
}

/** Amanatides and Woo voxel DDA. */
export type RaycastVoxels = (
	origin: Vec3f,
	dir: Vec3f,
	maxDistance: number,
	view: VoxelView,
) => RayHit | null

export function fallDamage(fallenBlocks: number): number {
	return Math.max(0, Math.floor(fallenBlocks - PHYSICS.fallDamageFreeBlocks))
}
