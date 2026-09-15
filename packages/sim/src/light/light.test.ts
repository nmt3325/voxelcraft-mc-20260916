/**
 * Acceptance tests for the light engine (owner sim-b).
 *
 * The four required propagation patterns are one test each: placement,
 * breaking, diagonal spread and crossing a chunk border. "Differential update
 * equals full recompute" is checked through `world.hash()`, which covers the
 * whole light array of every loaded chunk instead of a handful of voxels.
 *
 * The fixtures deliberately sit high up (FLOOR_TOP) and stay small: seeding
 * cost is one write per air voxel above the floor, so a high thin world keeps
 * the suite fast without changing any of the behaviour under test.
 */
import { BLOCK, EVENT, MAX_LIGHT, PERF } from '@voxelcraft/core-types'
import type { BlockId } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { createRecordingEventBus, lightPropsOf } from '../shared'
import type { SimVoxelWorld } from '../shared'
import { systemOrderIndex } from '../schedule'
import { createFlatTestWorld, createTestArena } from '../testing'
import { LIGHT_SYSTEM_NAME, lightCreateEngine, lightSystemEntry } from './index'
import type { LightEngineInstance } from './index'

const FLOOR_TOP = 200
const EXTENT = 8
/** Wide enough to load chunks (0,0), (1,0), (0,1) and (1,1). */
const SEAM_EXTENT = 16
const TIMEOUT = 20_000

/** Edits a block the way the game loop does: write, notify, then propagate. */
function placeBlock(
  world: SimVoxelWorld,
  engine: LightEngineInstance,
  x: number,
  y: number,
  z: number,
  id: BlockId,
): void {
  const before = lightPropsOf(world.getBlock(x, y, z))
  world.setBlock(x, y, z, id)
  engine.onBlockChanged(x, y, z, before, lightPropsOf(id))
  engine.drain()
}

function flatWorld(extent: number = EXTENT): SimVoxelWorld {
  return createFlatTestWorld({ floorTop: FLOOR_TOP, extent }).world
}

function litFlatWorld(extent: number = EXTENT): {
  world: SimVoxelWorld
  engine: LightEngineInstance
} {
  const world = flatWorld(extent)
  const engine = lightCreateEngine({ world })
  engine.seedAll()
  return { world, engine }
}

/** The same world, lit from scratch. The reference for every diff update. */
function recomputed(edit: (world: SimVoxelWorld) => void, extent: number = EXTENT): SimVoxelWorld {
  const world = flatWorld(extent)
  edit(world)
  lightCreateEngine({ world }).seedAll()
  return world
}

describe('light seeding', () => {
  it(
    'fills the open sky and leaves the ground dark',
    () => {
      const { world, engine } = litFlatWorld()
      expect(engine.sample(0, FLOOR_TOP, 0)).toEqual({ sky: MAX_LIGHT, block: 0 })
      expect(engine.sample(0, FLOOR_TOP + 40, 0).sky).toBe(MAX_LIGHT)
      expect(engine.sample(0, FLOOR_TOP - 1, 0).sky).toBe(0)
      expect(engine.sample(0, FLOOR_TOP - 2, 0).sky).toBe(0)
      // One byte per voxel: (sky << 4) | block.
      expect(world.getLightByte(0, FLOOR_TOP, 0)).toBe(MAX_LIGHT << 4)
      expect(engine.pending).toBe(0)
    },
    TIMEOUT,
  )

  it(
    'attenuates sky light with opacity and skyFilter through water',
    () => {
      const { world, floorTop, waterPool } = createTestArena()
      const engine = lightCreateEngine({ world })
      engine.seedAll()
      const z = 9
      // Water is opacity 2 / skyFilter 1, so each step costs 1 + 2 + 1 = 4.
      expect(engine.sample(0, waterPool.top, z).sky).toBe(MAX_LIGHT)
      expect(engine.sample(0, waterPool.top - 1, z).sky).toBe(11)
      expect(engine.sample(0, waterPool.top - 2, z).sky).toBe(7)
      expect(engine.sample(0, waterPool.top - 3, z).sky).toBe(3)
      expect(engine.sample(0, floorTop, z).sky).toBe(0)
      // Lava emits its own light.
      expect(engine.sample(0, floorTop, -9).block).toBe(MAX_LIGHT)
      expect(engine.sample(0, floorTop + 2, -9).block).toBe(MAX_LIGHT - 1)
    },
    TIMEOUT,
  )
})

