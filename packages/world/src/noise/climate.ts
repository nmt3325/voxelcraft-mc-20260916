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
 *
 * H-06 (still bit-identical): the field descriptors are unpacked once at module
 * scope and the two fbm entry points are bound once, so a column no longer pays
 * five namespace getters plus a property load per noise parameter.
 */
import type { ClimateSample } from '@voxelcraft/core-types'
import { NOISE_FIELDS } from '../internal'
import { fbm2, warpStages2 } from './fbm'

/* Same functions and the same frozen values, resolved once. */
const fbm = fbm2
const warpStages = warpStages2
const WARP_SALT_X = NOISE_FIELDS.warp.saltX
const WARP_SALT_Z = NOISE_FIELDS.warp.saltZ
const WARP_SALT_X2 = NOISE_FIELDS.warp.saltX2
const WARP_SALT_Z2 = NOISE_FIELDS.warp.saltZ2
const WARP_AMOUNT = NOISE_FIELDS.warp.amount
const WARP_FREQUENCY = NOISE_FIELDS.warp.frequency
const TEMPERATURE_SALT = NOISE_FIELDS.temperature.salt
const TEMPERATURE_FBM = NOISE_FIELDS.temperature.fbm
const HUMIDITY_SALT = NOISE_FIELDS.humidity.salt
const HUMIDITY_FBM = NOISE_FIELDS.humidity.fbm
const CONTINENT_SALT = NOISE_FIELDS.continent.salt
const CONTINENT_FBM = NOISE_FIELDS.continent.fbm
const EROSION_SALT = NOISE_FIELDS.erosion.salt
const EROSION_FBM = NOISE_FIELDS.erosion.fbm

/** Write-then-read scratch for the warp stages: [x1, z1, x2, z2]. */
const STAGES = new Float64Array(4)

export function climateAt(seed: number, wx: number, wz: number): ClimateSample {
  if (!Number.isFinite(wx) || !Number.isFinite(wz)) {
    return { temperature: 0, humidity: 0, continent: 0, erosion: 0 }
  }
  warpStages(
    seed,
    WARP_SALT_X,
    WARP_SALT_Z,
    WARP_SALT_X2,
    WARP_SALT_Z2,
    wx,
    wz,
    WARP_AMOUNT,
    WARP_FREQUENCY,
    STAGES,
  )
  const warpedX = STAGES[0]
  const warpedZ = STAGES[1]
  const twiceWarpedX = STAGES[2]
  const twiceWarpedZ = STAGES[3]
  return {
    temperature: fbm(seed, TEMPERATURE_SALT, wx, wz, TEMPERATURE_FBM),
    humidity: fbm(seed, HUMIDITY_SALT, wx, wz, HUMIDITY_FBM),
    continent: fbm(seed, CONTINENT_SALT, twiceWarpedX, twiceWarpedZ, CONTINENT_FBM),
    erosion: fbm(seed, EROSION_SALT, warpedX, warpedZ, EROSION_FBM),
  }
}
