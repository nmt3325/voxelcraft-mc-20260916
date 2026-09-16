import { describe, expect, it } from 'vitest'
import {
	PARTICLE,
	PARTICLE_BUDGET,
	type ParticleId,
	type ParticleSpawn,
} from '@voxelcraft/core-types'
import { PARTICLE_KIND_IDS, PARTICLE_KINDS, kindDragPerTick, particleKind } from '../kinds'
import { PARTICLE_LANE, ParticlePool } from '../pool'
import { ParticleRenderer } from '../renderer'

const { maxAlive, maxSpawnPerTick, floatsPerParticle, defaultLifetimeTicks, gravity, drag } =
	PARTICLE_BUDGET

function req(kind: ParticleId, count: number, spread = 0): ParticleSpawn {
	return { kind, x: 0, y: 64, z: 0, count, spread }
}

/** Fill to capacity with long-lived particles: 8 ticks of the per-tick cap. */
function fill(pool: ParticlePool, kind: ParticleId = PARTICLE.Portal): void {
	while (pool.aliveCount < maxAlive) {
		pool.spawn(req(kind, maxSpawnPerTick, 1))
		pool.update(1)
	}
}

function serials(pool: ParticlePool): number[] {
	const out: number[] = []
	for (let i = 0; i < pool.aliveCount; i++) out.push(pool.serialAt(i))
	return out
}

function countKind(pool: ParticlePool, kind: ParticleId): number {
	let found = 0
	for (let i = 0; i < pool.aliveCount; i++) if (pool.kindAt(i) === kind) found++
	return found
}

describe('particle kinds', () => {
	it('gives all ten kinds a distinct look', () => {
		expect(PARTICLE_KIND_IDS).toHaveLength(10)
		const colors = new Set<number>()
		const names = new Set<string>()
		for (const id of PARTICLE_KIND_IDS) {
			const kind = PARTICLE_KINDS[id]
			expect(kind.id).toBe(id)
			colors.add(kind.color)
			names.add(kind.name)
			expect(kind.size).toBeGreaterThan(0)
			expect(kind.lifetimeTicks).toBeGreaterThan(0)
			expect(kindDragPerTick(kind)).toBeGreaterThan(0)
			expect(kindDragPerTick(kind)).toBeLessThanOrEqual(1)
		}
		expect(colors.size).toBe(10)
		expect(names.size).toBe(10)
		for (const id of Object.values(PARTICLE)) expect(particleKind(id).id).toBe(id)
	})

	it('lets a kind override the default lifetime', () => {
		expect(PARTICLE_KINDS[PARTICLE.BlockBreak].lifetimeTicks).toBe(defaultLifetimeTicks)
		expect(PARTICLE_KINDS[PARTICLE.Crit].lifetimeTicks).not.toBe(defaultLifetimeTicks)
	})
})

describe('particle pool capacity', () => {
	it('never exceeds maxAlive, however hard it is pushed', () => {
		const pool = new ParticlePool({ seed: 1 })
		expect(pool.capacity).toBe(maxAlive)
		for (let tick = 0; tick < 24; tick++) {
			pool.spawn(req(PARTICLE.Portal, maxAlive * 4, 2))
			expect(pool.aliveCount).toBeLessThanOrEqual(maxAlive)
			pool.update(1)
			expect(pool.aliveCount).toBeLessThanOrEqual(maxAlive)
		}
		expect(pool.aliveCount).toBe(maxAlive)
	})

	it('drops the oldest live particles to make room', () => {
		const pool = new ParticlePool({ seed: 2 })
		fill(pool)
		expect(pool.aliveCount).toBe(maxAlive)
		const before = serials(pool)
		const oldest = Math.min(...before)
		const newest = Math.max(...before)

		expect(pool.spawn(req(PARTICLE.Crit, 10))).toBe(10)

		expect(pool.aliveCount).toBe(maxAlive)
		expect(countKind(pool, PARTICLE.Crit)).toBe(10)
		const after = serials(pool)
		expect(Math.min(...after)).toBe(oldest + 10)
		expect(Math.max(...after)).toBe(newest + 10)
		expect(new Set(after).size).toBe(maxAlive)
	})
})

