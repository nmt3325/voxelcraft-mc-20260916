/**
 * Water and lava flow (`fluid` subtree, owner sim-b).
 *
 * - `computeFluidAt` is a pure function of the neighbourhood: it only reads the
 *   world and always returns a fresh `FluidState`, so the same input gives the
 *   same output and nothing is mutated.
 * - Levels run from 0 (source) to `FLUID_MAX_LEVEL`, one byte per voxel through
 *   `packFluid` / `unpackFluid`. A voxel pulls its state from its neighbours:
 *   anything above pours straight down (`falling`), otherwise the state is the
 *   cheapest horizontal neighbour plus one level. Above `FLUID_MAX_LEVEL` the
 *   fluid simply stops, which is also how it drains once a source is removed.
 * - A voxel that can pour downwards never spreads sideways, and a voxel that
 *   can only spread sideways prefers the directions that lead to the closest
 *   hole within `FLUID_TICKS.downhillSearchRadius`. Both rules depend on blocks
 *   only, never on fluid levels, so the level field is a plain shortest path
 *   from the sources: the relaxation converges instead of oscillating.
 * - Water touching lava solidifies the lava: a lava source turns into obsidian,
 *   flowing lava into cobblestone. That is a block edit, so it is applied by
 *   `tick` (through `EVENT.BlockChanged`) and kept out of the pure computation.
 * - Updates are scheduled into a `FLUID_TICKS.buckets` ring with the per kind
 *   delay (`FLUID_TICKS.water` / `FLUID_TICKS.lava`). The ring has one slot more
 *   than `FLUID_TICKS.maxDelay`, so a cell scheduled while a tick is running can
 *   never land in the slot that tick is draining. One tick processes at most
 *   `budgetCells` voxels (`PERF.fluidCellsPerTick`); the rest keeps its order
 *   and is carried to the next tick.
 * - Only the fluid layer is written for flowing fluid; block ids stay untouched
 *   (`ChunkData.fluids` is the source of truth) and `setFluid` never touches
 *   light, as required by the contract note in `light.ts`.
 * - Every constant comes from `@voxelcraft/core-types`. Nothing here is random
 *   or time dependent.
 */
import {
  BLOCK,
  CHUNK_X,
  CHUNK_Y,
  CHUNK_Z,
  EVENT,
  FACE,
  FACE_DIRS,
  FLUID,
  FLUID_EMPTY,
  FLUID_MAX_LEVEL,
  FLUID_TICKS,
  OPPOSITE_FACE,
  PERF,
  indexX,
  indexY,
  indexZ,
  packFluid,
  worldToChunk,
} from '@voxelcraft/core-types'
import type {
  BlockId,
  EventBus,
  FluidEngine,
  FluidKind,
  FluidState,
  SystemEntry,
  SystemFn,
  Tick,
} from '@voxelcraft/core-types'
import { fluidKindOf, simBlockProps } from '../shared/blockProps'
import type { SimVoxelWorld } from '../shared/voxelWorld'

/** Name of this system inside the contract's `SYSTEM_ORDER`. */
export const FLUID_SYSTEM_NAME = 'fluid'

/** Horizontal faces, in canonical `FACE` order. */
const HORIZONTAL: readonly number[] = [FACE.NegX, FACE.PosX, FACE.NegZ, FACE.PosZ]

/** A voxel can hold fluid when it is neither solid nor protected. */
export function fluidCanHold(id: BlockId): boolean {
  const props = simBlockProps(id)
  return !props.solid && props.replaceable
}

/** Source kind implied by a placed source block, or `FLUID.None`. */
export function fluidSourceKindOf(id: BlockId): FluidKind {
  if (id === BLOCK.WATER) return FLUID.Water
  if (id === BLOCK.LAVA) return FLUID.Lava
  return FLUID.None
}

const emptyState = (): FluidState => ({ kind: FLUID.None, level: 0, falling: false })

export interface FluidEngineOptions {
  world: SimVoxelWorld
  /** Optional bus for `EVENT.FluidChanged` and `EVENT.BlockChanged`. */
  events?: EventBus
}

