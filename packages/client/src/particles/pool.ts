/**
 * Fixed-capacity, zero-allocation particle pool.
 *
 * Every buffer is allocated once in the constructor:
 *   - one packed `Float32Array(maxAlive * floatsPerParticle)` whose lanes are
 *     `[x, y, z, age, kind, size]` (see `PARTICLE_LANE`)
 *   - a parallel `Float32Array(maxAlive * 3)` of velocities
 *   - parallel per-slot lifetime / gravity / drag / birth-serial arrays
 *
 * Live particles stay dense in slots `[0, aliveCount)` so the renderer can
 * upload one contiguous range and draw it in a single call. Retiring swaps the
 * last live slot into the freed one; spawning into a full pool overwrites the
 * oldest live particle, so `maxAlive` is never exceeded.
 *
 * Per-tick integration, in this exact order:
 *   `v.y += gravity * dt` then `v *= drag ** dt` then `p += v * dt`
 */
import { PARTICLE_BUDGET, type ParticleId, type ParticleSpawn } from '@voxelcraft/core-types'
import { kindDragPerTick, kindGravityPerTick, particleKind, type ParticleKind } from './kinds'

/** Lane offsets inside the packed buffer. */
export const PARTICLE_LANE = { x: 0, y: 1, z: 2, age: 3, kind: 4, size: 5 } as const

const FLOATS = PARTICLE_BUDGET.floatsPerParticle
const CAPACITY = PARTICLE_BUDGET.maxAlive
const MAX_SPAWN_PER_TICK = PARTICLE_BUDGET.maxSpawnPerTick
const DEFAULT_SEED = 0x9e3779b9

export interface ParticlePoolOptions {
	/** Seed for the deterministic spread PRNG. Same seed, same particles. */
	readonly seed?: number
}

export class ParticlePool {
	readonly capacity = CAPACITY
	readonly floatsPerParticle = FLOATS

	private readonly buffer = new Float32Array(CAPACITY * FLOATS)
	private readonly velocity = new Float32Array(CAPACITY * 3)
	private readonly lifetime = new Float32Array(CAPACITY)
	private readonly gravity = new Float32Array(CAPACITY)
	private readonly drag = new Float32Array(CAPACITY)
	private readonly birth = new Float64Array(CAPACITY)

	private live = 0
	private serial = 0
	private spawnedThisTick = 0
	private rngState: number

	constructor(options: ParticlePoolOptions = {}) {
		this.rngState = (options.seed ?? DEFAULT_SEED) >>> 0 || DEFAULT_SEED
	}

	get aliveCount(): number {
		return this.live
	}

	/** The packed lane buffer. The same object for the pool's whole lifetime. */
	get data(): Float32Array {
		return this.buffer
	}

	/** Interleaved xyz velocities. Also never reallocated. */
	get velocities(): Float32Array {
		return this.velocity
	}

	/** Particles still spawnable this tick, reset by `update()`. */
	get spawnBudgetRemaining(): number {
		return Math.max(0, MAX_SPAWN_PER_TICK - this.spawnedThisTick)
	}

	/**
	 * Spawn up to `request.count` particles and return how many were admitted.
	 * The per-tick budget (`maxSpawnPerTick`) is shared by every call between
	 * two `update()` calls.
	 */
	spawn(request: ParticleSpawn): number {
		const wanted = Math.max(0, Math.floor(request.count))
		const allowed = Math.min(wanted, this.spawnBudgetRemaining)
		if (allowed === 0) return 0
		const kind = particleKind(request.kind)
		const spread = Math.max(0, request.spread)
		for (let n = 0; n < allowed; n++) {
			const slot = this.live < CAPACITY ? this.live++ : this.oldestSlot()
			this.writeSlot(slot, kind, request, spread)
		}
		this.spawnedThisTick += allowed
		return allowed
	}

	/** Age every particle, retire the expired ones, integrate the rest. */
	update(dtTicks = 1): void {
		this.spawnedThisTick = 0
		if (!(dtTicks > 0)) return
		const lanes = this.buffer
		const vel = this.velocity
		for (let i = 0; i < this.live;) {
			const base = i * FLOATS
			const age = lanes[base + PARTICLE_LANE.age] + dtTicks
			if (age >= this.lifetime[i]) {
				this.retire(i)
				continue
			}
			lanes[base + PARTICLE_LANE.age] = age
			const v = i * 3
			const dragFactor = Math.pow(this.drag[i], dtTicks)
			vel[v] = vel[v] * dragFactor
			vel[v + 1] = (vel[v + 1] + this.gravity[i] * dtTicks) * dragFactor
			vel[v + 2] = vel[v + 2] * dragFactor
			lanes[base + PARTICLE_LANE.x] += vel[v] * dtTicks
			lanes[base + PARTICLE_LANE.y] += vel[v + 1] * dtTicks
			lanes[base + PARTICLE_LANE.z] += vel[v + 2] * dtTicks
			i++
		}
	}

