/**
 * Fractal Brownian motion, ridged multifractal and domain warp.
 * Owned by task world-b.
 *
 * The per-octave rotation uses precomputed literals for the 0.5 rad rotation
 * matrix, so no trigonometric call happens at runtime and the result stays
 * stable across engines. Rotating between octaves breaks up the axis-aligned
 * grid artifacts of plain Perlin fBm.
 *
 * FbmOptions semantics, locked by `src/__tests__/world-b.noise.test.ts`:
 *  - `frequency` scales the input coordinates of the first octave;
 *  - `lacunarity` multiplies the frequency after every octave;
 *  - `gain` multiplies the amplitude after every octave;
 *  - the octave sum is divided by the accumulated amplitude, so the result is
 *    normalized into [-1, 1] for any octave count;
 *  - `rotatePerOctave` rotates the sample point between octaves, never before
 *    the first one, so a single octave is unaffected by the flag;
 *  - degenerate options (no octaves, non-finite parameters or coordinates)
 *    return 0 instead of NaN or a non-terminating loop.
 *
 * v2 hot-path notes (output is bit-identical to v1): the option object is read
 * once instead of once per octave, the octave salt advances by addition, the
 * octave loop calls the unguarded perlin entry points, and the warp can write
 * into a caller-owned buffer so the climate path allocates nothing per column.
 */
import type { FbmOptions } from '@voxelcraft/core-types'
import type { WarpResult } from '../internal'
import { perlin2Raw, perlin3Raw } from './perlin'

/** cos(0.5) and sin(0.5). */
const ROT_C = 0.8775825618903728
const ROT_S = 0.479425538604203

/** Salt stride per octave, so octaves never share a gradient field. */
const OCTAVE_SALT_STRIDE = 0x3b9b

/** Write-then-read scratch for `warp2`, so the warp math has a single home. */
const WARP_SCRATCH = new Float64Array(2)

export function clamp1(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v
}

/**
 * Guards the octave loop. A non-finite octave count would spin forever, and a
 * non-finite parameter or coordinate would return NaN, which the terrain layer
 * would then bake into chunks.
 */
function usableFbm(opts: FbmOptions, x: number, z: number): boolean {
  return (
    Number.isFinite(x) &&
    Number.isFinite(z) &&
    Number.isFinite(opts.octaves) &&
    opts.octaves > 0 &&
    Number.isFinite(opts.frequency) &&
    Number.isFinite(opts.gain) &&
    Number.isFinite(opts.lacunarity)
  )
}

