/**
 * Improved Perlin noise, 2D and 3D. Owned by task world-b.
 *
 * Every exported sampler is a pure function of (seed, salt, coordinates).
 * Gradients come from `hashU32`, never from mutable state, an instance counter
 * or a shuffled permutation table, so a sample has the same value no matter how
 * many samples were taken before it, in which order, or on which worker. That
 * is what keeps reordered and parallel chunk generation byte identical.
 *
 * No trigonometry, no unseeded entropy, no wall clock: the gradient tables
 * below are fixed integer literals.
 *
 * Invariants locked by `src/__tests__/world-b.noise.test.ts`:
 *  - quintic fade (improved Perlin) with fixed gradient tables;
 *  - exactly 0 on lattice points, and inside [-1, 1] everywhere;
 *  - non-finite coordinates yield 0 instead of poisoning terrain with NaN.
 *
 * Hot-path note. The shape below (many small monomorphic helpers) is
 * deliberate and was measured on the runner with a per-chunk noise workload,
 * best of 4 interleaved rounds: helpers cost 1.07-1.15 ms/chunk, while
 * hand-inlining the lattice dot products and the interpolation tree into one
 * large body cost 1.47-1.57 ms/chunk (~37% slower) because the sampler stops
 * being inlined into the fBm octave loops. Do not "optimize" by inlining.
 *
 * The one hot-path change kept from that experiment is the `*Raw` split: the
 * finite-input check happens once per field sample in `fbm.ts` instead of once
 * per octave.
 */
import { hashU32 } from '@voxelcraft/core-types'

/** 8 gradients for 2D: 4 axis aligned plus 4 diagonals of length sqrt(2). */
const GRAD2: readonly number[] = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, -1, 1, 1, -1, -1, -1]

/** The 12 cube-edge gradients for 3D, each of length sqrt(2). */
// prettier-ignore
const GRAD3: readonly number[] = [
	1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
	1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
	0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]

/**
 * With unit gradients the Perlin bound is sqrt(N)/2. The tables above are
 * sqrt(2) longer than unit, so 2D already lands in [-1, 1] and 3D only needs
 * this factor: (2/sqrt(3)) / sqrt(2).
 */
const SCALE3 = 0.816496580927726

/** Quintic fade, the improved-Perlin interpolant: 6t^5 - 15t^4 + 10t^3. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Gradient dot product at one 2D lattice corner. */
function dot2(seed: number, salt: number, xi: number, zi: number, dx: number, dz: number): number {
  const g = (hashU32(seed, salt, xi, 0, zi) & 7) * 2
  return GRAD2[g] * dx + GRAD2[g + 1] * dz
}

/** Gradient dot product at one 3D lattice corner. */
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

/**
 * 2D improved Perlin noise in [-1, 1], for callers that already know the
 * coordinates are finite (the fBm, ridged and warp octave loops).
 */
export function perlin2Raw(seed: number, salt: number, x: number, z: number): number {
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

/** 3D improved Perlin noise in [-1, 1], unguarded counterpart of `perlin3`. */
export function perlin3Raw(seed: number, salt: number, x: number, y: number, z: number): number {
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
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * SCALE3
}

/** 2D improved Perlin noise in [-1, 1]. Non-finite coordinates yield 0. */
export function perlin2(seed: number, salt: number, x: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0
  return perlin2Raw(seed, salt, x, z)
}

/** 3D improved Perlin noise in [-1, 1]. Non-finite coordinates yield 0. */
export function perlin3(seed: number, salt: number, x: number, y: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return 0
  return perlin3Raw(seed, salt, x, y, z)
}
