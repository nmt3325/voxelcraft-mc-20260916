/**
 * Climate fields. Owned by task world-b.
 *
 * The continent field is sampled through a two-stage domain warp, which is what
 * gives coastlines and mountain chains their non-grid-aligned shape. Erosion
 * uses only the first warp stage, and temperature/humidity are unwarped so that
 * biome belts stay large and readable.
 *
 * Guarantees (locked by `src/__tests__/world-b.noise.test.ts`): all four fields
 * are finite and inside [-1, 1], the sample is a pure function of
 * (seed, wx, wz), and non-finite coordinates return a zeroed sample instead of
 * feeding NaN into the height field.
 *
 * v2 hot-path note (output is bit-identical to v1): the two warp stages are
 * written into a module-level scratch buffer instead of allocating two objects
 * per column, which removes 512 short-lived objects per generated chunk.
 */
import type { ClimateSample } from '@voxelcraft/core-types'
import { NOISE_FIELDS } from '../internal'
import { fbm2, warpStages2 } from './fbm'

/** Write-then-read scratch for the warp stages: [x1, z1, x2, z2]. */
const STAGES = new Float64Array(4)

export function climateAt(seed: number, wx: number, wz: number): ClimateSample {
  if (!Number.isFinite(wx) || !Number.isFinite(wz)) {
    return { temperature: 0, humidity: 0, continent: 0, erosion: 0 }
  }
  const w = NOISE_FIELDS.warp
  warpStages2(seed, w.saltX, w.saltZ, w.saltX2, w.saltZ2, wx, wz, w.amount, w.frequency, STAGES)
  const warpedX = STAGES[0]
  const warpedZ = STAGES[1]
  const twiceWarpedX = STAGES[2]
  const twiceWarpedZ = STAGES[3]
  const continent = NOISE_FIELDS.continent
  const erosion = NOISE_FIELDS.erosion
  const temperature = NOISE_FIELDS.temperature
  const humidity = NOISE_FIELDS.humidity
  return {
    temperature: fbm2(seed, temperature.salt, wx, wz, temperature.fbm),
    humidity: fbm2(seed, humidity.salt, wx, wz, humidity.fbm),
    continent: fbm2(seed, continent.salt, twiceWarpedX, twiceWarpedZ, continent.fbm),
    erosion: fbm2(seed, erosion.salt, warpedX, warpedZ, erosion.fbm),
  }
}