export interface FluidEngineInstance extends FluidEngine {
  /** Voxels waiting in the delay ring (plus the budget carry over). */
  readonly pending: number
  /** Ticks forward from `startTick` until nothing is scheduled. Returns ticks run. */
  settle(startTick?: Tick, maxTicks?: number, budgetCells?: number): number
  /** Block that a water/lava contact turns this voxel into, or `null`. */
  interactionAt(x: number, y: number, z: number): BlockId | null
  /** Schedules every fluid bearing voxel of every loaded chunk. */
  scheduleAll(): void
}

export function fluidCreateEngine(options: FluidEngineOptions): FluidEngineInstance {
  const world = options.world
  const events = options.events
  const buckets: number[][] = Array.from({ length: FLUID_TICKS.buckets }, () => [])
  /** Keys of every scheduled voxel, so the ring can never hold a duplicate. */
  const pendingKeys = new Set<string>()
  let carry: number[] = []
  let currentTick: Tick = 0
  let lastTick = -1

  const inColumn = (y: number): boolean => y >= 0 && y < CHUNK_Y

  const canHoldAt = (x: number, y: number, z: number): boolean =>
    inColumn(y) && fluidCanHold(world.getBlock(x, y, z))

  /**
   * Steps through the same y plane, over voxels that can hold fluid, to the
   * closest hole. Depends on blocks only, so the allowed flow directions stay
   * fixed while the fluid moves.
   */
  const holeDistanceFrom = (x: number, y: number, z: number, radius: number): number => {
    if (!canHoldAt(x, y, z)) return Number.POSITIVE_INFINITY
    if (canHoldAt(x, y - 1, z)) return 1
    const visited = new Set<string>([`${x},${z}`])
    let frontier: number[] = [x, z]
    for (let distance = 2; distance <= radius; distance++) {
      const next: number[] = []
      for (let i = 0; i < frontier.length; i += 2) {
        for (const face of HORIZONTAL) {
          const dir = FACE_DIRS[face]
          const nx = frontier[i] + dir.x
          const nz = frontier[i + 1] + dir.z
          const key = `${nx},${nz}`
          if (visited.has(key)) continue
          visited.add(key)
          if (!canHoldAt(nx, y, nz)) continue
          if (canHoldAt(nx, y - 1, nz)) return distance
          next.push(nx, nz)
        }
      }
      if (next.length === 0) break
      frontier = next
    }
    return Number.POSITIVE_INFINITY
  }

  /** Faces this voxel may spread to: the closest downhill, else all four. */
  const flowFaces = (x: number, y: number, z: number): number[] => {
    const distances = HORIZONTAL.map((face) => {
      const dir = FACE_DIRS[face]
      return holeDistanceFrom(x + dir.x, y, z + dir.z, FLUID_TICKS.downhillSearchRadius)
    })
    let best = Number.POSITIVE_INFINITY
    for (const distance of distances) if (distance < best) best = distance
    if (!Number.isFinite(best)) return [...HORIZONTAL]
    return HORIZONTAL.filter((_face, index) => distances[index] === best)
  }

  /**
   * Pure: reads the neighbourhood and returns the state this voxel should hold.
   * No writes, no scheduling, no hidden state.
   */
  const computeFluidAt = (x: number, y: number, z: number): FluidState => {
    if (!inColumn(y)) return emptyState()
    const id = world.getBlock(x, y, z)
    const own = fluidSourceKindOf(id)
    if (own !== FLUID.None) return { kind: own, level: 0, falling: false }
    if (!fluidCanHold(id)) return emptyState()

    // Anything above pours straight down; a falling voxel acts like a source.
    if (inColumn(y + 1)) {
      const above = world.fluidStateAt(x, y + 1, z)
      if (above.kind !== FLUID.None) return { kind: above.kind, level: 0, falling: true }
    }

    let bestKind: FluidKind = FLUID.None
    let bestLevel = FLUID_MAX_LEVEL + 1
    for (const face of HORIZONTAL) {
      const dir = FACE_DIRS[face]
      const nx = x + dir.x
      const nz = z + dir.z
      const neighbour = world.fluidStateAt(nx, y, nz)
      if (neighbour.kind === FLUID.None) continue
      // A voxel that can pour downwards does not spread sideways.
      if (canHoldAt(nx, y - 1, nz)) continue
      const isSource = fluidSourceKindOf(world.getBlock(nx, y, nz)) !== FLUID.None
      if (!isSource && !neighbour.falling) {
        if (!flowFaces(nx, y, nz).includes(OPPOSITE_FACE[face])) continue
      }
      const candidate = (isSource || neighbour.falling ? 0 : neighbour.level) + 1
      if (candidate > FLUID_MAX_LEVEL) continue
      const better =
        candidate < bestLevel ||
        (candidate === bestLevel && bestKind === FLUID.Lava && neighbour.kind === FLUID.Water)
      if (!better) continue
      bestKind = neighbour.kind
      bestLevel = candidate
    }
    if (bestKind === FLUID.None) return emptyState()
    return { kind: bestKind, level: bestLevel, falling: false }
  }

  /** Ring key of one voxel. Keeps the delay ring duplicate free. */
  const keyOf = (x: number, y: number, z: number): string => `${x},${y},${z}`

  const isLoadedAt = (x: number, z: number): boolean =>
    world.isLoaded(worldToChunk(x), worldToChunk(z))

  /**
   * Water reacts faster than lava (`FLUID_TICKS`). The kind is read from the
   * voxel and its 6 neighbours, so a cell that is about to receive water is
   * already scheduled at the water rate.
   */
  const delayAt = (x: number, y: number, z: number): number => {
    let sawLava = false
    const own = world.fluidStateAt(x, y, z)
    if (own.kind === FLUID.Water) return FLUID_TICKS.water
    if (own.kind === FLUID.Lava) sawLava = true
    for (const dir of FACE_DIRS) {
      const state = world.fluidStateAt(x + dir.x, y + dir.y, z + dir.z)
      if (state.kind === FLUID.Water) return FLUID_TICKS.water
      if (state.kind === FLUID.Lava) sawLava = true
    }
    return sawLava ? FLUID_TICKS.lava : FLUID_TICKS.water
  }

  const bucketOf = (tick: number): number => {
    const count = FLUID_TICKS.buckets
    return ((tick % count) + count) % count
  }

  const schedule = (x: number, y: number, z: number): void => {
    if (!inColumn(y) || !isLoadedAt(x, z)) return
    const key = keyOf(x, y, z)
    if (pendingKeys.has(key)) return
    const delay = Math.min(FLUID_TICKS.maxDelay, Math.max(1, delayAt(x, y, z)))
    buckets[bucketOf(currentTick + delay)].push(x, y, z)
    pendingKeys.add(key)
  }

  /** Contract entry point: the voxel and its 6 neighbours are re-evaluated. */
  const onNeighborChanged = (x: number, y: number, z: number): void => {
    schedule(x, y, z)
    for (const dir of FACE_DIRS) schedule(x + dir.x, y + dir.y, z + dir.z)
  }

  /**
   * Lava that touches water solidifies. Reading only: the block edit is applied
   * by `tick`, which keeps `computeFluidAt` pure.
   */
  const interactionAt = (x: number, y: number, z: number): BlockId | null => {
    if (!inColumn(y)) return null
    if (world.fluidStateAt(x, y, z).kind !== FLUID.Lava) return null
    let water = false
    for (const dir of FACE_DIRS) {
      if (world.fluidStateAt(x + dir.x, y + dir.y, z + dir.z).kind === FLUID.Water) {
        water = true
        break
      }
    }
    if (!water) return null
    const isSource = fluidSourceKindOf(world.getBlock(x, y, z)) === FLUID.Lava
    return isSource ? BLOCK.OBSIDIAN : BLOCK.COBBLESTONE
  }

  const applyInteraction = (x: number, y: number, z: number): boolean => {
    const replacement = interactionAt(x, y, z)
    if (replacement === null) return false
    const before = world.getBlock(x, y, z)
    world.setFluid(x, y, z, FLUID_EMPTY)
    world.setBlock(x, y, z, replacement)
    events?.emit(EVENT.FluidChanged, { x, y, z, packed: FLUID_EMPTY })
    events?.emit(EVENT.BlockChanged, { x, y, z, before, after: replacement })
    onNeighborChanged(x, y, z)
    return true
  }

  const processCell = (x: number, y: number, z: number): void => {
    pendingKeys.delete(keyOf(x, y, z))
    if (!inColumn(y) || !isLoadedAt(x, z)) return
    if (applyInteraction(x, y, z)) return
    const target = computeFluidAt(x, y, z)
    const packed = target.kind === FLUID.None ? FLUID_EMPTY : packFluid(target)
    // A source voxel derives its byte from the block id, so it never writes.
    if (packed === world.getFluid(x, y, z)) return
    world.setFluid(x, y, z, packed)
    events?.emit(EVENT.FluidChanged, { x, y, z, packed })
    onNeighborChanged(x, y, z)
  }

  const tick = (now: Tick, budgetCells: number = PERF.fluidCellsPerTick): number => {
    const budget = Math.max(0, Math.floor(budgetCells))
    currentTick = now
    // Leftovers of the previous tick keep their order and go first.
    const ready = carry
    carry = []
    let from = lastTick + 1
    if (now < from) from = now
    if (now - from + 1 > FLUID_TICKS.buckets) from = now - FLUID_TICKS.buckets + 1
    for (let t = from; t <= now; t++) {
      const bucket = buckets[bucketOf(t)]
      if (bucket.length === 0) continue
      for (let i = 0; i < bucket.length; i++) ready.push(bucket[i])
      bucket.length = 0
    }
    lastTick = now
    let processed = 0
    let cursor = 0
    while (cursor + 2 < ready.length && processed < budget) {
      processCell(ready[cursor], ready[cursor + 1], ready[cursor + 2])
      cursor += 3
      processed++
    }
    if (cursor < ready.length) carry = ready.slice(cursor)
    return processed
  }

  const settle = (
    startTick: Tick = lastTick + 1,
    maxTicks: number = 4096,
    budgetCells: number = PERF.fluidCellsPerTick,
  ): number => {
    let ran = 0
    let at = startTick
    while (pendingKeys.size > 0 && ran < maxTicks) {
      tick(at, budgetCells)
      at++
      ran++
    }
    return ran
  }

  const scheduleAll = (): void => {
    for (const chunk of world.orderedChunks()) {
      const baseX = chunk.cx * CHUNK_X
      const baseZ = chunk.cz * CHUNK_Z
      for (let i = 0; i < chunk.fluids.length; i++) {
        const carries = chunk.fluids[i] !== 0 || fluidKindOf(chunk.blocks[i]) !== FLUID.None
        if (!carries) continue
        onNeighborChanged(baseX + indexX(i), indexY(i), baseZ + indexZ(i))
      }
    }
  }

  return {
    computeFluidAt,
    onNeighborChanged,
    tick,
    interactionAt,
    scheduleAll,
    settle,
    get pending(): number {
      return pendingKeys.size
    },
  }
}

/** `SystemFn` spending one tick of the fluid budget. Registered by sim-a. */
export function fluidCreateSystem(
  engine: FluidEngine,
  budgetCells: number = PERF.fluidCellsPerTick,
): SystemFn {
  return (_world, _dt, tick) => {
    engine.tick(tick, budgetCells)
  }
}

/** Entry for the `fluid` slot of the contract's `SYSTEM_ORDER`. */
export function fluidSystemEntry(
  engine: FluidEngine,
  budgetCells: number = PERF.fluidCellsPerTick,
): SystemEntry {
  return { name: FLUID_SYSTEM_NAME, fn: fluidCreateSystem(engine, budgetCells) }
}
