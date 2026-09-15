/**
 * Contract guards for the noise layer. Owned by task world-b.
 *
 * `world-b.noise.test.ts` pins values, ranges and determinism. This file locks
 * the rules behind them, so a rewrite that keeps the numbers but breaks a rule
 * still fails:
 *  - `src/noise/**` uses no wall clock, no global PRNG and no trigonometry, and
 *    imports nothing but core-types and its own siblings;
 *  - improved Perlin means the fixed gradient tables plus the quintic fade,
 *    rebuilt here from `hashU32` and compared bit for bit (a cubic fade has to
 *    disagree);
 *  - the fBm octave sum is exactly the frequency, amplitude, salt and rotation
 *    progression the terrain layer is tuned against;
 *  - the module-level scratch buffers the v2 hot path introduced never leak
 *    state between calls;
 *  - sampling a region in reversed tiles cannot move a single value, which is
 *    what keeps per-chunk and Worker parallel generation reproducible.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FbmOptions } from '@voxelcraft/core-types'
import { hashU32 } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { CAVES, NOISE_FIELDS, SALT } from '../internal'
import { climateAt, fbm2, fbm3, perlin2, perlin3, warp2, warpStages2 } from '../noise'

const SEED = 1337
const WARP = NOISE_FIELDS.warp

/* -------------------------------------------------------------- sources -- */

const NOISE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'noise')

/** Comments are stripped, so the docs above a rule may name the banned calls. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function noiseSources(): Array<{ file: string; code: string }> {
  return readdirSync(NOISE_DIR)
    .filter((file) => file.endsWith('.ts'))
    .sort()
    .map((file) => ({
      file,
      code: stripComments(readFileSync(join(NOISE_DIR, file), 'utf8')),
    }))
}

/** Assembled at runtime, so a repo-wide grep for the banned calls stays clean. */
function bannedCall(object: string, member: string): RegExp {
  return new RegExp(`\\b${object}\\.${member}\\b`)
}

const BANNED = [
  bannedCall('Math', 'random'),
  bannedCall('Math', 'sin'),
  bannedCall('Math', 'cos'),
  bannedCall('Math', 'tan'),
  bannedCall('Date', 'now'),
  bannedCall('performance', 'now'),
  new RegExp('new\\s+Date\\b'),
]

