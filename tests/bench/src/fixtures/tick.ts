import { PERF, hash01 } from '@voxelcraft/core-types'

/**
 * Deterministic simulation-tick fixture.
 *
 * packages/sim and packages/gameplay are still stubs, so the bench runs its own
 * entity integration loop (gravity, per-axis collision resolution against the
 * terrain fixture, hash-driven steering). It measures a comparable amount of
 * per-tick work, not the real simulation.
 */
export const FIXTURE_TICK_VERSION = 'bench-tick-1'

export const TICK_DT = PERF.simTickMs / 1000

const GRAVITY = -32
const TERMINAL_VELOCITY = -78
const FRICTION = 0.91
const WALK_SPEED = 4.3
const JUMP_SPEED = 8.4
const STEER_INTERVAL = 20

export type SolidSampler = (x: number, y: number, z: number) => boolean

export interface TickWorld {
  seed: number
  count: number
  tick: number
  px: Float64Array
  py: Float64Array
  pz: Float64Array
  vx: Float64Array
  vy: Float64Array
  vz: Float64Array
  onGround: Uint8Array
  sampleSolid: SolidSampler
}

export function createTickWorld(
  seed: number,
  count: number,
  sampleSolid: SolidSampler,
  spawnHeight: (x: number, z: number) => number,
): TickWorld {
  const world: TickWorld = {
    seed,
    count,
    tick: 0,
    px: new Float64Array(count),
    py: new Float64Array(count),
    pz: new Float64Array(count),
    vx: new Float64Array(count),
    vy: new Float64Array(count),
    vz: new Float64Array(count),
    onGround: new Uint8Array(count),
    sampleSolid,
  }

  for (let i = 0; i < count; i++) {
    const x = (hash01(seed, 1, i, 0, 0) - 0.5) * 96
    const z = (hash01(seed, 2, i, 0, 0) - 0.5) * 96
    world.px[i] = x
    world.pz[i] = z
    world.py[i] = spawnHeight(x, z) + 2
  }

  return world
}

export function stepTickWorld(world: TickWorld, dt: number = TICK_DT): void {
  const { px, py, pz, vx, vy, vz, onGround, sampleSolid, seed } = world
  const tick = world.tick
  const steer = tick % STEER_INTERVAL === 0

  for (let i = 0; i < world.count; i++) {
    if (steer) {
      const dx = hash01(seed, 3, i, tick, 0) * 2 - 1
      const dz = hash01(seed, 4, i, tick, 0) * 2 - 1
      const length = Math.sqrt(dx * dx + dz * dz) || 1
      vx[i] = (dx / length) * WALK_SPEED
      vz[i] = (dz / length) * WALK_SPEED
      if (onGround[i] === 1 && hash01(seed, 5, i, tick, 0) > 0.85) vy[i] = JUMP_SPEED
    }

    vy[i] = Math.max(TERMINAL_VELOCITY, vy[i] + GRAVITY * dt)

    let ny = py[i] + vy[i] * dt
    if (sampleSolid(px[i], ny, pz[i])) {
      ny = Math.floor(ny) + 1
      vy[i] = 0
      onGround[i] = 1
    } else {
      onGround[i] = 0
    }
    py[i] = ny

    const nx = px[i] + vx[i] * dt
    if (sampleSolid(nx, py[i], pz[i])) {
      vx[i] = -vx[i]
    } else {
      px[i] = nx
    }

    const nz = pz[i] + vz[i] * dt
    if (sampleSolid(px[i], py[i], nz)) {
      vz[i] = -vz[i]
    } else {
      pz[i] = nz
    }

    vx[i] *= FRICTION
    vz[i] *= FRICTION
  }

  world.tick = tick + 1
}
