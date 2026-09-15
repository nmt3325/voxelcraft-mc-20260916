/**
 * Noise basis factory. Owned by task world-b.
 *
 * createNoiseBasis binds a seed once and exposes the primitives the terrain and
 * feature layers consume through the NoiseBasis seam in `src/internal.ts`. The
 * seed is masked to a u32 so that a negative or fractional seed still selects a
 * single, stable gradient field.
 *
 * A basis holds no sampling state: two bases built from the same seed return
 * the same values, in any order, no matter how many samples either has taken.
 */
import type { CreateNoiseBasis, NoiseBasis } from '../internal'
import { climateAt } from './climate'
import { clamp1, fbm2, fbm3, ridged2, warp2, warp2To, warpStages2 } from './fbm'
import { perlin2, perlin2Raw, perlin3, perlin3Raw } from './perlin'

export const createNoiseBasis: CreateNoiseBasis = (seed: number): NoiseBasis => {
  const s = seed >>> 0
  return {
    seed: s,
    perlin2: (salt, x, z) => perlin2(s, salt, x, z),
    perlin3: (salt, x, y, z) => perlin3(s, salt, x, y, z),
    fbm2: (salt, x, z, opts) => fbm2(s, salt, x, z, opts),
    fbm3: (salt, x, y, z, opts) => fbm3(s, salt, x, y, z, opts),
    ridged2: (salt, x, z, opts) => ridged2(s, salt, x, z, opts),
    warp2: (saltX, saltZ, x, z, amount, frequency) =>
      warp2(s, saltX, saltZ, x, z, amount, frequency),
    climateAt: (wx, wz) => climateAt(s, wx, wz),
  }
}

export {
  clamp1,
  climateAt,
  fbm2,
  fbm3,
  perlin2,
  perlin2Raw,
  perlin3,
  perlin3Raw,
  ridged2,
  warp2,
  warp2To,
  warpStages2,
}
