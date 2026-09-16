/**
 * Authoritative movement.
 *
 * NetInput carries intent - a bitfield plus look angles - and never a position,
 * so the server derives the position itself and a client cannot smuggle a
 * teleport through an input packet. The rules here are deliberately simple and
 * deterministic; clampMovement still caps whatever this produces, so a bug in
 * this file can make a player walk oddly but can never break the speed limit.
 */
import { INPUT_BIT, NET, type NetInput } from '@voxelcraft/core-types'
import { hasInput } from '@voxelcraft/net'
import type { DesiredMove, PlayerState, ServerWorld } from './types'

/** Blocks per second at a walk, expressed per tick. */
export const WALK_SPEED = 4.317 / NET.tickHz
export const SPRINT_MULTIPLIER = 1.3
export const SNEAK_MULTIPLIER = 0.3
/** How far above the ground one Jump input lifts a player. */
export const JUMP_HEIGHT = 1.25

/** Axis intent in the -1..1 range, before the yaw rotation. */
export function moveAxes(bits: number): { forward: number; strafe: number } {
	let forward = 0
	let strafe = 0
	if (hasInput(bits, INPUT_BIT.Forward)) forward += 1
	if (hasInput(bits, INPUT_BIT.Back)) forward -= 1
	if (hasInput(bits, INPUT_BIT.Right)) strafe += 1
	if (hasInput(bits, INPUT_BIT.Left)) strafe -= 1
	return { forward, strafe }
}

/** Per-tick speed for a bitfield. Sprint and sneak multiply, they do not add. */
export function speedFor(bits: number): number {
	let speed = WALK_SPEED
	if (hasInput(bits, INPUT_BIT.Sprint)) speed *= SPRINT_MULTIPLIER
	if (hasInput(bits, INPUT_BIT.Sneak)) speed *= SNEAK_MULTIPLIER
	return speed
}

/**
 * Where the player wants to be after applying one input, terrain included.
 * Diagonal intent is normalised so holding two keys is not faster than one.
 */
export function desiredMoveFor(
	player: PlayerState,
	input: NetInput,
	world: ServerWorld,
): DesiredMove {
	const { forward, strafe } = moveAxes(input.bits)
	const magnitude = Math.hypot(forward, strafe)
	let x = player.x
	let z = player.z
	if (magnitude > 0) {
		const speed = speedFor(input.bits)
		const f = (forward / magnitude) * speed
		const s = (strafe / magnitude) * speed
		const sin = Math.sin(input.yaw)
		const cos = Math.cos(input.yaw)
		// yaw 0 faces +z and increasing yaw turns toward -x.
		x += -sin * f + cos * s
		z += cos * f + sin * s
	}
	// No falling simulation yet: the server puts the player on the ground it
	// owns, which is also what stops a client from claiming it is flying.
	const ground = world.surfaceY(Math.floor(x), Math.floor(z))
	const y = hasInput(input.bits, INPUT_BIT.Jump) ? ground + JUMP_HEIGHT : ground
	return { x, y, z, yaw: input.yaw, pitch: input.pitch }
}
