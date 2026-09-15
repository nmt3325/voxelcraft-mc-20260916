/**
 * Portable math for the simulation.
 *
 * `core-types/rng.ts` forbids `Math.sin` / `Math.cos` in generation and
 * simulation because their results are implementation defined, so a replay can
 * diverge between engines. `simSin` / `simCos` use only IEEE-754 `+ - * /`,
 * `Math.round` and comparisons, which are all exactly specified, so every
 * engine agrees bit for bit.
 *
 * Accuracy after folding into [-pi/2, pi/2] with an 11th order Taylor series is
 * better than 1e-7, far below the block scale the simulation cares about.
 */

export const SIM_PI = 3.141592653589793
export const SIM_HALF_PI = 1.5707963267948966
export const SIM_TAU = 6.283185307179586

export function simSin(radians: number): number {
	if (!Number.isFinite(radians)) return 0
	// Range reduce to [-pi, pi]; Math.round is exactly specified.
	let a = radians - SIM_TAU * Math.round(radians / SIM_TAU)
	// Fold into [-pi/2, pi/2] using sin(pi - a) = sin(a).
	if (a > SIM_HALF_PI) a = SIM_PI - a
	else if (a < -SIM_HALF_PI) a = -SIM_PI - a
	const a2 = a * a
	const a3 = a * a2
	const a5 = a3 * a2
	const a7 = a5 * a2
	const a9 = a7 * a2
	const a11 = a9 * a2
	return a - a3 / 6 + a5 / 120 - a7 / 5040 + a9 / 362880 - a11 / 39916800
}

export function simCos(radians: number): number {
	return simSin(radians + SIM_HALF_PI)
}

/** Exact-rounded, so portable. Kept here to discourage `Math.hypot`, which is not. */
export function simLength2(x: number, z: number): number {
	return Math.sqrt(x * x + z * z)
}

export function simLength3(x: number, y: number, z: number): number {
	return Math.sqrt(x * x + y * y + z * z)
}

export function clamp(value: number, min: number, max: number): number {
	return value < min ? min : value > max ? max : value
}

/** Squared horizontal distance; avoids a square root in hot loops. */
export function distance2Sq(ax: number, az: number, bx: number, bz: number): number {
	const dx = ax - bx
	const dz = az - bz
	return dx * dx + dz * dz
}

export function distance3Sq(
	ax: number,
	ay: number,
	az: number,
	bx: number,
	by: number,
	bz: number,
): number {
	const dx = ax - bx
	const dy = ay - by
	const dz = az - bz
	return dx * dx + dy * dy + dz * dz
}
