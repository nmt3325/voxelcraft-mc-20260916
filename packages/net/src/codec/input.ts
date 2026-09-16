/**
 * Input rides every client tick as one bitfield instead of nine booleans, so
 * all of the bit math lives here: the client HUD and the server simulation
 * cannot drift about which bit means what if neither of them open-codes it.
 */
import { INPUT_BIT } from '@voxelcraft/core-types'

export type InputName = keyof typeof INPUT_BIT
export type InputFlags = Partial<Record<InputName, boolean>>

/** INPUT_BIT declaration order, which is also the order describeInput reports. */
const INPUT_NAMES = Object.keys(INPUT_BIT) as InputName[]

const TAU = Math.PI * 2
const PITCH_LIMIT = Math.PI / 2

export function hasInput(bits: number, bit: number): boolean {
	return (bits & bit) !== 0
}

export function setInput(bits: number, bit: number, on: boolean): number {
	return on ? bits | bit : bits & ~bit
}

export function inputBitsFrom(flags: InputFlags): number {
	let bits = 0
	for (const name of INPUT_NAMES) {
		if (flags[name]) bits |= INPUT_BIT[name]
	}
	return bits
}

/** Set bit names, for logs and the debug overlay. */
export function describeInput(bits: number): InputName[] {
	return INPUT_NAMES.filter((name) => hasInput(bits, INPUT_BIT[name]))
}

/**
 * Normalizes a look angle before anything trusts it. A client may send any f32,
 * and an unwrapped yaw would make server-side angle differences jump by a full
 * turn, so yaw wraps into [-PI, PI) and pitch clamps into [-PI/2, PI/2].
 */
export function clampYawPitch(yaw: number, pitch: number): { yaw: number; pitch: number } {
	return { yaw: wrapYaw(yaw), pitch: clampPitch(pitch) }
}

function wrapYaw(yaw: number): number {
	// A non-finite angle would poison every later comparison, so it collapses to
	// straight ahead instead of propagating NaN through the simulation.
	if (!Number.isFinite(yaw)) return 0
	let wrapped = yaw % TAU
	if (wrapped >= Math.PI) wrapped -= TAU
	else if (wrapped < -Math.PI) wrapped += TAU
	return wrapped
}

function clampPitch(pitch: number): number {
	if (!Number.isFinite(pitch)) return 0
	return Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, pitch))
}