describe('light differential update', () => {
  it(
    'casts a shadow when a block is placed',
    () => {
      const { world, engine } = litFlatWorld()
      placeBlock(world, engine, 0, FLOOR_TOP + 1, 0, BLOCK.STONE)

      expect(engine.sample(0, FLOOR_TOP + 1, 0).sky).toBe(0)
      // Shadowed, but still reached sideways by the open sky next to it.
      expect(engine.sample(0, FLOOR_TOP, 0).sky).toBe(MAX_LIGHT - 1)
      expect(engine.sample(1, FLOOR_TOP, 0).sky).toBe(MAX_LIGHT)
      expect(engine.pending).toBe(0)
      expect(world.hash()).toBe(
        recomputed((w) => w.setBlock(0, FLOOR_TOP + 1, 0, BLOCK.STONE)).hash(),
      )
    },
    TIMEOUT,
  )

  it(
    'restores the light when a block is broken',
    () => {
      const { world, engine } = litFlatWorld()
      const pristine = world.hash()
      placeBlock(world, engine, 0, FLOOR_TOP + 1, 0, BLOCK.STONE)
      expect(world.hash()).not.toBe(pristine)

      placeBlock(world, engine, 0, FLOOR_TOP + 1, 0, BLOCK.AIR)
      expect(engine.sample(0, FLOOR_TOP + 1, 0).sky).toBe(MAX_LIGHT)
      expect(engine.sample(0, FLOOR_TOP, 0).sky).toBe(MAX_LIGHT)
      // Removal plus re-propagation has to land exactly where it started.
      expect(world.hash()).toBe(pristine)
    },
    TIMEOUT,
  )

  it(
    'removes block light again when the emitter is broken',
    () => {
      const { world, engine } = litFlatWorld()
      const pristine = world.hash()
      const y = FLOOR_TOP + 6
      placeBlock(world, engine, 0, y, 0, BLOCK.GLOWSTONE)
      expect(engine.sample(1, y, 0).block).toBe(MAX_LIGHT - 1)

      placeBlock(world, engine, 0, y, 0, BLOCK.AIR)
      expect(engine.sample(0, y, 0).block).toBe(0)
      expect(engine.sample(1, y, 0).block).toBe(0)
      expect(world.hash()).toBe(pristine)
    },
    TIMEOUT,
  )

  it(
    'spreads block light diagonally, one level per step',
    () => {
      const { world, engine } = litFlatWorld()
      const y = FLOOR_TOP + 6
      placeBlock(world, engine, 0, y, 0, BLOCK.TORCH)

      expect(engine.sample(0, y, 0).block).toBe(14)
      expect(engine.sample(1, y, 0).block).toBe(13)
      // Diagonals are two, three and four BFS steps away.
      expect(engine.sample(1, y, 1).block).toBe(12)
      expect(engine.sample(1, y + 1, 1).block).toBe(11)
      expect(engine.sample(2, y, 2).block).toBe(10)
      // A torch lets the sky through, so both channels share the byte.
      expect(world.getLightByte(0, y, 0)).toBe((MAX_LIGHT << 4) | 14)
      expect(world.hash()).toBe(recomputed((w) => w.setBlock(0, y, 0, BLOCK.TORCH)).hash())
    },
    TIMEOUT,
  )
})

describe('light chunk stitching', () => {
  it(
    'carries light across a chunk corner in two passes',
    () => {
      const y = FLOOR_TOP + 6
      const world = flatWorld(SEAM_EXTENT)
      world.setBlock(15, y, 15, BLOCK.GLOWSTONE)
      const engine = lightCreateEngine({ world })
      for (const chunk of world.orderedChunks()) engine.seedChunk(chunk.cx, chunk.cz)

      // Seeding is confined to one chunk, so the seams start out dark.
      expect(engine.sample(15, y, 15).block).toBe(MAX_LIGHT)
      expect(engine.sample(16, y, 15).block).toBe(0)

      engine.stitchBoundaries(2)
      expect(engine.sample(16, y, 15).block).toBe(MAX_LIGHT - 1)
      expect(engine.sample(15, y, 16).block).toBe(MAX_LIGHT - 1)
      // The diagonal needs the second pass: light has to leave chunk (0,0)
      // through (1,0) or (0,1) before it can reach (1,1).
      expect(engine.sample(16, y, 16).block).toBe(MAX_LIGHT - 2)
      expect(engine.sample(17, y, 16).block).toBe(MAX_LIGHT - 3)

      // Converged: further passes are no-ops.
      const converged = world.hash()
      engine.stitchBoundaries(2)
      expect(world.hash()).toBe(converged)
    },
    TIMEOUT,
  )

  it(
    'matches a full recompute after an edit on a chunk border',
    () => {
      const y = FLOOR_TOP + 6
      const world = flatWorld(SEAM_EXTENT)
      const engine = lightCreateEngine({ world })
      engine.seedAll()
      placeBlock(world, engine, 15, y, 15, BLOCK.GLOWSTONE)
      placeBlock(world, engine, 16, FLOOR_TOP + 1, -16, BLOCK.STONE)

      expect(world.hash()).toBe(
        recomputed((w) => {
          w.setBlock(15, y, 15, BLOCK.GLOWSTONE)
          w.setBlock(16, FLOOR_TOP + 1, -16, BLOCK.STONE)
        }, SEAM_EXTENT).hash(),
      )
    },
    TIMEOUT,
  )
})

describe('light budget and dirty sections', () => {
  it(
    'stays inside the op budget and reports dirty sections once',
    () => {
      const world = flatWorld()
      const events = createRecordingEventBus()
      const engine = lightCreateEngine({ world, events })
      engine.seedAll()
      const out = new Int32Array(3 * 64)
      engine.drainDirtySections(out)
      events.resetRecording()

      const y = FLOOR_TOP + 6
      const before = lightPropsOf(world.getBlock(0, y, 0))
      world.setBlock(0, y, 0, BLOCK.GLOWSTONE)
      engine.onBlockChanged(0, y, 0, before, lightPropsOf(BLOCK.GLOWSTONE))

      expect(engine.step(4)).toBeLessThanOrEqual(4)
      expect(engine.pending).toBeGreaterThan(0)
      expect(engine.step(PERF.lightOpsPerTick)).toBeLessThanOrEqual(PERF.lightOpsPerTick)
      engine.drain()
      expect(engine.pending).toBe(0)

      const count = engine.drainDirtySections(out)
      expect(count).toBeGreaterThan(0)
      expect(events.recorded.filter((entry) => entry.name === EVENT.LightUpdated)).toHaveLength(
        count,
      )
      // Draining clears the set.
      expect(engine.drainDirtySections(out)).toBe(0)
    },
    TIMEOUT,
  )

  it('registers in the light slot, after fluid', () => {
    const world = flatWorld()
    const engine = lightCreateEngine({ world })
    expect(lightSystemEntry(engine).name).toBe(LIGHT_SYSTEM_NAME)
    expect(systemOrderIndex('fluid')).toBeLessThan(systemOrderIndex(LIGHT_SYSTEM_NAME))
  })
})