	/** Retire everything without touching any allocation. */
	clear(): void {
		this.buffer.fill(0)
		this.velocity.fill(0)
		this.live = 0
		this.spawnedThisTick = 0
	}

	posX(index: number): number {
		return this.buffer[index * FLOATS + PARTICLE_LANE.x]
	}

	posY(index: number): number {
		return this.buffer[index * FLOATS + PARTICLE_LANE.y]
	}

	posZ(index: number): number {
		return this.buffer[index * FLOATS + PARTICLE_LANE.z]
	}

	ageAt(index: number): number {
		return this.buffer[index * FLOATS + PARTICLE_LANE.age]
	}

	kindAt(index: number): ParticleId {
		return this.buffer[index * FLOATS + PARTICLE_LANE.kind] as ParticleId
	}

	sizeAt(index: number): number {
		return this.buffer[index * FLOATS + PARTICLE_LANE.size]
	}

	lifetimeAt(index: number): number {
		return this.lifetime[index]
	}

	/** Monotonic birth serial, used for oldest-first eviction. */
	serialAt(index: number): number {
		return this.birth[index]
	}

	velX(index: number): number {
		return this.velocity[index * 3]
	}

	velY(index: number): number {
		return this.velocity[index * 3 + 1]
	}

	velZ(index: number): number {
		return this.velocity[index * 3 + 2]
	}

	/** Index of the oldest live particle, i.e. the lowest birth serial. */
	private oldestSlot(): number {
		let oldest = 0
		let lowest = this.birth[0]
		for (let i = 1; i < this.live; i++) {
			if (this.birth[i] < lowest) {
				lowest = this.birth[i]
				oldest = i
			}
		}
		return oldest
	}

	private writeSlot(
		slot: number,
		kind: ParticleKind,
		request: ParticleSpawn,
		spread: number,
	): void {
		const base = slot * FLOATS
		const lanes = this.buffer
		lanes[base + PARTICLE_LANE.x] = request.x
		lanes[base + PARTICLE_LANE.y] = request.y
		lanes[base + PARTICLE_LANE.z] = request.z
		lanes[base + PARTICLE_LANE.age] = 0
		lanes[base + PARTICLE_LANE.kind] = kind.id
		lanes[base + PARTICLE_LANE.size] = kind.size
		const v = slot * 3
		this.velocity[v] = this.nextSpread(spread)
		this.velocity[v + 1] = this.nextSpread(spread)
		this.velocity[v + 2] = this.nextSpread(spread)
		this.lifetime[slot] = kind.lifetimeTicks
		this.gravity[slot] = kindGravityPerTick(kind)
		this.drag[slot] = kindDragPerTick(kind)
		this.birth[slot] = this.serial++
	}

	private retire(index: number): void {
		const last = --this.live
		if (index !== last) this.copySlot(last, index)
		this.blankSlot(last)
	}

	private copySlot(from: number, to: number): void {
		const src = from * FLOATS
		const dst = to * FLOATS
		for (let lane = 0; lane < FLOATS; lane++) this.buffer[dst + lane] = this.buffer[src + lane]
		const vSrc = from * 3
		const vDst = to * 3
		for (let axis = 0; axis < 3; axis++) this.velocity[vDst + axis] = this.velocity[vSrc + axis]
		this.lifetime[to] = this.lifetime[from]
		this.gravity[to] = this.gravity[from]
		this.drag[to] = this.drag[from]
		this.birth[to] = this.birth[from]
	}

	/** Zero a vacated slot so stale lanes are never uploaded or read back. */
	private blankSlot(slot: number): void {
		const base = slot * FLOATS
		for (let lane = 0; lane < FLOATS; lane++) this.buffer[base + lane] = 0
		const v = slot * 3
		this.velocity[v] = 0
		this.velocity[v + 1] = 0
		this.velocity[v + 2] = 0
		this.lifetime[slot] = 0
		this.gravity[slot] = 0
		this.drag[slot] = 0
		this.birth[slot] = 0
	}

	/** xorshift32. Deterministic, allocation free, good enough for spread. */
	private nextUint(): number {
		let x = this.rngState
		x ^= x << 13
		x ^= x >>> 17
		x ^= x << 5
		this.rngState = x >>> 0
		return this.rngState
	}

	/** Uniform in `[-1, 1)`. */
	private nextSigned(): number {
		return (this.nextUint() / 0x100000000) * 2 - 1
	}

	/** One spread component. The `+ 0` keeps a zero spread at `+0`, never `-0`. */
	private nextSpread(spread: number): number {
		return this.nextSigned() * spread + 0
	}
}
