/**
 * Locomotion: walking, sprinting, sneaking, jumping, swimming, falling.
 *
 * Every number comes from `PHYSICS`. The only local tuning value is
 * `AIR_CONTROL`, because the contract does not define mid-air steering.
 *
 * Vertical integration is Minecraft style: a tick moves with the velocity it
 * starts with and gravity is applied afterwards. The discrete jump apex is
 * therefore 0.05 * (8.4 + 6.8 + 5.2 + 3.6 + 2.0 + 0.4) = 1.32 blocks, slightly
 * above the analytic jumpVelocity^2 / (2 * gravity) = 1.1025. That is what
 * makes a 1.0 ledge climbable by jumping while 1.5 stays out of reach.
 *
 * Water behaviour: horizontal velocity relaxes towards the swim speed with
 * `PHYSICS.waterDrag`, so with no input the speed decays by that factor every
 * tick, and gravity is scaled by `1 - PHYSICS.waterBuoyancy`.
 *
 * Fall damage uses the highest feet height since the entity last touched the
 * ground, corrected by the epsilon contact skin, so a clean 5 block drop
 * reports exactly 5 blocks and `fallDamage` from the contract decides the rest.
 */
import { PHYSICS, fallDamage } from '@voxelcraft/core-types'
import type { AABB, EcsWorld, MoveResult, SystemFn, VoxelView } from '@voxelcraft/core-types'
import { Collider, Intent, PhysicsState, Transform, Velocity } from '../ecs'
import type { IntentComp } from '../ecs'
import { simCos, simSin } from '../shared/math'
import { aabbCenterX, aabbCenterZ, entityBox } from './aabb'
import { DEFAULT_MOVE_OPTIONS, isOnGround, moveEntity, probeFluids } from './move'
import type { MoveOptions } from './move'

/** Not a contract constant: the contract defines no mid-air control factor. */
export const AIR_CONTROL = 0.2

export const ZERO_INTENT: Readonly<IntentComp> = Object.freeze({
	forward: 0,
	strafe: 0,
	jump: false,
	sprint: false,
	sneak: false,
	yaw: 0,
})

export interface LocomotionState {
	box: AABB
	vx: number
	vy: number
	vz: number
	onGround: boolean
	inWater: boolean
	inLava: boolean
	/** Highest feet height since last touching the ground. */
	fallStartY: number
}

export interface LocomotionStep {
	state: LocomotionState
	move: MoveResult
	/** Damage caused by landing on this tick; 0 otherwise. */
	damage: number
}

export function createLocomotionState(box: AABB): LocomotionState {
	return {
		box,
		vx: 0,
		vy: 0,
		vz: 0,
		onGround: false,
		inWater: false,
		inLava: false,
		fallStartY: box.minY,
	}
}

/** Horizontal speed the intent asks for. Sneaking wins over sprinting. */
export function targetSpeed(intent: Readonly<IntentComp>, inWater: boolean): number {
	if (inWater) return PHYSICS.swimSpeed
	if (intent.sneak) return PHYSICS.sneakSpeed
	if (intent.sprint) return PHYSICS.sprintSpeed
	return PHYSICS.walkSpeed
}

/** Intent in world space. yaw 0 faces +Z and grows towards +X. */
export function intentToWorld(intent: Readonly<IntentComp>): { x: number; z: number } {
	let forward = intent.forward
	let strafe = intent.strafe
	const magnitude = Math.sqrt(forward * forward + strafe * strafe)
	if (magnitude > 1) {
		forward /= magnitude
		strafe /= magnitude
	}
	const sin = simSin(intent.yaw)
	const cos = simCos(intent.yaw)
	return { x: forward * sin + strafe * cos, z: forward * cos - strafe * sin }
}

