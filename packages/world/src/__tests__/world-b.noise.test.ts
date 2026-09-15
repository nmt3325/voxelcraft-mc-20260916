/**
 * Noise layer tests. Owned by task world-b.
 *
 * Required coverage: value ranges, determinism (including evaluation order and
 * basis construction order), lattice behaviour, frequency scaling, continuity
 * as octaves are added, warp boundedness, and climate ranges/determinism.
 *
 * The pinned values in the last block lock the exact output of the generator.
 * They were captured from the implementation before the hot-path rework, so a
 * refactor that moves terrain - and therefore invalidates
 * `src/__tests__/golden.json` - fails here first, with a much smaller blast
 * radius than a golden hash mismatch.
 *
 * This suite uses no wall clock and no unseeded randomness of any kind.
 */
import type { FbmOptions } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { CAVES, NOISE_FIELDS, SALT } from '../internal'
import { clamp1, createNoiseBasis, fbm2, fbm3, ridged2, warp2, warpStages2 } from '../noise'
import { climateAt } from '../noise/climate'
import { perlin2, perlin3 } from '../noise/perlin'

const SEED = 1337
const ALT_SEED = 20260916

const flat = (octaves: number, frequency: number, gain = 0.5, lacunarity = 2): FbmOptions => ({
  octaves,
  lacunarity,
  gain,
  frequency,
  rotatePerOctave: false,
})

/** Deterministic order shuffler, used to prove sample order does not matter. */
function shuffled<T>(items: readonly T[], state: number): T[] {
  let s = state >>> 0
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  const copy = items.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    const tmp = copy[i]
    copy[i] = copy[j]
    copy[j] = tmp
  }
  return copy
}