describe('spawn budget', () => {
	it('clamps one burst to maxSpawnPerTick', () => {
		const pool = new ParticlePool({ seed: 3 })
		expect(pool.spawn(req(PARTICLE.Smoke, 10_000, 1))).toBe(maxSpawnPerTick)
		expect(pool.aliveCount).toBe(maxSpawnPerTick)
		expect(pool.spawnBudgetRemaining).toBe(0)
		expect(pool.spawn(req(PARTICLE.Smoke, 1))).toBe(0)
		pool.update(1)
		expect(pool.spawnBudgetRemaining).toBe(maxSpawnPerTick)
		expect(pool.spawn(req(PARTICLE.Smoke, 10))).toBe(10)
	})

	it('shares one tick of budget across calls', () => {
		const pool = new ParticlePool({ seed: 4 })
		expect(pool.spawn(req(PARTICLE.Flame, 200, 1))).toBe(200)
		expect(pool.spawn(req(PARTICLE.Flame, 200, 1))).toBe(maxSpawnPerTick - 200)
		expect(pool.aliveCount).toBe(maxSpawnPerTick)
		expect(pool.spawn(req(PARTICLE.Flame, 0))).toBe(0)
		expect(pool.spawn(req(PARTICLE.Flame, -5))).toBe(0)
	})
})

describe('lifetime retirement', () => {
	it('retires a kind exactly at its own lifetime', () => {
		const pool = new ParticlePool({ seed: 5 })
		const life = PARTICLE_KINDS[PARTICLE.Crit].lifetimeTicks
		expect(pool.spawn(req(PARTICLE.Crit, 4, 1))).toBe(4)
		for (let tick = 1; tick < life; tick++) {
			pool.update(1)
			expect(pool.aliveCount).toBe(4)
		}
		pool.update(1)
		expect(pool.aliveCount).toBe(0)
	})

	it('uses the contract default when a kind does not override it', () => {
		const pool = new ParticlePool({ seed: 6 })
		pool.spawn(req(PARTICLE.BlockBreak, 3, 1))
		expect(pool.lifetimeAt(0)).toBe(defaultLifetimeTicks)
		for (let tick = 1; tick < defaultLifetimeTicks; tick++) pool.update(1)
		expect(pool.aliveCount).toBe(3)
		pool.update(1)
		expect(pool.aliveCount).toBe(0)
	})
})

describe('integration', () => {
	it('applies gravity then drag then motion, once per tick', () => {
		const pool = new ParticlePool({ seed: 7 })
		pool.spawn(req(PARTICLE.BlockBreak, 1))
		expect(pool.velY(0)).toBe(0)
		expect(pool.posY(0)).toBe(64)

		const dragFactor = Math.pow(Math.fround(drag), 1)
		let vy = 0
		let y = 64
		for (let tick = 0; tick < 5; tick++) {
			pool.update(1)
			vy = Math.fround((vy + gravity) * dragFactor)
			y = Math.fround(y + vy)
			expect(pool.velY(0)).toBe(vy)
			expect(pool.posY(0)).toBe(y)
			expect(pool.ageAt(0)).toBe(tick + 1)
		}
		expect(pool.posY(0)).toBeLessThan(64)
	})

	it('damps the horizontal axes by the kind drag', () => {
		const pool = new ParticlePool({ seed: 8 })
		pool.spawn(req(PARTICLE.Splash, 1, 3))
		const vx = pool.velX(0)
		const vz = pool.velZ(0)
		expect(vx).not.toBe(0)
		expect(vz).not.toBe(0)
		const kindDrag = Math.pow(Math.fround(kindDragPerTick(PARTICLE_KINDS[PARTICLE.Splash])), 1)
		pool.update(1)
		expect(pool.velX(0)).toBe(Math.fround(vx * kindDrag))
		expect(pool.velZ(0)).toBe(Math.fround(vz * kindDrag))
		expect(Math.abs(pool.velX(0))).toBeLessThan(Math.abs(vx))
	})

	it('spreads deterministically for a given seed', () => {
		const a = new ParticlePool({ seed: 12_345 })
		const b = new ParticlePool({ seed: 12_345 })
		const c = new ParticlePool({ seed: 999 })
		for (const pool of [a, b, c]) pool.spawn(req(PARTICLE.Flame, 8, 2))
		let differs = false
		for (let i = 0; i < 8; i++) {
			expect(a.velX(i)).toBe(b.velX(i))
			expect(a.velY(i)).toBe(b.velY(i))
			expect(a.velZ(i)).toBe(b.velZ(i))
			if (a.velX(i) !== c.velX(i)) differs = true
		}
		expect(differs).toBe(true)
	})

	it('leaves velocity at zero when spread is zero', () => {
		const pool = new ParticlePool({ seed: 9 })
		pool.spawn(req(PARTICLE.Heart, 16))
		for (let i = 0; i < pool.aliveCount; i++) {
			expect(pool.velX(i)).toBe(0)
			expect(pool.velZ(i)).toBe(0)
		}
	})
})