/** 2D fBm in [-1, 1]. */
export function fbm2(seed: number, salt: number, x: number, z: number, opts: FbmOptions): number {
  if (!usableFbm(opts, x, z)) return 0
  const octaves = opts.octaves
  const gain = opts.gain
  const lacunarity = opts.lacunarity
  const rotate = opts.rotatePerOctave === true
  let px = x
  let pz = z
  let freq = opts.frequency
  let amp = 1
  let sum = 0
  let norm = 0
  let octaveSalt = salt
  for (let o = 0; o < octaves; o++) {
    sum += perlin2Raw(seed, octaveSalt, px * freq, pz * freq) * amp
    norm += amp
    amp *= gain
    freq *= lacunarity
    octaveSalt += OCTAVE_SALT_STRIDE
    if (rotate) {
      const rx = px * ROT_C - pz * ROT_S
      pz = px * ROT_S + pz * ROT_C
      px = rx
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
  if (!usableFbm(opts, x, z) || !Number.isFinite(y)) return 0
  const octaves = opts.octaves
  const gain = opts.gain
  const lacunarity = opts.lacunarity
  const rotate = opts.rotatePerOctave === true
  let px = x
  let pz = z
  let freq = opts.frequency
  let amp = 1
  let sum = 0
  let norm = 0
  let octaveSalt = salt
  for (let o = 0; o < octaves; o++) {
    sum += perlin3Raw(seed, octaveSalt, px * freq, y * freq, pz * freq) * amp
    norm += amp
    amp *= gain
    freq *= lacunarity
    octaveSalt += OCTAVE_SALT_STRIDE
    if (rotate) {
      const rx = px * ROT_C - pz * ROT_S
      pz = px * ROT_S + pz * ROT_C
      px = rx
    }
  }
  return norm > 0 ? clamp1(sum / norm) : 0
}

/**
 * Ridged multifractal remapped to [-1, 1]. Values near 1 are the ridge lines,
 * which is what the mountain height term rides on. Perlin noise is exactly 0 on
 * a lattice point, so a single-octave ridge crests at exactly 1 there.
 */
export function ridged2(
  seed: number,
  salt: number,
  x: number,
  z: number,
  opts: FbmOptions,
): number {
  if (!usableFbm(opts, x, z)) return 0
  const octaves = opts.octaves
  const gain = opts.gain
  const lacunarity = opts.lacunarity
  const rotate = opts.rotatePerOctave === true
  let px = x
  let pz = z
  let freq = opts.frequency
  let amp = 1
  let sum = 0
  let norm = 0
  let octaveSalt = salt
  for (let o = 0; o < octaves; o++) {
    const n = perlin2Raw(seed, octaveSalt, px * freq, pz * freq)
    const ridge = 1 - (n < 0 ? -n : n)
    sum += ridge * ridge * amp
    norm += amp
    amp *= gain
    freq *= lacunarity
    octaveSalt += OCTAVE_SALT_STRIDE
    if (rotate) {
      const rx = px * ROT_C - pz * ROT_S
      pz = px * ROT_S + pz * ROT_C
      px = rx
    }
  }
  return norm > 0 ? clamp1((sum / norm) * 2 - 1) : 0
}

/**
 * One domain warp step, written into `out[offset]` and `out[offset + 1]`, so
 * the per-column climate path needs no allocation. The offset of each axis is
 * bounded by `amount`, because perlin2 is bounded by 1.
 */
export function warp2To(
  seed: number,
  saltX: number,
  saltZ: number,
  x: number,
  z: number,
  amount: number,
  frequency: number,
  out: Float64Array,
  offset: number,
): void {
  const fx = x * frequency
  const fz = z * frequency
  out[offset] = x + perlin2Raw(seed, saltX, fx, fz) * amount
  out[offset + 1] = z + perlin2Raw(seed, saltZ, fx, fz) * amount
}

/**
 * One domain warp step: offsets the sample point by two noise fields. Unusable
 * parameters degrade to the identity warp instead of returning NaN positions.
 */
export function warp2(
  seed: number,
  saltX: number,
  saltZ: number,
  x: number,
  z: number,
  amount: number,
  frequency: number,
): WarpResult {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(z) ||
    !Number.isFinite(amount) ||
    !Number.isFinite(frequency)
  ) {
    return { x, z }
  }
  warp2To(seed, saltX, saltZ, x, z, amount, frequency, WARP_SCRATCH, 0)
  return { x: WARP_SCRATCH[0], z: WARP_SCRATCH[1] }
}

/**
 * Two-stage domain warp. The second stage runs at twice the frequency and half
 * the amount of the first, which is what curls coastlines and mountain chains
 * away from the sample grid. Both stages are written into `out` as
 * `[x1, z1, x2, z2]`, so callers can keep the first stage (used by erosion) and
 * the second stage (used by the continent field) without allocating.
 */
export function warpStages2(
  seed: number,
  saltX: number,
  saltZ: number,
  saltX2: number,
  saltZ2: number,
  x: number,
  z: number,
  amount: number,
  frequency: number,
  out: Float64Array,
): void {
  warp2To(seed, saltX, saltZ, x, z, amount, frequency, out, 0)
  warp2To(seed, saltX2, saltZ2, out[0], out[1], amount * 0.5, frequency * 2, out, 2)
}
