/**
 * Sky and block light propagation (`light` subtree, owner sim-b).
 *
 * - One byte per voxel, `(sky << 4) | block`, only ever touched through the
 *   contract helpers `getSkyLight` / `setSkyLight` / `getBlockLight` /
 *   `setBlockLight` (via `SimVoxelWorld`).
 * - BFS over the 6 face neighbours. Entering a voxel costs `1 + opacity`, plus
 *   `skyFilter` on the sky channel, and sky light `MAX_LIGHT` falls straight
 *   down through `skyPassThrough` voxels without attenuation.
 * - A block change runs removal propagation first and re-propagation after, so
 *   an incremental update ends up identical to a full recompute.
 * - Sky light is seeded from the column top (the `skyPassThrough` scan that also
 *   defines `ChunkData.heightmap`). A voxel below its column top can never hold
 *   `MAX_LIGHT`, which is why clearing the column is enough to invalidate a
 *   freshly shadowed region.
 * - `stitchBoundaries(passes = 2)` carries light across chunk borders. The
 *   second pass is the convergence check diagonal (corner) paths need; passes
 *   are idempotent once converged.
 * - `step(budgetOps)` performs at most `budgetOps` light writes and resumes mid
 *   voxel, so one tick never exceeds `PERF.lightOpsPerTick`.
 * - Every constant comes from `@voxelcraft/core-types`; nothing here is random,
 *   time dependent or iteration-order dependent.
 */
import {
  CHUNK_AREA,
  CHUNK_X,
  CHUNK_Y,
  CHUNK_Z,
  EVENT,
  FACE,
  FACE_DIRS,
  MAX_LIGHT,
  PERF,
  SECTIONS_PER_CHUNK,
  SECTION_Y,
  blockIndex,
  chunkKey,
  indexX,
  indexY,
  indexZ,
  lightKey,
  setBlockLight,
  setSkyLight,
  worldToChunk,
  worldToLocal,
} from '@voxelcraft/core-types'
import type {
  BlockId,
  EventBus,
  LightEngine,
  LightProps,
  SystemEntry,
  SystemFn,
} from '@voxelcraft/core-types'
import { lightPropsOf } from '../shared/blockProps'
import type { SimVoxelWorld } from '../shared/voxelWorld'

/** Name of this system inside the contract's `SYSTEM_ORDER`. */
export const LIGHT_SYSTEM_NAME = 'light'

const ADD_STRIDE = 4
const REMOVE_STRIDE = 5
const ALL_SECTIONS = (1 << SECTIONS_PER_CHUNK) - 1

/** Flat FIFO of fixed size records. `head` is the read cursor. */
interface FlatQueue {
  data: number[]
  head: number
  readonly stride: number
}

const createQueue = (stride: number): FlatQueue => ({ data: [], head: 0, stride })

const queueCount = (queue: FlatQueue): number => (queue.data.length - queue.head) / queue.stride

const recycle = (queue: FlatQueue): void => {
  if (queue.head >= queue.data.length) {
    queue.data.length = 0
    queue.head = 0
  }
}

interface Channel {
  readonly sky: boolean
  readonly add: FlatQueue
  readonly remove: FlatQueue
  get(x: number, y: number, z: number): number
  set(x: number, y: number, z: number, value: number): void
  /** Light the voxel produces on its own: emission, or direct sky. */
  source(x: number, y: number, z: number): number
}

export interface LightSample {
  sky: number
  block: number
}

export interface LightEngineOptions {
  world: SimVoxelWorld
  /** Optional bus. `EVENT.LightUpdated` is emitted from `drainDirtySections`. */
  events?: EventBus
  /** Optional optics override. Defaults to the shared `lightPropsOf`. */
  propsOf?: (id: BlockId) => LightProps
}

export interface LightEngineInstance extends LightEngine {
  /** Queued BFS records over both channels (removal + re-propagation). */
  readonly pending: number
  /** Repeats `step` until the queues are empty. Returns the writes performed. */
  drain(maxOps?: number): number
  sample(x: number, y: number, z: number): LightSample
  /** `seedChunk` for every loaded chunk, then `stitchBoundaries(passes)`. */
  seedAll(passes?: number): void
}