describe('perlin2', () => {
  it('fills [-1, 1] without leaving it', () => {
    let min = 1
    let max = -1
    let nonFinite = 0
    for (let i = 0; i < 200; i++) {
      for (let j = 0; j < 200; j++) {
        const v = perlin2(SEED, SALT.continent, i * 0.37 - 37, j * 0.53 - 53)
        if (!Number.isFinite(v)) nonFinite++
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    expect(nonFinite).toBe(0)
    expect(min).toBeGreaterThanOrEqual(-1)
    expect(max).toBeLessThanOrEqual(1)
    expect(min).toBeLessThan(-0.8)
    expect(max).toBeGreaterThan(0.8)
  })

  it('is exactly zero on lattice points and tiny beside them', () => {
    let offLattice = 0
    for (let i = -8; i <= 8; i++) {
      for (let j = -8; j <= 8; j++) {
        if (perlin2(SEED, SALT.continent, i, j) !== 0) offLattice++
      }
    }
    expect(offLattice).toBe(0)
    expect(Math.abs(perlin2(SEED, SALT.continent, 4 + 1e-6, -3))).toBeLessThan(1e-4)
    expect(Math.abs(perlin2(SEED, SALT.continent, 4, -3 + 1e-6))).toBeLessThan(1e-4)
    let peak = 0
    for (let i = 0; i < 128; i++) {
      const v = Math.abs(perlin2(SEED, SALT.continent, i + 0.5, i * 2 + 0.5))
      if (v > peak) peak = v
    }
    expect(peak).toBeGreaterThan(0.1)
  })

  it('is deterministic no matter in which order samples are taken', () => {
    const points: Array<[number, number]> = []
    for (let i = 0; i < 400; i++) points.push([i * 1.37 - 200, i * -0.91 + 60])
    const direct = new Map<string, number>()
    for (const [x, z] of points) direct.set(`${x},${z}`, perlin2(SEED, SALT.ridge, x, z))
    let mismatches = 0
    for (const [x, z] of shuffled(points, 0x9e3779b9)) {
      if (perlin2(SEED, SALT.ridge, x, z) !== direct.get(`${x},${z}`)) mismatches++
    }
    expect(mismatches).toBe(0)
  })

  it('moves when the seed or the salt changes', () => {
    let seedDiffs = 0
    let saltDiffs = 0
    const samples = 256
    for (let i = 0; i < samples; i++) {
      // Dyadic steps keep every sample strictly off the integer lattice:
      // 0.75i + 0.3125 cycles through .3125/.0625/.8125/.5625 and never hits
      // a whole number. That matters because on a lattice line one fade weight
      // is 0, so the sample collapses onto what a single gradient component
      // can produce and two seeds can tie there for reasons that say nothing
      // about seeding. Strictly off the lattice, every sample must move.
      const x = i * 0.75 + 0.3125
      const z = i * -1.25 + 0.1875
      const base = perlin2(SEED, SALT.continent, x, z)
      if (perlin2(ALT_SEED, SALT.continent, x, z) !== base) seedDiffs++
      if (perlin2(SEED, SALT.erosion, x, z) !== base) saltDiffs++
    }
    expect(seedDiffs).toBe(samples)
    expect(saltDiffs).toBe(samples)
  })

  it('returns 0 instead of NaN for non-finite coordinates', () => {
    expect(perlin2(SEED, SALT.continent, Number.NaN, 4)).toBe(0)
    expect(perlin2(SEED, SALT.continent, 4, Number.POSITIVE_INFINITY)).toBe(0)
    expect(perlin3(SEED, SALT.caveCheese, 1, Number.NaN, 3)).toBe(0)
  })
})

describe('perlin3', () => {
  it('fills [-1, 1], is zero on lattice points and uses every axis', () => {
    let min = 1
    let max = -1
    for (let i = 0; i < 60; i++) {
      for (let j = 0; j < 60; j++) {
        for (let k = 0; k < 10; k++) {
          const v = perlin3(SEED, SALT.caveCheese, i * 0.41 - 12, k * 1.7 + 0.25, j * 0.29 - 8)
          if (v < min) min = v
          if (v > max) max = v
        }
      }
    }
    expect(min).toBeGreaterThanOrEqual(-1)
    expect(max).toBeLessThanOrEqual(1)
    expect(min).toBeLessThan(-0.5)
    expect(max).toBeGreaterThan(0.5)
    let offLattice = 0
    for (let i = -4; i <= 4; i++) {
      if (perlin3(SEED, SALT.caveCheese, i, i * 2, -i) !== 0) offLattice++
    }
    expect(offLattice).toBe(0)
    const base = perlin3(SEED, SALT.caveTunnelA, 3.25, 7.5, -11.75)
    expect(perlin3(SEED, SALT.caveTunnelA, 3.5, 7.5, -11.75)).not.toBe(base)
    expect(perlin3(SEED, SALT.caveTunnelA, 3.25, 7.75, -11.75)).not.toBe(base)
    expect(perlin3(SEED, SALT.caveTunnelA, 3.25, 7.5, -11.5)).not.toBe(base)
  })
})

describe('fbm2', () => {
  it('normalizes every octave count into [-1, 1]', () => {
    for (const octaves of [1, 2, 3, 5, 8]) {
      const opts = flat(octaves, 1 / 96)
      let min = 1
      let max = -1
      for (let i = 0; i < 100; i++) {
        for (let j = 0; j < 100; j++) {
          const v = fbm2(SEED, SALT.continent, i * 7.3 - 400, j * 5.9 - 300, opts)
          if (v < min) min = v
          if (v > max) max = v
        }
      }
      expect(min, `octaves ${octaves} min`).toBeGreaterThanOrEqual(-1)
      expect(max, `octaves ${octaves} max`).toBeLessThanOrEqual(1)
      expect(max - min, `octaves ${octaves} spread`).toBeGreaterThan(0.4)
    }
  })

  it('treats frequency as a coordinate scale', () => {
    const f = 1 / 37
    const opts = flat(1, f)
    let mismatches = 0
    for (let i = 0; i < 200; i++) {
      const x = i * 3.11 - 300
      const z = i * -2.07 + 150
      if (fbm2(SEED, SALT.detail, x, z, opts) !== perlin2(SEED, SALT.detail, x * f, z * f)) {
        mismatches++
      }
    }
    expect(mismatches).toBe(0)
  })

  it('shrinks features when the frequency grows', () => {
    const crossings = (frequency: number): number => {
      const opts = flat(1, frequency)
      let count = 0
      let prev = fbm2(SEED, SALT.continent, 0, 12.5, opts)
      for (let i = 1; i < 4000; i++) {
        const v = fbm2(SEED, SALT.continent, i, 12.5, opts)
        if ((prev < 0 && v >= 0) || (prev >= 0 && v < 0)) count++
        prev = v
      }
      return count
    }
    const coarse = crossings(1 / 64)
    const fine = crossings(1 / 16)
    expect(coarse).toBeGreaterThan(10)
    expect(fine).toBeGreaterThan(coarse * 2)
  })

  it('stays continuous as octaves are added', () => {
    for (const octaves of [1, 2, 3, 4, 5, 6]) {
      const opts = flat(octaves, 1 / 64)
      let maxStep = 0
      let prev = fbm2(SEED, SALT.continent, -500, 40.25, opts)
      for (let i = 1; i < 3000; i++) {
        const v = fbm2(SEED, SALT.continent, -500 + i * 0.25, 40.25, opts)
        const step = Math.abs(v - prev)
        if (step > maxStep) maxStep = step
        prev = v
      }
      expect(maxStep, `octaves ${octaves} step`).toBeGreaterThan(0)
      expect(maxStep, `octaves ${octaves} step`).toBeLessThan(0.1)
    }
  })

  it('honours gain, lacunarity and octave count as roughness controls', () => {
    const roughness = (opts: FbmOptions): number => {
      let sum = 0
      let prev = fbm2(SEED, SALT.continent, 0, -77.5, opts)
      for (let i = 1; i < 1500; i++) {
        const v = fbm2(SEED, SALT.continent, i * 0.5, -77.5, opts)
        sum += Math.abs(v - prev)
        prev = v
      }
      return sum
    }
    expect(roughness(flat(5, 1 / 64, 0.85))).toBeGreaterThan(roughness(flat(5, 1 / 64, 0.25)) * 1.5)
    expect(roughness(flat(5, 1 / 64, 0.5, 4))).toBeGreaterThan(
      roughness(flat(5, 1 / 64, 0.5, 1.5)) * 1.5,
    )
    expect(roughness(flat(6, 1 / 64))).toBeGreaterThan(roughness(flat(1, 1 / 64)))
  })

  it('applies the per-octave rotation only from the second octave on', () => {
    const rotated: FbmOptions = { ...flat(4, 1 / 80), rotatePerOctave: true }
    const plain = flat(4, 1 / 80)
    let diffs = 0
    let peak = 0
    for (let i = 0; i < 300; i++) {
      const x = i * 4.3 - 600
      const z = i * -3.1 + 250
      const a = fbm2(SEED, SALT.continent, x, z, rotated)
      if (a !== fbm2(SEED, SALT.continent, x, z, plain)) diffs++
      if (Math.abs(a) > peak) peak = Math.abs(a)
    }
    expect(diffs).toBeGreaterThan(290)
    expect(peak).toBeLessThanOrEqual(1)
    const oneRotated: FbmOptions = { ...flat(1, 1 / 80), rotatePerOctave: true }
    expect(fbm2(SEED, SALT.continent, 11.5, -23.25, oneRotated)).toBe(
      fbm2(SEED, SALT.continent, 11.5, -23.25, flat(1, 1 / 80)),
    )
  })

  it('returns 0 for degenerate options instead of NaN or a hang', () => {
    expect(fbm2(SEED, SALT.continent, 3.5, 4.5, flat(0, 1 / 64))).toBe(0)
    expect(fbm2(SEED, SALT.continent, 3.5, 4.5, flat(-2, 1 / 64))).toBe(0)
    expect(fbm2(SEED, SALT.continent, 3.5, 4.5, flat(Number.POSITIVE_INFINITY, 1 / 64))).toBe(0)
    expect(fbm2(SEED, SALT.continent, 3.5, 4.5, flat(3, Number.NaN))).toBe(0)
    expect(fbm2(SEED, SALT.continent, 3.5, 4.5, flat(3, 1 / 64, Number.NaN))).toBe(0)
    expect(fbm2(SEED, SALT.continent, 3.5, 4.5, flat(3, 1 / 64, 0.5, Number.NaN))).toBe(0)
    expect(fbm2(SEED, SALT.continent, Number.NaN, 4.5, flat(3, 1 / 64))).toBe(0)
    expect(fbm3(SEED, SALT.caveCheese, 1.5, Number.NaN, 2.5, CAVES.cheese)).toBe(0)
  })
})

describe('fbm3', () => {
  it('normalizes into [-1, 1] and depends on the vertical axis', () => {
    let min = 1
    let max = -1
    let yDiffs = 0
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        const x = i * 3.7 - 70
        const z = j * 4.1 - 80
        for (let k = 0; k < 6; k++) {
          const v = fbm3(SEED, SALT.caveCheese, x, k * 9 + 2.5, z, CAVES.cheese)
          if (v < min) min = v
          if (v > max) max = v
        }
        if (
          fbm3(SEED, SALT.caveCheese, x, 12.5, z, CAVES.cheese) !==
          fbm3(SEED, SALT.caveCheese, x, 44.5, z, CAVES.cheese)
        ) {
          yDiffs++
        }
      }
    }
    expect(min).toBeGreaterThanOrEqual(-1)
    expect(max).toBeLessThanOrEqual(1)
    expect(max - min).toBeGreaterThan(0.3)
    expect(yDiffs).toBeGreaterThan(1500)
  })
})

