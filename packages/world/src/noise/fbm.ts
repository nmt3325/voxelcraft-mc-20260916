/**
 * Fractal Brownian motion, ridged multifractal and domain warp.
 *
 * Owned by task world-b. The per-octave rotation uses precomputed literals for
 * the 0.5 rad rotation matrix, so no trigonometric call happens at runtime and
 * the result stays stable across engines. Rotating between octaves breaks up
 * the axis-aligned grid artifacts of plain Perlin fBm.
 */
import type { FbmOptions } from '@voxelcraft/core-types'
import type { WarpResult } from '../internal'
import { perlin2, perlin3 } from './perlin'

/** cos(0.5) and sin(0.5). */
const ROT_C = 0.8775825618903728
const ROT_S = 0.479425538604203

/** Salt stride per octave, so octaves never share a gradient field. */
const OCTAVE_SALT_STRIDE = 0x3b9b

export function clamp1(v: number): number {
	return v < -1 ? -1 : v > 1 ? 1 : v
}

/** 2D fBm in [-1, 1]. */
export function fbm2(
	seed: number,
	salt: number,
	x: number,
	z: number,
	opts: FbmOptions,
): number {
	let px = x
	let pz = z
	let freq = opts.frequency
	let amp = 1
	let sum = 0
	let norm = 0
	for (let o = 0; o < opts.octaves; o++) {
		sum += perlin2(seed, salt + o * OCTAVE_SALT_STRIDE, px * freq, pz * freq) * amp
		norm += amp
		amp *= opts.gain
		freq *= opts.lacunarity
		if (opts.rotatePerOctave === true) {
			const rx = px * ROT_C - pz * ROT_S
			const rz = px * ROT_S + pz * ROT_C
			px = rx
			pz = rz
		}
	}
	return norm > 0 ? clamp1(sum / norm) : 0
}

/** 3D fBm in [-1, 1]. Rotation is applied in the XZ plane only. */
export function fbm3(
	seed: number,
	salt: number,
	x: number,
	y: number,
	z: number,
	opts: FbmOptions,
): number {
	let px = x
	let pz = z
	let freq = opts.frequency
	let amp = 1
	let sum = 0
	let norm = 0
	for (let o = 0; o < opts.octaves; o++) {
		sum += perlin3(seed, salt + o * OCTAVE_SALT_STRIDE, px * freq, y * freq, pz * freq) * amp
		norm += amp
		amp *= opts.gain
		freq *= opts.lacunarity
		if (opts.rotatePerOctave === true) {
			const rx = px * ROT_C - pz * ROT_S
			const rz = px * ROT_S + pz * ROT_C
			px = rx
			pz = rz
		}
	}
	return norm > 0 ? clamp1(sum / norm) : 0
}

/**
 * Ridged multifractal remapped to [-1, 1]. Values near 1 are the ridge lines,
 * which is what the mountain height term rides on.
 */
export function ridged2(
	seed: number,
	salt: number,
	x: number,
	z: number,
	opts: FbmOptions,
): number {
	let px = x
	let pz = z
	let freq = opts.frequency
	let amp = 1
	let sum = 0
	let norm = 0
	for (let o = 0; o < opts.octaves; o++) {
		const n = perlin2(seed, salt + o * OCTAVE_SALT_STRIDE, px * freq, pz * freq)
		const ridge = 1 - (n < 0 ? -n : n)
		sum += ridge * ridge * amp
		norm += amp
		amp *= opts.gain
		freq *= opts.lacunarity
		if (opts.rotatePerOctave === true) {
			const rx = px * ROT_C - pz * ROT_S
			const rz = px * ROT_S + pz * ROT_C
			px = rx
			pz = rz
		}
	}
	return norm > 0 ? clamp1((sum / norm) * 2 - 1) : 0
}

/** One domain warp step: offsets the sample point by two noise fields. */
export function warp2(
	seed: number,
	saltX: number,
	saltZ: number,
	x: number,
	z: number,
	amount: number,
	frequency: number,
): WarpResult {
	const fx = x * frequency
	const fz = z * frequency
	return {
		x: x + perlin2(seed, saltX, fx, fz) * amount,
		z: z + perlin2(seed, saltZ, fx, fz) * amount,
	}
}
