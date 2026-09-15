/**
 * Acceptance tests for the fluid engine (owner sim-b).
 *
 * The convergence tests are the important ones: the arena has to reach a fixed
 * point in a finite number of ticks, and re-scheduling every cell afterwards
 * must not write anything. That is what rules out the oscillation the direct
 * write approach suffers from (decisions.md D-017).
 */
import {
  BLOCK,
  EVENT,
  FLUID,
  FLUID_MAX_LEVEL,
  FLUID_TICKS,
  PERF,
  unpackFluid,
} from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { createRecordingEventBus } from '../shared'
import { systemOrderIndex } from '../schedule'
import { createFlatTestWorld, createTestArena } from '../testing'
import { FLUID_SYSTEM_NAME, fluidCreateEngine, fluidSystemEntry } from './index'

describe('fluid convergence', () => {
  it('settles the arena in finite ticks and then stays still', () => {
    const { world } = createTestArena()
    const events = createRecordingEventBus()
    const engine = fluidCreateEngine({ world, events })
    engine.scheduleAll()
    const ticks = engine.settle()
    expect(ticks).toBeGreaterThan(0)
    expect(engine.pending).toBe(0)

    // Re-evaluating every cell of the settled world changes nothing.
    const settled = world.hash()
    events.resetRecording()
    engine.scheduleAll()
    engine.settle()
    expect(engine.pending).toBe(0)
    expect(world.hash()).toBe(settled)
    expect(events.recorded).toHaveLength(0)
  })

  it('spreads exactly seven levels away from a source', () => {
    const { world, floorTop, waterPool } = createTestArena()
    const engine = fluidCreateEngine({ world })
    engine.scheduleAll()
    engine.settle()

    const z = 9
    for (let step = 1; step <= FLUID_MAX_LEVEL; step++) {
      expect(world.fluidStateAt(waterPool.xTo + step, floorTop, z)).toEqual({
        kind: FLUID.Water,
        level: step,
        falling: false,
      })
    }
    expect(world.fluidStateAt(waterPool.xTo + FLUID_MAX_LEVEL + 1, floorTop, z).kind).toBe(
      FLUID.None,
    )
    // Only the bottom layer spreads: above it the source pours downwards.
    expect(world.fluidStateAt(waterPool.xTo + 1, floorTop + 1, z).kind).toBe(FLUID.None)
  })

  it('never writes light while the fluid layer changes', () => {
    const { world } = createTestArena()
    const chunk = world.getChunk(0, 0)
    expect(chunk).toBeDefined()
    if (!chunk) return
    const lightBefore = Uint8Array.from(chunk.light)
    const engine = fluidCreateEngine({ world })
    engine.scheduleAll()
    engine.settle()
    expect(Uint8Array.from(chunk.light)).toEqual(lightBefore)
  })
})

describe('fluid flow', () => {
  it('falls straight down and only spreads where it lands', () => {
    const { world, floorTop } = createFlatTestWorld()
    const engine = fluidCreateEngine({ world })
    const sourceY = floorTop + 6
    world.setBlock(0, sourceY, 0, BLOCK.WATER)
    engine.onNeighborChanged(0, sourceY, 0)
    engine.settle()
    expect(engine.pending).toBe(0)

    for (let y = floorTop; y < sourceY; y++) {
      expect(world.fluidStateAt(0, y, 0)).toEqual({
        kind: FLUID.Water,
        level: 0,
        falling: true,
      })
    }
    // A falling column does not wet its sides on the way down.
    expect(world.fluidStateAt(1, sourceY - 2, 0).kind).toBe(FLUID.None)
    // It does spread once it hits the ground, at full strength.
    expect(world.fluidStateAt(1, floorTop, 0)).toEqual({
      kind: FLUID.Water,
      level: 1,
      falling: false,
    })

    // Packed byte: bits 0..2 level, bit 3 falling, bits 4..5 kind.
    const packed = world.getFluid(0, sourceY - 1, 0)
    expect(packed & 7).toBe(0)
    expect(packed & 8).toBe(8)
    expect((packed >> 4) & 3).toBe(FLUID.Water)
    expect(unpackFluid(packed)).toEqual({ kind: FLUID.Water, level: 0, falling: true })
  })

  it('drains again when the source is removed', () => {
    const { world, floorTop } = createFlatTestWorld()
    const engine = fluidCreateEngine({ world })
    const empty = world.hash()

    world.setBlock(0, floorTop, 0, BLOCK.WATER)
    engine.onNeighborChanged(0, floorTop, 0)
    engine.settle()
    expect(world.fluidStateAt(4, floorTop, 0).kind).toBe(FLUID.Water)

    world.setBlock(0, floorTop, 0, BLOCK.AIR)
    engine.onNeighborChanged(0, floorTop, 0)
    engine.settle()
    expect(engine.pending).toBe(0)
    expect(world.fluidStateAt(4, floorTop, 0).kind).toBe(FLUID.None)
    expect(world.hash()).toBe(empty)
  })

  it('computeFluidAt is a pure read of the neighbourhood', () => {
    const { world, floorTop, waterPool } = createTestArena()
    const engine = fluidCreateEngine({ world })
    const before = world.hash()
    const first = engine.computeFluidAt(waterPool.xTo + 1, floorTop, 9)
    const second = engine.computeFluidAt(waterPool.xTo + 1, floorTop, 9)
    expect(first).toEqual({ kind: FLUID.Water, level: 1, falling: false })
    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(world.hash()).toBe(before)
    expect(engine.pending).toBe(0)
  })

  it('emits fluid.changed with the byte that ends up in the world', () => {
    const { world, floorTop } = createFlatTestWorld()
    const events = createRecordingEventBus()
    const engine = fluidCreateEngine({ world, events })
    world.setBlock(0, floorTop + 2, 0, BLOCK.WATER)
    engine.onNeighborChanged(0, floorTop + 2, 0)
    engine.settle()

    const last = new Map<string, number>()
    for (const entry of events.recorded) {
      if (entry.name !== EVENT.FluidChanged) continue
      const payload = entry.payload as { x: number; y: number; z: number; packed: number }
      last.set(`${payload.x},${payload.y},${payload.z}`, payload.packed)
    }
    expect(last.size).toBeGreaterThan(0)
    for (const [key, packed] of last) {
      const [x, y, z] = key.split(',').map(Number)
      expect(world.getFluid(x, y, z)).toBe(packed)
    }
  })
})

