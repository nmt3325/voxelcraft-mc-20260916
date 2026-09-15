import { describe, expect, it } from 'vitest'
import { BLOCK, COMBAT, PERF } from '@voxelcraft/core-types'
import {
	Despawn,
	Health,
	Transform,
	Velocity,
	createEcsWorld,
	spawnLivingEntity,
} from '../ecs'
import { createRecordingEventBus, createSimVoxelWorld } from '../shared'
import { mobBindContext } from '../mob/context'
import { CombatProjectile } from './components'
import { combatArrowVelocity, combatProjectileSystem, combatSpawnArrow } from './projectile'

const DT = 1 / PERF.simTickHz

function setup() {
	const voxels = createSimVoxelWorld()
	const world = createEcsWorld()
	const bus = createRecordingEventBus()
	mobBindContext(world, { voxels, seed: 1, bus, spawningEnabled: false })
	return { voxels, world, bus }
}

function runTicks(world: ReturnType<typeof createEcsWorld>, ticks: number): void {
	for (let tick = 1; tick <= ticks; tick++) {
		combatProjectileSystem(world, DT, tick)
		world.flush()
	}
}

describe('combatArrowVelocity', () => {
	it('is deterministic and compensates for gravity', () => {
		const from = { x: 0, y: 64, z: 0 }
		const to = { x: 10, y: 65, z: 0 }
		const first = combatArrowVelocity(from, to)
		const second = combatArrowVelocity(from, to)
		expect(first).toEqual(second)
		expect(first.x).toBeGreaterThan(0)
		expect(first.z).toBe(0)
		// Aimed above the straight line, otherwise the drop would undershoot.
		expect(first.y).toBeGreaterThan(0)
	})

	it('returns no velocity for a degenerate shot', () => {
		const at = { x: 1, y: 64, z: 1 }
		expect(combatArrowVelocity(at, at)).toEqual({ x: 0, y: 0, z: 0 })
	})
})

describe('combatProjectileSystem', () => {
	it('damages the entity it hits and then expires', () => {
		const { world } = setup()
		const target = spawnLivingEntity(world, {
			x: 5.5,
			y: 64,
			z: 0.5,
			width: 0.6,
			height: 1.8,
			maxHealth: 20,
		})
		const arrow = combatSpawnArrow(world, {
			owner: -1,
			from: { x: 0.5, y: 65, z: 0.5 },
			to: { x: 5.5, y: 65, z: 0.5 },
		})
		world.flush()
		runTicks(world, 10)
		expect(world.get(target, Health)!.current).toBe(20 - COMBAT.arrowDamage)
		expect(world.get(arrow, Despawn)?.reason).toBe('expired')
	})

	it('is stopped by a stone wall', () => {
		const { world, voxels } = setup()
		voxels.ensureChunk(0, 0)
		for (let y = 60; y < 70; y++) voxels.setBlock(3, y, 0, BLOCK.STONE)
		const target = spawnLivingEntity(world, {
			x: 8.5,
			y: 64,
			z: 0.5,
			width: 0.6,
			height: 1.8,
			maxHealth: 20,
		})
		const arrow = combatSpawnArrow(world, {
			owner: -1,
			from: { x: 0.5, y: 65, z: 0.5 },
			to: { x: 8.5, y: 65, z: 0.5 },
		})
		world.flush()
		runTicks(world, 10)
		expect(world.get(target, Health)!.current).toBe(20)
		expect(world.get(arrow, Velocity)!.x).toBe(0)
		expect(world.get(arrow, Transform)!.x).toBeLessThan(4.5)
		expect(world.get(arrow, Despawn)?.reason).toBe('expired')
	})

	it('expires when it runs out of life', () => {
		const { world } = setup()
		const arrow = combatSpawnArrow(world, {
			owner: -1,
			from: { x: 0.5, y: 65, z: 0.5 },
			to: { x: 40.5, y: 65, z: 0.5 },
			lifeTicks: 1,
		})
		world.flush()
		runTicks(world, 2)
		expect(world.get(arrow, CombatProjectile)!.lifeTicks).toBe(0)
		expect(world.get(arrow, Despawn)?.reason).toBe('expired')
	})
})