export function lightCreateEngine(options: LightEngineOptions): LightEngineInstance {
  const world = options.world
  const events = options.events
  const propsOf = options.propsOf ?? lightPropsOf
  const dirty = new Map<string, { cx: number; cz: number; mask: number }>()
  let confined = false
  let confineCx = 0
  let confineCz = 0

  /** Light is only ever written inside loaded chunks. */
  const writable = (x: number, y: number, z: number): boolean => {
    if (y < 0 || y >= CHUNK_Y) return false
    const cx = worldToChunk(x)
    const cz = worldToChunk(z)
    if (confined && (cx !== confineCx || cz !== confineCz)) return false
    return world.getChunk(cx, cz) !== undefined
  }

  const markDirty = (x: number, y: number, z: number): void => {
    const cx = worldToChunk(x)
    const cz = worldToChunk(z)
    const bit = 1 << ((y / SECTION_Y) | 0)
    const key = chunkKey(cx, cz)
    const entry = dirty.get(key)
    if (entry) entry.mask |= bit
    else dirty.set(key, { cx, cz, mask: bit })
  }

  /** First y above the highest sky blocking voxel of the column. */
  const columnTop = (x: number, z: number): number => {
    const chunk = world.getChunk(worldToChunk(x), worldToChunk(z))
    if (!chunk) return 0
    const lx = worldToLocal(x)
    const lz = worldToLocal(z)
    let y = CHUNK_Y - 1
    while (y >= 0 && propsOf(chunk.blocks[blockIndex(lx, y, lz)]).skyPassThrough) y--
    return y + 1
  }

  const skyChannel: Channel = {
    sky: true,
    add: createQueue(ADD_STRIDE),
    remove: createQueue(REMOVE_STRIDE),
    get: (x, y, z) => world.getSkyLightAt(x, y, z),
    set: (x, y, z, value) => world.setSkyLightAt(x, y, z, value),
    source: (x, y, z) => (y >= columnTop(x, z) ? MAX_LIGHT : 0),
  }

  const blockChannel: Channel = {
    sky: false,
    add: createQueue(ADD_STRIDE),
    remove: createQueue(REMOVE_STRIDE),
    get: (x, y, z) => world.getBlockLightAt(x, y, z),
    set: (x, y, z, value) => world.setBlockLightAt(x, y, z, value),
    source: (x, y, z) => propsOf(world.getBlock(x, y, z)).emission,
  }

  const pushAdd = (channel: Channel, x: number, y: number, z: number): void => {
    channel.add.data.push(x, y, z, 0)
  }

  const pushRemove = (channel: Channel, x: number, y: number, z: number, level: number): void => {
    channel.remove.data.push(x, y, z, level, 0)
  }

  const write = (channel: Channel, x: number, y: number, z: number, value: number): void => {
    channel.set(x, y, z, value)
    markDirty(x, y, z)
  }

  /** Level a neighbour receives across `face`, or <= 0 when nothing arrives. */
  const attenuate = (level: number, target: LightProps, sky: boolean, face: number): number => {
    if (sky && level === MAX_LIGHT && face === FACE.NegY && target.skyPassThrough) {
      return MAX_LIGHT
    }
    return level - 1 - target.opacity - (sky ? target.skyFilter : 0)
  }

  /** Re-propagation pass. Returns the running write count. */
  const runAdd = (channel: Channel, budget: number, startOps: number): number => {
    const queue = channel.add
    let ops = startOps
    while (queue.head < queue.data.length) {
      if (ops >= budget) break
      const x = queue.data[queue.head]
      const y = queue.data[queue.head + 1]
      const z = queue.data[queue.head + 2]
      let face = queue.data[queue.head + 3]
      const level = channel.get(x, y, z)
      if (level <= 0) {
        queue.head += ADD_STRIDE
        recycle(queue)
        continue
      }
      let suspended = false
      for (; face < 6; face++) {
        if (ops >= budget) {
          suspended = true
          break
        }
        const dir = FACE_DIRS[face]
        const nx = x + dir.x
        const ny = y + dir.y
        const nz = z + dir.z
        if (!writable(nx, ny, nz)) continue
        const next = attenuate(level, propsOf(world.getBlock(nx, ny, nz)), channel.sky, face)
        if (next <= 0) continue
        if (channel.get(nx, ny, nz) >= next) continue
        write(channel, nx, ny, nz, next)
        ops++
        pushAdd(channel, nx, ny, nz)
      }
      if (suspended) {
        // Resume this voxel at the same face on the next step.
        queue.data[queue.head + 3] = face
        break
      }
      queue.head += ADD_STRIDE
      recycle(queue)
    }
    return ops
  }

  /**
   * Removal pass. A neighbour dimmer than the level that used to be here was
   * lit by this voxel, so it is cleared back to its own source level and the
   * removal continues. A neighbour at least as bright survives and is queued
   * for re-propagation, which is what heals the hole.
   */
  const runRemove = (channel: Channel, budget: number, startOps: number): number => {
    const queue = channel.remove
    let ops = startOps
    while (queue.head < queue.data.length) {
      if (ops >= budget) break
      const x = queue.data[queue.head]
      const y = queue.data[queue.head + 1]
      const z = queue.data[queue.head + 2]
      const level = queue.data[queue.head + 3]
      let face = queue.data[queue.head + 4]
      let suspended = false
      for (; face < 6; face++) {
        if (ops >= budget) {
          suspended = true
          break
        }
        const dir = FACE_DIRS[face]
        const nx = x + dir.x
        const ny = y + dir.y
        const nz = z + dir.z
        if (!writable(nx, ny, nz)) continue
        const current = channel.get(nx, ny, nz)
        if (current === 0) continue
        if (current < level) {
          const own = channel.source(nx, ny, nz)
          write(channel, nx, ny, nz, own)
          ops++
          pushRemove(channel, nx, ny, nz, current)
          if (own > 0) pushAdd(channel, nx, ny, nz)
        } else {
          pushAdd(channel, nx, ny, nz)
        }
      }
      if (suspended) {
        queue.data[queue.head + 4] = face
        break
      }
      queue.head += REMOVE_STRIDE
      recycle(queue)
    }
    return ops
  }

  const pendingCount = (): number =>
    queueCount(skyChannel.remove) +
    queueCount(blockChannel.remove) +
    queueCount(skyChannel.add) +
    queueCount(blockChannel.add)

  /** Removals run before additions so a stale value is never re-spread. */
  const step = (budgetOps: number): number => {
    const budget = Math.max(0, Math.floor(budgetOps))
    if (budget === 0) return 0
    let ops = runRemove(skyChannel, budget, 0)
    ops = runRemove(blockChannel, budget, ops)
    ops = runAdd(skyChannel, budget, ops)
    ops = runAdd(blockChannel, budget, ops)
    return ops
  }

  const drain = (maxOps: number = Number.MAX_SAFE_INTEGER): number => {
    let total = 0
    for (;;) {
      const remaining = maxOps - total
      if (remaining <= 0) break
      const did = step(Math.min(PERF.lightOpsPerTick, remaining))
      total += did
      // A step that writes nothing has consumed every queued record.
      if (did === 0) break
    }
    return total
  }

  /**
   * Full recompute of one freshly generated chunk. Propagation is confined to
   * the chunk, the neighbour seams are handled by `stitchBoundaries`.
   */
  const seedChunk = (cx: number, cz: number): void => {
    const chunk = world.getChunk(cx, cz)
    if (!chunk) return
    chunk.light.fill(0)
    const tops = new Uint16Array(CHUNK_AREA)
    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        let y = CHUNK_Y - 1
        while (y >= 0 && propsOf(chunk.blocks[blockIndex(lx, y, lz)]).skyPassThrough) y--
        tops[(lz << 4) | lx] = y + 1
      }
    }
    const baseX = cx * CHUNK_X
    const baseZ = cz * CHUNK_Z
    confined = true
    confineCx = cx
    confineCz = cz
    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        const top = tops[(lz << 4) | lx]
        const edge = lx === 0 || lx === CHUNK_X - 1 || lz === 0 || lz === CHUNK_Z - 1
        for (let y = CHUNK_Y - 1; y >= top; y--) {
          setSkyLight(chunk.light, blockIndex(lx, y, lz), MAX_LIGHT)
          // A direct sky voxel surrounded by direct sky voxels cannot light
          // anything new, so only the spreading frontier is queued.
          const spreads =
            edge ||
            y === top ||
            tops[(lz << 4) | (lx - 1)] > y ||
            tops[(lz << 4) | (lx + 1)] > y ||
            tops[((lz - 1) << 4) | lx] > y ||
            tops[((lz + 1) << 4) | lx] > y
          if (spreads) pushAdd(skyChannel, baseX + lx, y, baseZ + lz)
        }
      }
    }
    for (let i = 0; i < chunk.blocks.length; i++) {
      const emission = propsOf(chunk.blocks[i]).emission
      if (emission <= 0) continue
      setBlockLight(chunk.light, i, emission)
      pushAdd(blockChannel, baseX + indexX(i), indexY(i), baseZ + indexZ(i))
    }
    drain()
    confined = false
    chunk.lit = true
    const key = chunkKey(cx, cz)
    const entry = dirty.get(key)
    if (entry) entry.mask |= ALL_SECTIONS
    else dirty.set(key, { cx, cz, mask: ALL_SECTIONS })
  }

  /**
   * True when a border voxel could still push light into a neighbouring
   * chunk. Horizontal attenuation always costs at least one level, so a
   * neighbour that is already as bright can never receive anything from it.
   * Skipping those makes a stitch pass proportional to the seams that carry a
   * gradient instead of to every border voxel of every loaded chunk.
   */
  const crossesSeam = (
    channel: typeof skyChannel,
    level: number,
    x: number,
    y: number,
    z: number,
    lx: number,
    lz: number,
  ): boolean => {
    const lower = (nx: number, ny: number, nz: number): boolean =>
      writable(nx, ny, nz) && channel.get(nx, ny, nz) < level
    if (lx === 0 && lower(x - 1, y, z)) return true
    if (lx === CHUNK_X - 1 && lower(x + 1, y, z)) return true
    if (lz === 0 && lower(x, y, z - 1)) return true
    if (lz === CHUNK_Z - 1 && lower(x, y, z + 1)) return true
    return false
  }

  /**
   * Carries light across chunk seams. Each pass re-queues every border voxel of
   * every loaded chunk and drains globally; two passes are enough because the
   * first pass moves light one chunk outwards and the second one closes the
   * diagonal (corner to corner) paths. Extra passes are no-ops.
   */
  const stitchBoundaries = (passes: number = 2): void => {
    const total = Math.max(1, Math.floor(passes))
    for (let pass = 0; pass < total; pass++) {
      for (const chunk of world.orderedChunks()) {
        const baseX = chunk.cx * CHUNK_X
        const baseZ = chunk.cz * CHUNK_Z
        for (let lz = 0; lz < CHUNK_Z; lz++) {
          for (let lx = 0; lx < CHUNK_X; lx++) {
            const border = lx === 0 || lx === CHUNK_X - 1 || lz === 0 || lz === CHUNK_Z - 1
            if (!border) continue
            const x = baseX + lx
            const z = baseZ + lz
            for (let y = 0; y < CHUNK_Y; y++) {
              const packed = chunk.light[blockIndex(lx, y, lz)]
              if (packed === 0) continue
              const sky = packed >>> 4
              const block = packed & 0x0f
              if (sky > 0 && crossesSeam(skyChannel, sky, x, y, z, lx, lz)) {
                pushAdd(skyChannel, x, y, z)
              }
              if (block > 0 && crossesSeam(blockChannel, block, x, y, z, lx, lz)) {
                pushAdd(blockChannel, x, y, z)
              }
            }
          }
        }
      }
      drain()
    }
  }

  /**
   * Differential update for one block edit. Call it after the world write; the
   * queues are consumed by `step` (or `drain`).
   */
  const onBlockChanged = (
    x: number,
    y: number,
    z: number,
    before: LightProps,
    after: LightProps,
  ): void => {
    if (!writable(x, y, z)) return
    // Fluid level edits and other optics-neutral changes cannot move light.
    if (lightKey(before) === lightKey(after)) return

    const previous = blockChannel.get(x, y, z)
    if (previous > 0) {
      write(blockChannel, x, y, z, 0)
      pushRemove(blockChannel, x, y, z, previous)
    }
    if (after.emission > 0) {
      write(blockChannel, x, y, z, after.emission)
      pushAdd(blockChannel, x, y, z)
    }

    // Sky: refresh the whole column. Voxels below the column top can only be
    // lit indirectly, so a stale MAX_LIGHT there is exactly the shadow to clear.
    const top = columnTop(x, z)
    for (let cy = CHUNK_Y - 1; cy >= 0; cy--) {
      const current = skyChannel.get(x, cy, z)
      if (cy >= top) {
        if (current < MAX_LIGHT) {
          write(skyChannel, x, cy, z, MAX_LIGHT)
          pushAdd(skyChannel, x, cy, z)
        }
      } else if (current === MAX_LIGHT) {
        write(skyChannel, x, cy, z, 0)
        pushRemove(skyChannel, x, cy, z, MAX_LIGHT)
      }
    }
    const darker =
      after.opacity + after.skyFilter > before.opacity + before.skyFilter ||
      (before.skyPassThrough && !after.skyPassThrough)
    const ownSky = skyChannel.get(x, y, z)
    if (darker && ownSky > 0 && ownSky < MAX_LIGHT) {
      write(skyChannel, x, y, z, 0)
      pushRemove(skyChannel, x, y, z, ownSky)
    }

    // Surviving neighbours heal whatever the removals over-cleared.
    for (const dir of FACE_DIRS) {
      pushAdd(skyChannel, x + dir.x, y + dir.y, z + dir.z)
      pushAdd(blockChannel, x + dir.x, y + dir.y, z + dir.z)
    }
    pushAdd(skyChannel, x, y, z)
    pushAdd(blockChannel, x, y, z)
  }

  /**
   * Drains the accumulated (cx, cz, sectionMask) triples into `out`, ordered by
   * chunk. `chunk.dirtySections` is owned by the scheduler, so consumers should
   * OR these masks into their own re-mesh bookkeeping.
   */
  const drainDirtySections = (out: Int32Array): number => {
    const capacity = (out.length / 3) | 0
    if (capacity === 0) return 0
    const entries = [...dirty.values()].sort((a, b) => (a.cx === b.cx ? a.cz - b.cz : a.cx - b.cx))
    let count = 0
    for (const entry of entries) {
      if (count >= capacity) break
      out[count * 3] = entry.cx
      out[count * 3 + 1] = entry.cz
      out[count * 3 + 2] = entry.mask
      dirty.delete(chunkKey(entry.cx, entry.cz))
      events?.emit(EVENT.LightUpdated, {
        cx: entry.cx,
        cz: entry.cz,
        sectionMask: entry.mask,
      })
      count++
    }
    return count
  }

  return {
    seedChunk,
    stitchBoundaries,
    onBlockChanged,
    step,
    drainDirtySections,
    drain,
    get pending(): number {
      return pendingCount()
    },
    sample: (x: number, y: number, z: number): LightSample => ({
      sky: skyChannel.get(x, y, z),
      block: blockChannel.get(x, y, z),
    }),
    seedAll: (passes: number = 2): void => {
      for (const chunk of world.orderedChunks()) seedChunk(chunk.cx, chunk.cz)
      stitchBoundaries(passes)
    },
  }
}

/** `SystemFn` spending one tick of the light budget. Registered by sim-a. */
export function lightCreateSystem(
  engine: LightEngine,
  budgetOps: number = PERF.lightOpsPerTick,
): SystemFn {
  return (_world, _dt, _tick) => {
    engine.step(budgetOps)
  }
}

/** Entry for the `light` slot of the contract's `SYSTEM_ORDER`. */
export function lightSystemEntry(
  engine: LightEngine,
  budgetOps: number = PERF.lightOpsPerTick,
): SystemEntry {
  return { name: LIGHT_SYSTEM_NAME, fn: lightCreateSystem(engine, budgetOps) }
}