describe('storage', () => {
	it('never reallocates the backing Float32Array', () => {
		const pool = new ParticlePool({ seed: 10 })
		const lanes = pool.data
		const vel = pool.velocities
		expect(lanes).toBeInstanceOf(Float32Array)
		expect(lanes.length).toBe(maxAlive * floatsPerParticle)
		expect(vel.length).toBe(maxAlive * 3)

		for (let tick = 0; tick < 60; tick++) {
			pool.spawn(req(PARTICLE.Lava, maxSpawnPerTick, 2))
			pool.spawn(req(PARTICLE.Bubble, 64, 1))
			pool.update(1)
		}
		pool.clear()

		expect(pool.data).toBe(lanes)
		expect(pool.velocities).toBe(vel)
		expect(pool.data.buffer).toBe(lanes.buffer)
		expect(pool.data.length).toBe(maxAlive * floatsPerParticle)
		expect(pool.aliveCount).toBe(0)
	})

	it('writes the documented lanes', () => {
		const pool = new ParticlePool({ seed: 11 })
		pool.spawn({ kind: PARTICLE.Redstone, x: 1.5, y: -2.5, z: 3.25, count: 1, spread: 0 })
		const lanes = pool.data
		expect(lanes[PARTICLE_LANE.x]).toBe(1.5)
		expect(lanes[PARTICLE_LANE.y]).toBe(-2.5)
		expect(lanes[PARTICLE_LANE.z]).toBe(3.25)
		expect(lanes[PARTICLE_LANE.age]).toBe(0)
		expect(lanes[PARTICLE_LANE.kind]).toBe(PARTICLE.Redstone)
		expect(pool.kindAt(0)).toBe(PARTICLE.Redstone)
		expect(pool.sizeAt(0)).toBe(Math.fround(PARTICLE_KINDS[PARTICLE.Redstone].size))
		expect(pool.floatsPerParticle).toBe(floatsPerParticle)
	})
})

describe('particle renderer', () => {
	it('draws every live particle in one batch', () => {
		const pool = new ParticlePool({ seed: 12 })
		const renderer = new ParticleRenderer()
		expect(renderer.drawCalls).toBe(0)

		pool.spawn(req(PARTICLE.Flame, 100, 1))
		expect(renderer.sync(pool)).toBe(100)
		expect(renderer.visibleCount).toBe(100)
		expect(renderer.drawCalls).toBe(1)

		const geometry = renderer.points.geometry
		expect(geometry.drawRange.count).toBe(100)
		expect(geometry.getAttribute('position').count).toBe(maxAlive)
		expect(geometry.getAttribute('aColor').count).toBe(maxAlive)

		renderer.dispose()
		expect(renderer.drawCalls).toBe(0)
		expect(renderer.sync(pool)).toBe(0)
		renderer.dispose()
	})
})