export function stepLocomotion(
	state: LocomotionState,
	intent: Readonly<IntentComp>,
	view: VoxelView,
	dt: number,
	opts: MoveOptions = DEFAULT_MOVE_OPTIONS,
): LocomotionStep {
	const fluids = probeFluids(state.box, view, opts.epsilon)
	const inWater = fluids.water
	const inLava = fluids.lava
	const submerged = inWater || inLava
	const grounded = isOnGround(state.box, view, opts.epsilon)

	const wish = intentToWorld(intent)
	const speed = targetSpeed(intent, inWater)
	const control = submerged ? 1 - PHYSICS.waterDrag : grounded ? 1 : AIR_CONTROL
	let vx = state.vx + (wish.x * speed - state.vx) * control
	let vz = state.vz + (wish.z * speed - state.vz) * control
	let vy = state.vy

	if (intent.jump) {
		if (submerged) vy = PHYSICS.swimSpeed
		else if (grounded) vy = PHYSICS.jumpVelocity
	}

	// This tick moves with the velocity it starts with; gravity is applied
	// afterwards, for the next tick. Applying gravity first would cut the
	// discrete jump apex down to 0.9 blocks, and a one block ledge could then be
	// climbed neither by stepping (stepHeight 0.6) nor by jumping.
	const move = moveEntity(state.box, { x: vx * dt, y: vy * dt, z: vz * dt }, view, opts)
	if (move.hitX) vx = 0
	if (move.hitZ) vz = 0
	if (move.hitY) vy = 0

	if (submerged) {
		vy = vy * PHYSICS.waterDrag - PHYSICS.gravity * (1 - PHYSICS.waterBuoyancy) * dt
	} else {
		vy -= PHYSICS.gravity * dt
	}
	if (vy < -PHYSICS.terminalVelocity) vy = -PHYSICS.terminalVelocity
	else if (vy > PHYSICS.terminalVelocity) vy = PHYSICS.terminalVelocity

	const feet = move.box.minY
	let fallStartY = state.fallStartY
	if (grounded && !move.onGround) fallStartY = Math.max(state.box.minY, feet)
	if (feet > fallStartY) fallStartY = feet

	let damage = 0
	if (move.onGround) {
		if (!submerged && !move.steppedUp) {
			const fallen = Math.max(0, fallStartY - feet + opts.epsilon * 2)
			damage = fallDamage(fallen)
		}
		fallStartY = feet
	} else if (submerged) {
		fallStartY = feet
	}

	return {
		state: {
			box: move.box,
			vx,
			vy,
			vz,
			onGround: move.onGround,
			inWater: move.inWater,
			inLava: move.inLava,
			fallStartY,
		},
		move,
		damage,
	}
}

/**
 * The `physics` system: integrates every entity that has a transform, a
 * velocity, a collider and a physics state. Mob AI and player input only write
 * `Intent`, so collision resolution lives in exactly one place.
 */
export function createPhysicsSystem(
	view: VoxelView,
	opts: MoveOptions = DEFAULT_MOVE_OPTIONS,
): SystemFn {
	return (world: EcsWorld, dt: number): void => {
		for (const entity of world.query([Transform, Velocity, Collider, PhysicsState])) {
			const transform = world.get(entity, Transform)
			const velocity = world.get(entity, Velocity)
			const collider = world.get(entity, Collider)
			const physics = world.get(entity, PhysicsState)
			if (!transform || !velocity || !collider || !physics) continue
			const intent = world.get(entity, Intent) ?? ZERO_INTENT
			const box = entityBox(transform.x, transform.y, transform.z, collider.width, collider.height)
			const result = stepLocomotion(
				{
					box,
					vx: velocity.x,
					vy: velocity.y,
					vz: velocity.z,
					onGround: physics.onGround,
					inWater: physics.inWater,
					inLava: physics.inLava,
					fallStartY: physics.fallStartY ?? transform.y,
				},
				intent,
				view,
				dt,
				opts,
			)
			const next = result.state
			transform.x = aabbCenterX(next.box)
			transform.y = next.box.minY
			transform.z = aabbCenterZ(next.box)
			velocity.x = next.vx
			velocity.y = next.vy
			velocity.z = next.vz
			physics.onGround = next.onGround
			physics.inWater = next.inWater
			physics.inLava = next.inLava
			physics.steppedUp = result.move.steppedUp
			physics.fallStartY = next.fallStartY
			physics.fallDistance = Math.max(0, next.fallStartY - next.box.minY)
			if (result.damage > 0) physics.pendingFallDamage += result.damage
		}
		world.flush()
	}
}
