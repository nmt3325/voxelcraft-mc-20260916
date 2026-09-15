/**
 * Improved Perlin noise.
 *
 * Owned by task world-b. Every function is a pure function of
 * (seed, salt, coordinates): gradients come from hashU32, so a value never
 * depends on how many samples were taken before it. That is what keeps
 * parallel and reordered chunk generation byte identical.
 *
 * Trigonometric helpers are deliberately unused: the gradient tables below are
 * fixed literals instead.
 */
import { hashU32 } from '@voxelcraft/core-types'

/** 8 gradients for 2D: 4 axis aligned plus 4 diagonals of length sqrt(2). */
const GRAD2: readonly number[] = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, -1, 1, 1, -1, -1, -1]

/** The 12 cube-edge gradients for 3D, each of length sqrt(2). */
const GRAD3: readonly number[] = [
	1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1,
	1, 0, 1, -1, 0, -1, -1,
]

/**
 * With unit gradients the Perlin bound is sqrt(N)/2. The tables above are
 * sqrt(2) longer than unit, so 2D already lands in [-1, 1] and 3D only needs
 * this factor: (2/sqrt(3)) / sqrt(2).
 */
const SCALE3 = 0.816496580927726

/** Quintic fade, the improved-Perlin interpolant. */
function fade(t: number): number {
	return t * t * t * (t * (t * 6 - 15) + 10)
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t
}

function dot2(seed: number, salt: number, xi: number, zi: number, dx: number, dz: number): number {
	const g = (hashU32(seed, salt, xi, 0, zi) & 7) * 2
	return GRAD2[g] * dx + GRAD2[g + 1] * dz
}

function dot3(
	seed: number,
	salt: number,
	xi: number,
	yi: number,
	zi: number,
	dx: number,
	dy: number,
	dz: number,
): number {
	const g = (hashU32(seed, salt, xi, yi, zi) % 12) * 3
	return GRAD3[g] * dx + GRAD3[g + 1] * dy + GRAD3[g + 2] * dz
}

/** 2D improved Perlin noise in [-1, 1]. */
export function perlin2(seed: number, salt: number, x: number, z: number): number {
	const xi = Math.floor(x)
	const zi = Math.floor(z)
	const xf = x - xi
	const zf = z - zi
	const u = fade(xf)
	const v = fade(zf)
	const n00 = dot2(seed, salt, xi, zi, xf, zf)
	const n10 = dot2(seed, salt, xi + 1, zi, xf - 1, zf)
	const n01 = dot2(seed, salt, xi, zi + 1, xf, zf - 1)
	const n11 = dot2(seed, salt, xi + 1, zi + 1, xf - 1, zf - 1)
	return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v)
}

/** 3D improved Perlin noise in [-1, 1]. */
export function perlin3(seed: number, salt: number, x: number, y: number, z: number): number {
	const xi = Math.floor(x)
	const yi = Math.floor(y)
	const zi = Math.floor(z)
	const xf = x - xi
	const yf = y - yi
	const zf = z - zi
	const u = fade(xf)
	const v = fade(yf)
	const w = fade(zf)
	const n000 = dot3(seed, salt, xi, yi, zi, xf, yf, zf)
	const n100 = dot3(seed, salt, xi + 1, yi, zi, xf - 1, yf, zf)
	const n010 = dot3(seed, salt, xi, yi + 1, zi, xf, yf - 1, zf)
	const n110 = dot3(seed, salt, xi + 1, yi + 1, zi, xf - 1, yf - 1, zf)
	const n001 = dot3(seed, salt, xi, yi, zi + 1, xf, yf, zf - 1)
	const n101 = dot3(seed, salt, xi + 1, yi, zi + 1, xf - 1, yf, zf - 1)
	const n011 = dot3(seed, salt, xi, yi + 1, zi + 1, xf, yf - 1, zf - 1)
	const n111 = dot3(seed, salt, xi + 1, yi + 1, zi + 1, xf - 1, yf - 1, zf - 1)
	const x00 = lerp(n000, n100, u)
	const x10 = lerp(n010, n110, u)
	const x01 = lerp(n001, n101, u)
	const x11 = lerp(n011, n111, u)
	const y0 = lerp(x00, x10, v)
	const y1 = lerp(x01, x11, v)
	return lerp(y0, y1, w) * SCALE3
}
