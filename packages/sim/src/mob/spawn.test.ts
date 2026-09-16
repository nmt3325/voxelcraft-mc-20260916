import { describe, expect, it } from 'vitest'
import { BLOCK, COMBAT, MOB, MOB_SPAWN, PERF, PHYSICS } from '@voxelcraft/core-types'
import type { EcsWorld } from '@voxelcraft/core-types'
import { Despawn, PlayerTag, Transform, createEcsWorld, spawnLivingEntity } from '../ecs'
import { createSimVoxelWorld } from '../shared'
import { MobTag } from './components'
import { mobBindContext } from './context'
import { mobDespawnSystem } from './despawn'
import { mobCanSpawnAt, mobCountPopulation, mobSpawnMob, mobSpawnSystem } from './spawn'
import { mobDistance } from './targets'

const DT = 1 / PERF.simTickHz
const FLOOR_Y = 63
const STAND_Y = 64
// Loaded strip: chunks x -7..7 and z 0..2, i.e. blocks x -112..127, z 0..47.
// Anything sampled outside stays unloaded, which is exactly what the spawn
// rules must reject.
const CX_MIN = -7
const CX_MAX = 7
const CZ_MIN = 0
const CZ_MAX = 2

function makeSpawnWorld(seed: number) {
	const voxels = createSimVoxelWorld()
	for (let cx = CX_MIN; cx <= CX_MAX; cx++) {
		for (let cz = CZ_MIN; cz <= CZ_MAX; cz++) voxels.ensureChunk(cx, cz)
	}
	for (let x = CX_MIN * 16; x < (CX_MAX + 1) * 16; x++) {
		for (let z = CZ_MIN * 16; z < (CZ_MAX + 1) * 16; z++) {
			voxels.setBlock(x, FLOOR_Y, z, BLOCK.STONE)
		}
	}
	const world = createEcsWorld()
	const player = spawnLivingEntity(world, {
		x: 0.5,
		y: STAND_Y,
		z: 0.5,
		width: PHYSICS.playerWidth,
		height: PHYSICS.playerHeight,
		maxHealth: COMBAT.playerMaxHealth,
	})
	world.add(player, PlayerTag, { name: 'tester' })
	world.flush()
	const ctx = mobBindContext(world, { voxels, seed })
	return { voxels, world, player, ctx }
}

function runSpawnTicks(world: EcsWorld, ticks: number): void {
	for (let tick = 1; tick <= ticks; tick++) {
		mobSpawnSystem(world, DT, tick)
		world.flush()
	}
}

function snapshot(world: EcsWorld): string {
	return world
		.query([MobTag, Transform])
		.map((entity) => {
			const tag = world.get(entity, MobTag)!
			const transform = world.get(entity, Transform)!
			return `${tag.type}@${transform.x},${transform.y},${transform.z}`
		})
		.join('|')
}

describe('mobCanSpawnAt', () => {
	it('keeps hostiles in the dark and lets passives spawn in the light', () => {
		const { voxels } = makeSpawnWorld(1)
		expect(mobCanSpawnAt(voxels, MOB.Zombie, 40, STAND_Y, 8)).toBe(true)
		voxels.setBlockLightAt(40, STAND_Y, 8, 5)
		expect(mobCanSpawnAt(voxels, MOB.Zombie, 40, STAND_Y, 8)).toBe(false)
		expect(mobCanSpawnAt(voxels, MOB.Pig, 40, STAND_Y, 8)).toBe(true)
	})

	it('needs solid ground, free space and a loaded chunk', () => {
		const { voxels } = makeSpawnWorld(1)
		// Nothing to stand on five blocks up.
		expect(mobCanSpawnAt(voxels, MOB.Pig, 40, STAND_Y + 5, 8)).toBe(false)
		// Head room taken by a block.
		voxels.setBlock(41, STAND_Y, 8, BLOCK.STONE)
		expect(mobCanSpawnAt(voxels, MOB.Pig, 41, STAND_Y, 8)).toBe(false)
		// Outside the loaded strip.
		expect(voxels.isLoaded(40, 0)).toBe(false)
		expect(mobCanSpawnAt(voxels, MOB.Pig, 640, STAND_Y, 8)).toBe(false)
	})
})

describe('mobSpawnSystem', () => {
	it('is deterministic for a given seed', () => {
		const first = makeSpawnWorld(20260916)
		const second = makeSpawnWorld(20260916)
		runSpawnTicks(first.world, 30)
		runSpawnTicks(second.world, 30)
		const recorded = snapshot(first.world)
		expect(recorded.length).toBeGreaterThan(0)
		expect(recorded).toBe(snapshot(second.world))
	})

	it('spawns only inside the MOB_SPAWN distance band', () => {
		const { world, player } = makeSpawnWorld(99)
		runSpawnTicks(world, 30)
		const at = world.get(player, Transform)!
		const mobs = world.query([MobTag, Transform])
		expect(mobs.length).toBeGreaterThan(0)
		for (const entity of mobs) {
			const transform = world.get(entity, Transform)!
			const dist = mobDistance(at.x, at.y, at.z, transform.x, transform.y, transform.z)
			expect(dist).toBeGreaterThanOrEqual(MOB_SPAWN.minDistance)
			expect(dist).toBeLessThanOrEqual(MOB_SPAWN.maxDistance)
		}
	})

	it('never exceeds the hostile or passive cap', () => {
		const { world, ctx } = makeSpawnWorld(7)
		for (let i = 0; i < MOB_SPAWN.mobCapHostile; i++) {
			mobSpawnMob(world, ctx, MOB.Zombie, { x: 40.5, y: STAND_Y, z: 8.5 + i * 0.01 }, 0)
		}
		world.flush()
		expect(mobCountPopulation(world).hostile).toBe(MOB_SPAWN.mobCapHostile)
		for (let tick = 1; tick <= 20; tick++) {
			mobSpawnSystem(world, DT, tick)
			world.flush()
			const population = mobCountPopulation(world)
			expect(population.hostile).toBeLessThanOrEqual(MOB_SPAWN.mobCapHostile)
			expect(population.passive).toBeLessThanOrEqual(MOB_SPAWN.mobCapPassive)
		}
	})

	it('does nothing while spawning is disabled', () => {
		const { world, voxels } = makeSpawnWorld(3)
		mobBindContext(world, { voxels, seed: 3, spawningEnabled: false })
		runSpawnTicks(world, 10)
		expect(world.query([MobTag]).length).toBe(0)
	})
})

describe('mobDespawnSystem', () => {
	it('removes mobs past the despawn distance and keeps the close ones', () => {
		const { world, ctx } = makeSpawnWorld(5)
		const near = mobSpawnMob(world, ctx, MOB.Zombie, { x: 40.5, y: STAND_Y, z: 8.5 }, 0)
		const far = mobSpawnMob(world, ctx, MOB.Zombie, { x: 41.5, y: STAND_Y, z: 8.5 }, 0)
		world.flush()
		world.get(far, Transform)!.x = MOB_SPAWN.despawnDistance + 10
		mobDespawnSystem(world, DT, 1)
		world.flush()
		expect(world.get(far, Despawn)?.reason).toBe('distance')
		// Marked on one tick, gone on the next: structural changes are buffered.
		mobDespawnSystem(world, DT, 2)
		world.flush()
		expect(world.alive(far)).toBe(false)
		expect(world.alive(near)).toBe(true)
	})
})