describe('fluid interaction', () => {
  it('turns a lava source into obsidian where water touches it', () => {
    const { world, floorTop } = createFlatTestWorld()
    const events = createRecordingEventBus()
    const engine = fluidCreateEngine({ world, events })
    world.setBlock(0, floorTop, 0, BLOCK.LAVA)
    world.setBlock(1, floorTop, 0, BLOCK.WATER)
    expect(engine.interactionAt(0, floorTop, 0)).toBe(BLOCK.OBSIDIAN)

    engine.onNeighborChanged(0, floorTop, 0)
    engine.onNeighborChanged(1, floorTop, 0)
    engine.settle()
    expect(engine.pending).toBe(0)
    expect(world.getBlock(0, floorTop, 0)).toBe(BLOCK.OBSIDIAN)
    expect(world.fluidStateAt(0, floorTop, 0).kind).toBe(FLUID.None)
    expect(
      events.recorded.some(
        (entry) =>
          entry.name === EVENT.BlockChanged &&
          (entry.payload as { after: number }).after === BLOCK.OBSIDIAN,
      ),
    ).toBe(true)
  })

  it('turns flowing lava into cobblestone and leaves no contact behind', () => {
    const { world, floorTop } = createFlatTestWorld()
    const engine = fluidCreateEngine({ world })
    world.setBlock(-6, floorTop, 0, BLOCK.LAVA)
    world.setBlock(6, floorTop, 0, BLOCK.WATER)
    engine.onNeighborChanged(-6, floorTop, 0)
    engine.onNeighborChanged(6, floorTop, 0)
    engine.settle()
    expect(engine.pending).toBe(0)

    const solidified: number[] = []
    for (let x = -5; x <= 5; x++) {
      if (world.getBlock(x, floorTop, 0) === BLOCK.COBBLESTONE) solidified.push(x)
    }
    expect(solidified.length).toBeGreaterThan(0)

    // Invariant of the settled state: lava never touches water.
    for (let x = -8; x <= 8; x++) {
      for (let z = -8; z <= 8; z++) {
        if (world.fluidStateAt(x, floorTop, z).kind !== FLUID.Lava) continue
        expect(engine.interactionAt(x, floorTop, z)).toBe(null)
      }
    }
  })
})

describe('fluid scheduling', () => {
  it('never processes more cells than the tick budget allows', () => {
    const { world } = createTestArena()
    const engine = fluidCreateEngine({ world })
    engine.scheduleAll()
    expect(engine.pending).toBeGreaterThan(2)

    expect(engine.tick(FLUID_TICKS.water, 2)).toBeLessThanOrEqual(2)
    expect(engine.pending).toBeGreaterThan(0)
    expect(engine.tick(FLUID_TICKS.water + 1, PERF.fluidCellsPerTick)).toBeLessThanOrEqual(
      PERF.fluidCellsPerTick,
    )
  })

  it('registers in the fluid slot, before light', () => {
    const { world } = createFlatTestWorld()
    const engine = fluidCreateEngine({ world })
    expect(fluidSystemEntry(engine).name).toBe(FLUID_SYSTEM_NAME)
    expect(systemOrderIndex(FLUID_SYSTEM_NAME)).toBeLessThan(systemOrderIndex('light'))
  })
})
