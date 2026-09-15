import {
  BLOCK,
  CHUNK_VOLUME,
  CHUNK_X,
  CHUNK_Z,
  FLUID,
  SEA_LEVEL,
  blockIndex,
  hash01,
  hashU32,
  packFluid,
} from '@voxelcraft/core-types'

/**
 * Deterministic terrain fixture for the benchmark.
 *
 * packages/world is still a stub, so the bench owns a small value-noise
 * generator built on the shared hashU32 / hash01 primitives. It is only meant to
 * produce a realistic amount of work per chunk (surface, caves, ores, an ocean
 * layer), not to match the real world generator.
 */
export const FIXTURE_TERRAIN_VERSION = 'bench-terrain-1'

export interface FixtureChunk {
  cx: number
  cz: number
  blocks: Uint16Array
  fluids: Uint8Array
}

const WATER_FLUID = packFluid({ kind: FLUID.Water, level: 0, falling: false })
const ORES = [BLOCK.COAL_ORE, BLOCK.IRON_ORE, BLOCK.GOLD_ORE, BLOCK.DIAMOND_ORE] as const

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

function valueNoise(seed: number, salt: number, x: number, z: number): number {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const fx = smooth(x - x0)
  const fz = smooth(z - z0)
  const n00 = hash01(seed, salt, x0, 0, z0)
  const n10 = hash01(seed, salt, x0 + 1, 0, z0)
  const n01 = hash01(seed, salt, x0, 0, z0 + 1)
  const n11 = hash01(seed, salt, x0 + 1, 0, z0 + 1)
  const a = n00 + (n10 - n00) * fx
  const b = n01 + (n11 - n01) * fx
  return a + (b - a) * fz
}

/** Three octaves of value noise mapped around sea level. */
export function surfaceHeight(seed: number, wx: number, wz: number): number {
  let amplitude = 1
  let frequency = 1 / 48
  let sum = 0
  let norm = 0
  for (let octave = 0; octave < 3; octave++) {
    sum += valueNoise(seed, 11 + octave, wx * frequency, wz * frequency) * amplitude
    norm += amplitude
    amplitude *= 0.5
    frequency *= 2
  }
  return Math.round(SEA_LEVEL - 6 + (sum / norm) * 26)
}

export function createEmptyFixtureChunk(cx: number, cz: number): FixtureChunk {
  return {
    cx,
    cz,
    blocks: new Uint16Array(CHUNK_VOLUME),
    fluids: new Uint8Array(CHUNK_VOLUME),
  }
}

export function generateFixtureChunk(
  seed: number,
  cx: number,
  cz: number,
  out?: FixtureChunk,
): FixtureChunk {
  const chunk = out ?? createEmptyFixtureChunk(cx, cz)
  chunk.cx = cx
  chunk.cz = cz
  const blocks = chunk.blocks
  const fluids = chunk.fluids
  blocks.fill(0)
  fluids.fill(0)

  for (let lz = 0; lz < CHUNK_Z; lz++) {
    const wz = cz * CHUNK_Z + lz
    for (let lx = 0; lx < CHUNK_X; lx++) {
      const wx = cx * CHUNK_X + lx
      const height = surfaceHeight(seed, wx, wz)

      for (let y = 0; y < 4; y++) {
        blocks[blockIndex(lx, y, lz)] = BLOCK.BEDROCK
      }

      for (let y = 4; y <= height; y++) {
        let id = BLOCK.STONE
        if (y > height - 4) id = BLOCK.DIRT
        if (y === height) id = height < SEA_LEVEL ? BLOCK.SAND : BLOCK.GRASS_BLOCK
        if (y > 6 && y < 52 && hash01(seed, 31, wx, y, wz) > 0.972) id = BLOCK.AIR
        blocks[blockIndex(lx, y, lz)] = id
      }

      for (let y = height + 1; y <= SEA_LEVEL; y++) {
        const index = blockIndex(lx, y, lz)
        blocks[index] = BLOCK.WATER
        fluids[index] = WATER_FLUID
      }
    }
  }

  for (let attempt = 0; attempt < 48; attempt++) {
    const h = hashU32(seed, 71 + attempt, cx, 0, cz)
    const lx = h & 15
    const lz = (h >>> 4) & 15
    const y = 6 + ((h >>> 8) % 48)
    const ore = ORES[(h >>> 16) % ORES.length]
    for (let step = 0; step < 6; step++) {
      const index = blockIndex((lx + step) & 15, y + (step & 1), (lz + (step >> 1)) & 15)
      if (blocks[index] === BLOCK.STONE) blocks[index] = ore
    }
  }

  return chunk
}