describe('ridged2', () => {
  it('stays in [-1, 1] and rides up to the ridge lines', () => {
    const opts = NOISE_FIELDS.ridge.fbm
    let min = 1
    let max = -1
    for (let i = 0; i < 200; i++) {
      for (let j = 0; j < 200; j++) {
        const v = ridged2(SEED, SALT.ridge, i * 9.3 - 900, j * 7.7 - 800, opts)
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    expect(min).toBeGreaterThanOrEqual(-1)
    expect(max).toBeLessThanOrEqual(1)
    expect(min).toBeLessThan(-0.2)
    expect(max).toBeGreaterThan(0.4)
  })

  it('matches the closed form for one octave and crests at exactly 1', () => {
    const f = 1 / 64
    const opts = flat(1, f)
    let mismatches = 0
    for (let i = 0; i < 200; i++) {
      const x = i * 2.7 - 200
      const z = i * -1.9 + 90
      const ridge = 1 - Math.abs(perlin2(SEED, SALT.ridge, x * f, z * f))
      if (ridged2(SEED, SALT.ridge, x, z, opts) !== clamp1(ridge * ridge * 2 - 1)) mismatches++
    }
    expect(mismatches).toBe(0)
    expect(ridged2(SEED, SALT.ridge, 128, 256, opts)).toBe(1)
    expect(ridged2(SEED, SALT.ridge, 3.5, 4.5, flat(0, f))).toBe(0)
  })
})

const WARP = NOISE_FIELDS.warp

describe('domain warp', () => {
  it('never displaces a point further than the requested amount', () => {
    let maxOffset = 0
    for (let i = 0; i < 300; i++) {
      const x = i * 13.7 - 2000
      const z = i * -11.3 + 900
      const warped = warp2(SEED, WARP.saltX, WARP.saltZ, x, z, WARP.amount, WARP.frequency)
      const offset = Math.max(Math.abs(warped.x - x), Math.abs(warped.z - z))
      if (offset > maxOffset) maxOffset = offset
    }
    expect(maxOffset).toBeLessThanOrEqual(WARP.amount)
    expect(maxOffset).toBeGreaterThan(WARP.amount * 0.3)
  })

  it('is deterministic, seed sensitive, and degrades to the identity warp', () => {
    const args = [WARP.saltX, WARP.saltZ, 77.25, -412.5, WARP.amount, WARP.frequency] as const
    const a = warp2(SEED, ...args)
    expect(warp2(SEED, ...args)).toEqual(a)
    expect(warp2(ALT_SEED, ...args)).not.toEqual(a)
    const identity = { x: 5.5, z: 6.5 }
    expect(warp2(SEED, WARP.saltX, WARP.saltZ, 5.5, 6.5, 0, WARP.frequency)).toEqual(identity)
    expect(warp2(SEED, WARP.saltX, WARP.saltZ, 5.5, 6.5, Number.NaN, WARP.frequency)).toEqual(
      identity,
    )
    expect(warp2(SEED, WARP.saltX, WARP.saltZ, 5.5, 6.5, WARP.amount, Number.NaN)).toEqual(identity)
  })

  it('chains two stages exactly like two warp2 calls and stays bounded', () => {
    const out = new Float64Array(4)
    let mismatches = 0
    let maxTotal = 0
    for (let i = 0; i < 200; i++) {
      const x = i * 17.3 - 1500
      const z = i * -9.7 + 640
      warpStages2(
        SEED,
        WARP.saltX,
        WARP.saltZ,
        WARP.saltX2,
        WARP.saltZ2,
        x,
        z,
        WARP.amount,
        WARP.frequency,
        out,
      )
      const first = warp2(SEED, WARP.saltX, WARP.saltZ, x, z, WARP.amount, WARP.frequency)
      const second = warp2(
        SEED,
        WARP.saltX2,
        WARP.saltZ2,
        first.x,
        first.z,
        WARP.amount * 0.5,
        WARP.frequency * 2,
      )
      if (out[0] !== first.x || out[1] !== first.z) mismatches++
      if (out[2] !== second.x || out[3] !== second.z) mismatches++
      const total = Math.max(Math.abs(out[2] - x), Math.abs(out[3] - z))
      if (total > maxTotal) maxTotal = total
    }
    expect(mismatches).toBe(0)
    expect(maxTotal).toBeLessThanOrEqual(WARP.amount * 1.5)
    expect(maxTotal).toBeGreaterThan(0)
  })
})

describe('climateAt', () => {
  it('keeps every field inside [-1, 1] and varies across the world', () => {
    const mins = [1, 1, 1, 1]
    const maxs = [-1, -1, -1, -1]
    let nonFinite = 0
    for (let i = 0; i < 90; i++) {
      for (let j = 0; j < 90; j++) {
        const c = climateAt(SEED, i * 71 - 3200, j * 63 - 2800)
        const values = [c.temperature, c.humidity, c.continent, c.erosion]
        for (let k = 0; k < 4; k++) {
          const v = values[k]
          if (!Number.isFinite(v)) nonFinite++
          if (v < mins[k]) mins[k] = v
          if (v > maxs[k]) maxs[k] = v
        }
      }
    }
    expect(nonFinite).toBe(0)
    for (let k = 0; k < 4; k++) {
      expect(mins[k], `field ${k} min`).toBeGreaterThanOrEqual(-1)
      expect(maxs[k], `field ${k} max`).toBeLessThanOrEqual(1)
      expect(maxs[k] - mins[k], `field ${k} spread`).toBeGreaterThan(0.2)
    }
  })

  it('is deterministic in any order and moves with the seed', () => {
    const points: Array<[number, number]> = []
    for (let i = 0; i < 200; i++) points.push([i * 37 - 1800, i * -29 + 900])
    const direct = new Map<string, string>()
    for (const [x, z] of points) direct.set(`${x},${z}`, JSON.stringify(climateAt(SEED, x, z)))
    let mismatches = 0
    let seedDiffs = 0
    for (const [x, z] of shuffled(points, 0x85ebca6b)) {
      const again = JSON.stringify(climateAt(SEED, x, z))
      if (again !== direct.get(`${x},${z}`)) mismatches++
      if (JSON.stringify(climateAt(ALT_SEED, x, z)) !== again) seedDiffs++
    }
    expect(mismatches).toBe(0)
    // Every sampled column moves with the seed. The four climate fields are
    // independent fBm stacks, so a tie across all four at one point would mean
    // the seed is not reaching them, not a gradient coincidence.
    expect(seedDiffs).toBe(points.length)
  })

  it('samples temperature and humidity unwarped, from the contract fields', () => {
    let mismatches = 0
    for (let i = 0; i < 150; i++) {
      const wx = i * 53 - 2000
      const wz = i * -41 + 1100
      const c = climateAt(SEED, wx, wz)
      const t = NOISE_FIELDS.temperature
      const h = NOISE_FIELDS.humidity
      if (c.temperature !== fbm2(SEED, t.salt, wx, wz, t.fbm)) mismatches++
      if (c.humidity !== fbm2(SEED, h.salt, wx, wz, h.fbm)) mismatches++
    }
    expect(mismatches).toBe(0)
  })

  it('returns a zeroed sample for non-finite coordinates', () => {
    const zeros = { temperature: 0, humidity: 0, continent: 0, erosion: 0 }
    expect(climateAt(SEED, Number.NaN, 10)).toEqual(zeros)
    expect(climateAt(SEED, 10, Number.POSITIVE_INFINITY)).toEqual(zeros)
  })
})

describe('createNoiseBasis', () => {
  it('masks the seed to u32 and forwards to the free functions', () => {
    const basis = createNoiseBasis(SEED)
    expect(basis.seed).toBe(SEED)
    expect(createNoiseBasis(-5).seed).toBe(4294967291)
    const opts = NOISE_FIELDS.continent.fbm
    expect(basis.perlin2(SALT.continent, 12.25, -7.75)).toBe(
      perlin2(SEED, SALT.continent, 12.25, -7.75),
    )
    expect(basis.perlin3(SALT.caveCheese, 3.5, 12.25, -8.125)).toBe(
      perlin3(SEED, SALT.caveCheese, 3.5, 12.25, -8.125),
    )
    expect(basis.fbm2(SALT.continent, 100.5, -240.25, opts)).toBe(
      fbm2(SEED, SALT.continent, 100.5, -240.25, opts),
    )
    expect(basis.fbm3(SALT.caveCheese, 10.5, 33.25, -44.75, CAVES.cheese)).toBe(
      fbm3(SEED, SALT.caveCheese, 10.5, 33.25, -44.75, CAVES.cheese),
    )
    expect(basis.ridged2(SALT.ridge, 64.25, -96.75, NOISE_FIELDS.ridge.fbm)).toBe(
      ridged2(SEED, SALT.ridge, 64.25, -96.75, NOISE_FIELDS.ridge.fbm),
    )
    expect(
      basis.warp2(WARP.saltX, WARP.saltZ, 150.5, -260.25, WARP.amount, WARP.frequency),
    ).toEqual(warp2(SEED, WARP.saltX, WARP.saltZ, 150.5, -260.25, WARP.amount, WARP.frequency))
    expect(basis.climateAt(128, -256)).toEqual(climateAt(SEED, 128, -256))
  })

  it('does not depend on instance identity or on how much it has been used', () => {
    const warm = createNoiseBasis(SEED)
    for (let i = 0; i < 500; i++) warm.perlin2(SALT.detail, i * 0.5, i * -0.25)
    const fresh = createNoiseBasis(SEED)
    const other = createNoiseBasis(ALT_SEED)
    const samples = 200
    let mismatches = 0
    let seedDiffs = 0
    for (let i = 0; i < samples; i++) {
      /*
       * Both coordinates stay strictly off the lattice: x lands on .25 or .75
       * and z on .375 or .875, never on an integer. That is what makes the
       * seed assertion below exact. On a lattice line one fade weight is 0, so
       * the sample collapses onto the few values a single gradient component
       * can produce and two seeds tie there a few percent of the time, for
       * reasons that say nothing about seeding. Off the lattice all four cell
       * gradients contribute and the seed has to move every single sample.
       */
      const x = i * 6.5 + 0.25
      const z = i * -4.5 + 0.375
      if (warm.perlin2(SALT.continent, x, z) !== fresh.perlin2(SALT.continent, x, z)) mismatches++
      if (other.perlin2(SALT.continent, x, z) !== fresh.perlin2(SALT.continent, x, z)) seedDiffs++
    }
    expect(mismatches).toBe(0)
    expect(seedDiffs).toBe(samples)
  })
})

/**
 * Bit-exact pins. These lock the generated world: if one of them changes, the
 * chunk hashes in `src/__tests__/golden.json` change too, and the golden file
 * has to be regenerated deliberately with `pnpm --filter @voxelcraft/world run
 * golden:update` rather than by accident.
 */
describe('pinned generator output (seed 1337)', () => {
  it('pins perlin2 and perlin3', () => {
    expect(perlin2(SEED, SALT.continent, 12.25, -7.75)).toBe(-0.3401212692260742)
    expect(perlin2(SEED, SALT.detail, -0.5, 0.125)).toBe(-0.36095428466796875)
    expect(perlin2(SEED, SALT.ridge, 1024.375, 2048.625)).toBe(0.2692670817486942)
    expect(perlin3(SEED, SALT.caveCheese, 3.5, 12.25, -8.125)).toBe(-0.4888856459921788)
    expect(perlin3(SEED, SALT.caveTunnelA, -17.75, 40.5, 6.25)).toBe(-0.31018936966765037)
  })

  it('pins fbm2, fbm3 and ridged2 on the contract fields', () => {
    expect(fbm2(SEED, SALT.continent, 100.5, -240.25, NOISE_FIELDS.continent.fbm)).toBe(
      0.2704224416226082,
    )
    expect(fbm2(SEED, SALT.detail, -13.75, 77.5, NOISE_FIELDS.detail.fbm)).toBe(0.25842619668078737)
    expect(fbm2(SEED, SALT.temperature, 512.25, 512.25, NOISE_FIELDS.temperature.fbm)).toBe(
      -0.13442322215689362,
    )
    expect(fbm3(SEED, SALT.caveCheese, 10.5, 33.25, -44.75, CAVES.cheese)).toBe(0.06874194981674368)
    expect(fbm3(SEED, SALT.caveTunnelA, -200.25, 12.5, 88.125, CAVES.tunnel)).toBe(
      0.006704628382145482,
    )
    expect(ridged2(SEED, SALT.ridge, 64.25, -96.75, NOISE_FIELDS.ridge.fbm)).toBe(
      -0.4457685284112892,
    )
    expect(ridged2(SEED, SALT.ridge, -1500.5, 2200.125, NOISE_FIELDS.ridge.fbm)).toBe(
      -0.04773761347989536,
    )
  })

  it('pins the domain warp and the climate sample', () => {
    expect(
      warp2(SEED, WARP.saltX, WARP.saltZ, 150.5, -260.25, WARP.amount, WARP.frequency),
    ).toEqual({ x: 143.4759886928917, z: -253.9621785066068 })
    expect(climateAt(SEED, 128, -256)).toEqual({
      temperature: -0.08580337201300277,
      humidity: 0.15156995844520166,
      continent: 0.2417887371665602,
      erosion: -0.3876706448638511,
    })
    expect(climateAt(SEED, -1777, 999)).toEqual({
      temperature: 0.05400727330437992,
      humidity: 0.043963189718356825,
      continent: -0.025894219330135533,
      erosion: 0.06323055962481058,
    })
  })
})
