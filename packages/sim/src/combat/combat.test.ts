import { describe, expect, it } from 'vitest'
import { COMBAT, EVENT, PERF, PHYSICS } from '@voxelcraft/core-types'
import {
	Despawn,
	Health,
	PhysicsState,
	PlayerTag,
	Velocity,
	createEcsWorld,
	spawnLivingEntity,
} from '../ecs'
import { createRecordingEventBus, createSimVoxelWorld } from '../shared'
import { mobBindContext } from '../mob/context'
import { combatApplyDamage, combatApplyKnockback, combatExplode, combatSystem } from './damage'

const DT = 1 / PERF.simTickHz

function setup() {
	const voxels = createSimVoxelWorld()
	const world = createEcsWorld()
	const bus = createRecordingEventBus()
	mobBindContext(world, { voxels, seed: 1, bus, spawningEnabled: false })
	return { voxels, world, bus }
}

describe('combatApplyDamage', () => {
	it('opens an invulnerability window and closes it again', () => {
		const { world } = setup()
		const victim = spawnLivingEntity(world, { x: 0, y: 64, z: 0, maxHealth: 20 })
		world.flush()
		expect(combatApplyDamage(world, { target: victim, amount: 3, tick: 1 })).toBe(true)
		const health = world.get(victim, Health)!
		expect(health.current).toBe(17)
		expect(health.invulnerableTicks).toBe(COMBAT.invulnerableTicks)

		// A second hit inside the window is refused.
		expect(combatApplyDamage(world, { target: victim, amount: 3, tick: 1 })).toBe(false)
		expect(health.current).toBe(17)

		for (let tick = 1; tick <= COMBAT.invulnerableTicks; tick++) {
			combatSystem(world, DT, tick)
			world.flush()
		}
		expect(health.invulnerableTicks).toBe(0)
		expect(combatApplyDamage(world, { target: victim, amount: 3, tick: 11 })).toBe(true)
		expect(health.current).toBe(14)
	})

	it('ignores the window when the damage bypasses it', () => {
		const { world } = setup()
		const victim = spawnLivingEntity(world, { x: 0, y: 64, z: 0, maxHealth: 20 })
		world.flush()
		combatApplyDamage(world, { target: victim, amount: 1, tick: 1 })
		expect(
			combatApplyDamage(world, {
				target: victim,
				amount: 2,
				tick: 1,
				bypassInvulnerable: true,
			}),
		).toBe(true)
		expect(world.get(victim, Health)!.current).toBe(17)
	})

	it('adds knockback away from the attacker', () => {
		const { world } = setup()
		const victim = spawnLivingEntity(world, { x: 2, y: 64, z: 0, maxHealth: 20 })
		world.flush()
		expect(combatApplyKnockback(world, victim, { x: 0, y: 64, z: 0 })).toBe(true)
		const velocity = world.get(victim, Velocity)!
		expect(velocity.x).toBeCloseTo(PHYSICS.knockbackHorizontal, 6)
		expect(velocity.z).toBeCloseTo(0, 6)
		expect(velocity.y).toBeCloseTo(PHYSICS.knockbackVertical, 6)
	})

	it('marks a killed entity dead and reports it once', () => {
		const { world, bus } = setup()
		const victim = spawnLivingEntity(world, { x: 0, y: 64, z: 0, maxHealth: 20 })
		world.flush()
		combatApplyDamage(world, { target: victim, amount: 100, tick: 5 })
		world.flush()
		expect(world.get(victim, Health)!.current).toBe(0)
		expect(world.get(victim, Despawn)?.reason).toBe('dead')
		expect(bus.recorded.filter((event) => event.name === EVENT.EntityDied)).toHaveLength(1)
		expect(bus.recorded.filter((event) => event.name === EVENT.EntityDamaged)).toHaveLength(1)
		// A corpse cannot be hurt again.
		expect(combatApplyDamage(world, { target: victim, amount: 1, tick: 6 })).toBe(false)
	})
})

describe('combatSystem', () => {
	it('turns pending fall damage into real damage exactly once', () => {
		const { world } = setup()
		const victim = spawnLivingEntity(world, { x: 0, y: 64, z: 0, maxHealth: 20 })
		world.flush()
		const physics = world.get(victim, PhysicsState)!
		physics.pendingFallDamage = 4
		combatSystem(world, DT, 3)
		world.flush()
		expect(physics.pendingFallDamage).toBe(0)
		expect(world.get(victim, Health)!.current).toBe(16)
	})

	it('regenerates players on the regen interval only', () => {
		const { world } = setup()
		const player = spawnLivingEntity(world, {
			x: 0,
			y: 64,
			z: 0,
			maxHealth: COMBAT.playerMaxHealth,
		})
		world.add(player, PlayerTag, { name: 'tester' })
		world.flush()
		const health = world.get(player, Health)!
		health.current = 10
		combatSystem(world, DT, COMBAT.regenIntervalTicks)
		world.flush()
		expect(health.current).toBe(11)
		combatSystem(world, DT, COMBAT.regenIntervalTicks + 1)
		world.flush()
		expect(health.current).toBe(11)
	})
})

describe('combatExplode', () => {
	it('scales damage with the distance and spares anything outside the radius', () => {
		const { world } = setup()
		const near = spawnLivingEntity(world, { x: 1, y: 64, z: 0, maxHealth: 20 })
		const far = spawnLivingEntity(world, { x: 10, y: 64, z: 0, maxHealth: 20 })
		world.flush()
		const hits = combatExplode(world, {
			at: { x: 0, y: 64, z: 0 },
			radius: COMBAT.creeperRadius,
			damage: COMBAT.creeperDamage,
			tick: 1,
		})
		world.flush()
		expect(hits).toBe(1)
		const nearHealth = world.get(near, Health)!
		expect(nearHealth.current).toBeLessThan(20)
		expect(nearHealth.current).toBeGreaterThan(0)
		expect(world.get(far, Health)!.current).toBe(20)
		// Blown away from the blast, not towards it.
		expect(world.get(near, Velocity)!.x).toBeGreaterThan(0)
		expect(world.get(near, Velocity)!.y).toBeCloseTo(PHYSICS.knockbackVertical, 6)
	})
})