describe('noise sources', () => {
  it('covers the whole noise layer', () => {
    expect(noiseSources().map((source) => source.file)).toEqual([
      'climate.ts',
      'fbm.ts',
      'index.ts',
      'perlin.ts',
    ])
  })

  it('uses no wall clock, no global PRNG and no trigonometry', () => {
    const offenders: string[] = []
    for (const { file, code } of noiseSources()) {
      for (const banned of BANNED) {
        if (banned.test(code)) offenders.push(`${file}: ${banned.source}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('imports only core-types and its own siblings', () => {
    const foreign: string[] = []
    for (const { file, code } of noiseSources()) {
      for (const match of code.matchAll(/from\s+'([^']+)'/g)) {
        const specifier = match[1]
        if (specifier !== '@voxelcraft/core-types' && !specifier.startsWith('.')) {
          foreign.push(`${file}: ${specifier}`)
        }
      }
    }
    expect(foreign).toEqual([])
  })
})

/* ------------------------------------------------------ perlin reference -- */

const GRAD2 = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, -1, 1, 1, -1, -1, -1]

// prettier-ignore
const GRAD3 = [
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]

const SCALE3 = 0.816496580927726

type Fade = (t: number) => number

/** 6t^5 - 15t^4 + 10t^3, the improved-Perlin interpolant. */
const quintic: Fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)

/** 3t^2 - 2t^3, classic Perlin. Kept to prove the fade is really quintic. */
const cubic: Fade = (t) => t * t * (3 - 2 * t)

function refPerlin2(seed: number, salt: number, x: number, z: number, fade: Fade): number {
  const xi = Math.floor(x)
  const zi = Math.floor(z)
  const xf = x - xi
  const zf = z - zi
  const u = fade(xf)
  const v = fade(zf)
  const grad = (gx: number, gz: number): number => (hashU32(seed, salt, gx, 0, gz) & 7) * 2
  const dot = (gi: number, dx: number, dz: number): number => GRAD2[gi] * dx + GRAD2[gi + 1] * dz
  const n00 = dot(grad(xi, zi), xf, zf)
  const n10 = dot(grad(xi + 1, zi), xf - 1, zf)
  const n01 = dot(grad(xi, zi + 1), xf, zf - 1)
  const n11 = dot(grad(xi + 1, zi + 1), xf - 1, zf - 1)
  const lo = n00 + (n10 - n00) * u
  const hi = n01 + (n11 - n01) * u
  return lo + (hi - lo) * v
}

function refPerlin3(
  seed: number,
  salt: number,
  x: number,
  y: number,
  z: number,
  fade: Fade,
): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const xf = x - xi
  const yf = y - yi
  const zf = z - zi
  const u = fade(xf)
  const v = fade(yf)
  const w = fade(zf)
  const grad = (gx: number, gy: number, gz: number): number =>
    (hashU32(seed, salt, gx, gy, gz) % 12) * 3
  const dot = (gi: number, dx: number, dy: number, dz: number): number =>
    GRAD3[gi] * dx + GRAD3[gi + 1] * dy + GRAD3[gi + 2] * dz
  const n000 = dot(grad(xi, yi, zi), xf, yf, zf)
  const n100 = dot(grad(xi + 1, yi, zi), xf - 1, yf, zf)
  const n010 = dot(grad(xi, yi + 1, zi), xf, yf - 1, zf)
  const n110 = dot(grad(xi + 1, yi + 1, zi), xf - 1, yf - 1, zf)
  const n001 = dot(grad(xi, yi, zi + 1), xf, yf, zf - 1)
  const n101 = dot(grad(xi + 1, yi, zi + 1), xf - 1, yf, zf - 1)
  const n011 = dot(grad(xi, yi + 1, zi + 1), xf, yf - 1, zf - 1)
  const n111 = dot(grad(xi + 1, yi + 1, zi + 1), xf - 1, yf - 1, zf - 1)
  const x00 = n000 + (n100 - n000) * u
  const x10 = n010 + (n110 - n010) * u
  const x01 = n001 + (n101 - n001) * u
  const x11 = n011 + (n111 - n011) * u
  const y0 = x00 + (x10 - x00) * v
  const y1 = x01 + (x11 - x01) * v
  return (y0 + (y1 - y0) * w) * SCALE3
}

describe('improved Perlin construction', () => {
  it('is the fixed 2D gradient table plus the quintic fade, bit for bit', () => {
    let samples = 0
    let quinticMismatches = 0
    let cubicDiffs = 0
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        const x = i * 6.5 + 0.25
        const z = j * -4.5 + 0.375
        const value = perlin2(SEED, SALT.continent, x, z)
        samples++
        if (value !== refPerlin2(SEED, SALT.continent, x, z, quintic)) quinticMismatches++
        if (value !== refPerlin2(SEED, SALT.continent, x, z, cubic)) cubicDiffs++
      }
    }
    expect(quinticMismatches).toBe(0)
    expect(cubicDiffs).toBeGreaterThan(samples * 0.9)
  })

  it('is the 12 cube-edge gradients plus the quintic fade in 3D', () => {
    let samples = 0
    let quinticMismatches = 0
    let cubicDiffs = 0
    for (let i = 0; i < 16; i++) {
      for (let j = 0; j < 16; j++) {
        for (let k = 0; k < 6; k++) {
          const x = i * 5.5 + 0.25
          const y = k * 3.5 + 0.125
          const z = j * -4.5 + 0.375
          const value = perlin3(SEED, SALT.caveCheese, x, y, z)
          samples++
          if (value !== refPerlin3(SEED, SALT.caveCheese, x, y, z, quintic)) quinticMismatches++
          if (value !== refPerlin3(SEED, SALT.caveCheese, x, y, z, cubic)) cubicDiffs++
        }
      }
    }
    expect(quinticMismatches).toBe(0)
    expect(cubicDiffs).toBeGreaterThan(samples * 0.9)
  })
})

/* --------------------------------------------------------- fBm reference -- */

/** cos(0.5) and sin(0.5), as frozen literals. */
const ROT_C = 0.8775825618903728
const ROT_S = 0.479425538604203

/** Salt stride per octave, so octaves never share a gradient field. */
const OCTAVE_SALT_STRIDE = 0x3b9b

const clamp1 = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v)

function refFbm2(seed: number, salt: number, x: number, z: number, opts: FbmOptions): number {
  let px = x
  let pz = z
  let freq = opts.frequency
  let amp = 1
  let sum = 0
  let norm = 0
  let octaveSalt = salt
  for (let o = 0; o < opts.octaves; o++) {
    sum += perlin2(seed, octaveSalt, px * freq, pz * freq) * amp
    norm += amp
    amp *= opts.gain
    freq *= opts.lacunarity
    octaveSalt += OCTAVE_SALT_STRIDE
    if (opts.rotatePerOctave === true) {
      const rx = px * ROT_C - pz * ROT_S
      pz = px * ROT_S + pz * ROT_C
      px = rx
    }
  }
  return norm > 0 ? clamp1(sum / norm) : 0
}

function refFbm3(
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
  let octaveSalt = salt
  for (let o = 0; o < opts.octaves; o++) {
    sum += perlin3(seed, octaveSalt, px * freq, y * freq, pz * freq) * amp
    norm += amp
    amp *= opts.gain
    freq *= opts.lacunarity
    octaveSalt += OCTAVE_SALT_STRIDE
    if (opts.rotatePerOctave === true) {
      const rx = px * ROT_C - pz * ROT_S
      pz = px * ROT_S + pz * ROT_C
      px = rx
    }
  }
  return norm > 0 ? clamp1(sum / norm) : 0
}

const FIELDS: Array<{ name: string; salt: number; fbm: FbmOptions }> = [
  { name: 'continent', ...NOISE_FIELDS.continent },
  { name: 'erosion', ...NOISE_FIELDS.erosion },
  { name: 'temperature', ...NOISE_FIELDS.temperature },
  { name: 'humidity', ...NOISE_FIELDS.humidity },
  { name: 'ridge', ...NOISE_FIELDS.ridge },
  { name: 'detail', ...NOISE_FIELDS.detail },
]

const CAVE_FIELDS: Array<{ name: string; salt: number; fbm: FbmOptions }> = [
  { name: 'cheese', salt: SALT.caveCheese, fbm: CAVES.cheese },
  { name: 'tunnel', salt: SALT.caveTunnelA, fbm: CAVES.tunnel },
]

describe('fBm octave accumulation', () => {
  it('follows the frequency, amplitude, salt and rotation progression', () => {
    for (const field of FIELDS) {
      let mismatches = 0
      for (let i = 0; i < 60; i++) {
        const x = i * 37.5 - 1200.25
        const z = i * -29.5 + 800.375
        if (fbm2(SEED, field.salt, x, z, field.fbm) !== refFbm2(SEED, field.salt, x, z, field.fbm)) {
          mismatches++
        }
      }
      expect(mismatches, `${field.name} 2D`).toBe(0)
    }
  })

  it('follows the same progression in 3D on the cave fields', () => {
    for (const field of CAVE_FIELDS) {
      let mismatches = 0
      for (let i = 0; i < 40; i++) {
        const x = i * 13.5 - 300.25
        const y = (i % 7) * 11.5 + 2.125
        const z = i * -9.5 + 210.375
        const value = fbm3(SEED, field.salt, x, y, z, field.fbm)
        if (value !== refFbm3(SEED, field.salt, x, y, z, field.fbm)) mismatches++
      }
      expect(mismatches, `${field.name} 3D`).toBe(0)
    }
  })

  it('adds octave o at gain^o and lacunarity^o, normalized by the amplitude sum', () => {
    const opts: FbmOptions = {
      octaves: 4,
      lacunarity: 1.98,
      gain: 0.51,
      frequency: 1 / 128,
      rotatePerOctave: false,
    }
    const x = 312.5
    const z = -517.25
    let sum = 0
    let norm = 0
    for (let o = 0; o < opts.octaves; o++) {
      const amp = opts.gain ** o
      const freq = opts.frequency * opts.lacunarity ** o
      sum += perlin2(SEED, SALT.continent + o * OCTAVE_SALT_STRIDE, x * freq, z * freq) * amp
      norm += amp
    }
    // Closed form, so the accumulated rounding differs in the last bits only.
    expect(fbm2(SEED, SALT.continent, x, z, opts)).toBeCloseTo(sum / norm, 12)
  })

  it('keeps the contract fBm shape on the climate fields', () => {
    for (const name of ['continent', 'erosion', 'temperature', 'humidity'] as const) {
      const field = NOISE_FIELDS[name]
      expect(field.fbm.lacunarity, `${name} lacunarity`).toBe(1.98)
      expect(field.fbm.rotatePerOctave, `${name} rotation`).toBe(true)
    }
    expect(NOISE_FIELDS.continent.fbm.gain).toBe(0.51)
    expect(NOISE_FIELDS.continent.fbm.octaves).toBeGreaterThanOrEqual(4)
  })
})

/* ------------------------------------------------------- shared scratch -- */

describe('shared scratch buffers', () => {
  it('never leak state between climate, warp and warp-stage calls', () => {
    const points: Array<[number, number]> = []
    for (let i = 0; i < 120; i++) points.push([i * 53.5 - 1600.25, i * -37.5 + 900.125])
    const isolated = points.map(([x, z]) => climateAt(SEED, x, z))
    const out = new Float64Array(4)
    const interleaved = points.map(([x, z], i) => {
      warp2(SEED, WARP.saltX, WARP.saltZ, x * 1.5, z * -0.5, WARP.amount, WARP.frequency)
      warpStages2(
        SEED,
        WARP.saltX,
        WARP.saltZ,
        WARP.saltX2,
        WARP.saltZ2,
        x + i,
        z - i,
        WARP.amount,
        WARP.frequency,
        out,
      )
      const sample = climateAt(SEED, x, z)
      warp2(SEED, WARP.saltX2, WARP.saltZ2, z, x, WARP.amount * 0.5, WARP.frequency * 2)
      return sample
    })
    expect(interleaved).toEqual(isolated)
  })

  it('returns warp results the caller can keep across further calls', () => {
    const first = warp2(SEED, WARP.saltX, WARP.saltZ, 420.5, -137.25, WARP.amount, WARP.frequency)
    const kept = { x: first.x, z: first.z }
    for (let i = 0; i < 50; i++) {
      warp2(SEED, WARP.saltX, WARP.saltZ, i * 11.5, i * -7.25, WARP.amount, WARP.frequency)
      climateAt(SEED, i * 31.5, i * -17.25)
    }
    expect(first).toEqual(kept)
  })
})

/* -------------------------------------------------------- tile splitting -- */

describe('region splitting', () => {
  it('gives the same climate values sampled whole or in reversed tiles', () => {
    const size = 48
    const originX = -768
    const originZ = 512
    const whole = new Float64Array(size * size)
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        whole[z * size + x] = climateAt(SEED, originX + x, originZ + z).continent
      }
    }
    const tiled = new Float64Array(size * size)
    const step = 16
    for (let tz = size - step; tz >= 0; tz -= step) {
      for (let tx = size - step; tx >= 0; tx -= step) {
        for (let z = step - 1; z >= 0; z--) {
          for (let x = step - 1; x >= 0; x--) {
            tiled[(tz + z) * size + tx + x] = climateAt(
              SEED,
              originX + tx + x,
              originZ + tz + z,
            ).continent
          }
        }
      }
    }
    expect(tiled).toEqual(whole)
  })
})
