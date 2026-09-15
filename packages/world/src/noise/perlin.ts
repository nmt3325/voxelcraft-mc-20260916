/**
 * Improved Perlin noise, 2D and 3D. Owned by task world-b.
 *
 * Every exported sampler is a pure function of (seed, salt, coordinates).
 * Gradients come from `hashU32`, never from mutable state, an instance counter
 * or a shuffled permutation table, so a sample has the same value no matter how
 * many samples were taken before it, in which order, or on which worker. That
 * is what keeps reordered and parallel chunk generation byte identical.
 *
 * No trigonometry, no unseeded entropy, no wall clock: the gradient tables below
 * are fixed integer literals.
 *
 * Invariants locked by `src/__tests__/world-b.noise.test.ts`:
 *  - quintic fade (improved Perlin) with fixed gradient tables;
 *  - exactly 0 on lattice points, and inside [-1, 1] everywhere;
 *  - non-finite coordinates yield 0 instead of poisoning terrain with NaN.
 *
 * v2 hot-path notes (output is bit-identical to v1): the gradient tables are
 * `Int8Array` so element access stays monomorphic, the lattice dot products and
 * the interpolation tree are inlined so a sample needs no helper frames and
 * allocates nothing, and the `*Raw` entry points skip the finite-input check so
 * fBm, ridged and warp pay it once per field sample instead of once per octave.
 */
import { hashU32 } from '@voxelcraft/core-types'

/** 8 gradients for 2D: 4 axis aligned plus 4 diagonals of length sqrt(2). */
const GRAD2 = new Int8Array([1, 0, -1, 0, 0, 1, 0, -1, 1, 1, -1, 1, 1, -1, -1, -1])

/** The 12 cube-edge gradients for 3D, each of length sqrt(2). */
// prettier-ignore
const GRAD3 = new Int8Array([
	1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
	1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
	0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
])

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

/**
 * 2D improved Perlin noise in [-1, 1]. Hot path: the caller guarantees finite
 * coordinates (see `perlin2` for the guarded entry point).
 */
export function perlin2Raw(seed: number, salt: number, x: number, z: number): number {
  const xi = Math.floor(x)
  const zi = Math.floor(z)
  const xi1 = xi + 1
  const zi1 = zi + 1
  const xf = x - xi
  const zf = z - zi
  const xf1 = xf - 1
  const zf1 = zf - 1
  const u = fade(xf)
  const v = fade(zf)
  const g00 = (hashU32(seed, salt, xi, 0, zi) & 7) * 2
  const g10 = (hashU32(seed, salt, xi1, 0, zi) & 7) * 2
  const g01 = (hashU32(seed, salt, xi, 0, zi1) & 7) * 2
  const g11 = (hashU32(seed, salt, xi1, 0, zi1) & 7) * 2
  const n00 = GRAD2[g00] * xf + GRAD2[g00 + 1] * zf
  const n10 = GRAD2[g10] * xf1 + GRAD2[g10 + 1] * zf
  const n01 = GRAD2[g01] * xf + GRAD2[g01 + 1] * zf1
  const n11 = GRAD2[g11] * xf1 + GRAD2[g11 + 1] * zf1
  const lo = n00 + (n10 - n00) * u
  const hi = n01 + (n11 - n01) * u
  return lo + (hi - lo) * v
}

/**
 * 3D improved Perlin noise in [-1, 1]. Hot path: the caller guarantees finite
 * coordinates (see `perlin3` for the guarded entry point).
 */
export function perlin3Raw(seed: number, salt: number, x: number, y: number, z: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const xi1 = xi + 1
  const yi1 = yi + 1
  const zi1 = zi + 1
  const xf = x - xi
  const yf = y - yi
  const zf = z - zi
  const xf1 = xf - 1
  const yf1 = yf - 1
  const zf1 = zf - 1
  const u = fade(xf)
  const v = fade(yf)
  const w = fade(zf)
  const g000 = (hashU32(seed, salt, xi, yi, zi) % 12) * 3
  const g100 = (hashU32(seed, salt, xi1, yi, zi) % 12) * 3
  const g010 = (hashU32(seed, salt, xi, yi1, zi) % 12) * 3
  const g110 = (hashU32(seed, salt, xi1, yi1, zi) % 12) * 3
  const g001 = (hashU32(seed, salt, xi, yi, zi1) % 12) * 3
  const g101 = (hashU32(seed, salt, xi1, yi, zi1) % 12) * 3
  const g011 = (hashU32(seed, salt, xi, yi1, zi1) % 12) * 3
  const g111 = (hashU32(seed, salt, xi1, yi1, zi1) % 12) * 3
  const n000 = GRAD3[g000] * xf + GRAD3[g000 + 1] * yf + GRAD3[g000 + 2] * zf
  const n100 = GRAD3[g100] * xf1 + GRAD3[g100 + 1] * yf + GRAD3[g100 + 2] * zf
  const n010 = GRAD3[g010] * xf + GRAD3[g010 + 1] * yf1 + GRAD3[g010 + 2] * zf
  const n110 = GRAD3[g110] * xf1 + GRAD3[g110 + 1] * yf1 + GRAD3[g110 + 2] * zf
  const n001 = GRAD3[g001] * xf + GRAD3[g001 + 1] * yf + GRAD3[g001 + 2] * zf1
  const n101 = GRAD3[g101] * xf1 + GRAD3[g101 + 1] * yf + GRAD3[g101 + 2] * zf1
  const n011 = GRAD3[g011] * xf + GRAD3[g011 + 1] * yf1 + GRAD3[g011 + 2] * zf1
  const n111 = GRAD3[g111] * xf1 + GRAD3[g111 + 1] * yf1 + GRAD3[g111 + 2] * zf1
  const x00 = n000 + (n100 - n000) * u
  const x10 = n010 + (n110 - n010) * u
  const x01 = n001 + (n101 - n001) * u
  const x11 = n011 + (n111 - n011) * u
  const y0 = x00 + (x10 - x00) * v
  const y1 = x01 + (x11 - x01) * v
  return (y0 + (y1 - y0) * w) * SCALE3
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
