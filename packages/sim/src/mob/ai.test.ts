import { describe, expect, it } from 'vitest'
import {
	AI_STATE,
	BLOCK,
	COMBAT,
	EVENT,
	MOB,
	MOB_SPAWN,
	PATHFIND,
	PERF,
	PHYSICS,
} from '@voxelcraft/core-types'
import type { EcsWorld } from '@voxelcraft/core-types'
import { Health, Intent, PlayerTag, Transform, createEcsWorld, spawnLivingEntity } from '../ecs'
import { createRecordingEventBus, createSimVoxelWorld } from '../shared'
import { CombatProjectile } from '../combat/components'
import { combatApplyDamage } from '../combat/damage'
import { mobAiSystem } from './ai'
import { MobAi, MobPath } from './components'
import { mobBindContext } from './context'
import { mobSpawnMob } from './spawn'

const DT = 1 / PERF.simTickHz
const FLOOR_Y = 63
const STAND_Y = 64

/** Flat 32x32 arena with the player standing at the origin. */
function makeAiWorld(seed = 4242) {
	const voxels = createSimVoxelWorld()
	for (let cx = 0; cx <= 1; cx++) {
		for (let cz = 0; cz <= 1; cz++) voxels.ensureChunk(cx, cz)
	}
	for (let x = 0; x < 32; x++) {
		for (let z = 0; z < 32; z++) voxels.setBlock(x, FLOOR_Y, z, BLOCK.STONE)
	}
	const world = createEcsWorld()
	const bus = createRecordingEventBus()
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
	const ctx = mobBindContext(world, { voxels, seed, bus, spawningEnabled: false })
	return { voxels, world, bus, player, ctx }
}

function tickAi(world: EcsWorld, tick: number): void {
	mobAiSystem(world, DT, tick)
	world.flush()
}

describe('mobAiSystem', () => {
	it('acquires a target, plans a path and drops it with hysteresis', () => {
		const { world, ctx, player } = makeAiWorld()
		const zombie = mobSpawnMob(world, ctx, MOB.Zombie, { x: 10.5, y: STAND_Y, z: 0.5 }, 0)
		world.flush()
		tickAi(world, 1)
		const ai = world.get(zombie, MobAi)!
		expect(ai.target).toBe(player)
		expect(ai.state).toBe(AI_STATE.Chase)
		expect(ai.repathCooldown).toBe(PATHFIND.repathTicks)
		const path = world.get(zombie, MobPath)!
		expect(path.plannedAt).toBe(1)
		expect(path.status).not.toBe('none')
		const intent = world.get(zombie, Intent)!
		expect(Math.abs(intent.forward) + Math.abs(intent.strafe)).toBeGreaterThan(0)

		// Between chaseStartDistance and chaseStopDistance the target is kept.
		const transform = world.get(zombie, Transform)!
		transform.x = 20.5
		tickAi(world, 2)
		expect(ai.target).toBe(player)
		expect(ai.state).toBe(AI_STATE.Chase)

		// Past chaseStopDistance it gives up.
		transform.x = MOB_SPAWN.chaseStopDistance + 6.5
		tickAi(world, 3)
		expect(ai.target).toBe(-1)
		expect([AI_STATE.Idle, AI_STATE.Wander]).toContain(ai.state)
	})

	it('ignores a player beyond chaseStartDistance', () => {
		const { world, ctx } = makeAiWorld()
		const zombie = mobSpawnMob(world, ctx, MOB.Zombie, { x: 20.5, y: STAND_Y, z: 0.5 }, 0)
		world.flush()
		tickAi(world, 1)
		const ai = world.get(zombie, MobAi)!
		expect(ai.target).toBe(-1)
		expect(ai.state).not.toBe(AI_STATE.Chase)
	})

	it('hits the player in melee range and then waits out the cooldown', () => {
		const { world, ctx, player } = makeAiWorld()
		const zombie = mobSpawnMob(world, ctx, MOB.Zombie, { x: 1.5, y: STAND_Y, z: 0.5 }, 0)
		world.flush()
		const health = world.get(player, Health)!
		tickAi(world, 1)
		const ai = world.get(zombie, MobAi)!
		expect(ai.state).toBe(AI_STATE.Attack)
		expect(health.current).toBe(COMBAT.playerMaxHealth - 3)
		expect(ai.attackCooldown).toBe(PERF.simTickHz)
		tickAi(world, 2)
		expect(health.current).toBe(COMBAT.playerMaxHealth - 3)
	})

	it('lets a creeper fuse and explode after COMBAT.creeperFuseTicks', () => {
		const { world, ctx, bus, player } = makeAiWorld()
		const creeper = mobSpawnMob(world, ctx, MOB.Creeper, { x: 2.5, y: STAND_Y, z: 0.5 }, 0)
		world.flush()
		const health = world.get(player, Health)!
		tickAi(world, 1)
		expect(world.get(creeper, MobAi)!.state).toBe(AI_STATE.Fuse)
		for (let tick = 2; tick <= COMBAT.creeperFuseTicks; tick++) tickAi(world, tick)
		expect(health.current).toBeLessThan(COMBAT.playerMaxHealth)
		expect(world.get(creeper, Health)!.current).toBe(0)
		expect(world.get(creeper, MobAi)!.state).toBe(AI_STATE.Dead)
		expect(bus.recorded.filter((event) => event.name === EVENT.EntityDied)).toHaveLength(1)
	})

	it('makes a skeleton shoot one arrow per cooldown', () => {
		const { world, ctx } = makeAiWorld()
		mobSpawnMob(world, ctx, MOB.Skeleton, { x: 8.5, y: STAND_Y, z: 0.5 }, 0)
		world.flush()
		tickAi(world, 1)
		expect(world.query([CombatProjectile]).length).toBe(1)
		tickAi(world, 2)
		expect(world.query([CombatProjectile]).length).toBe(1)
	})

	it('makes a hurt passive mob flee from whoever hurt it', () => {
		const { world, ctx, player } = makeAiWorld()
		const pig = mobSpawnMob(world, ctx, MOB.Pig, { x: 3.5, y: STAND_Y, z: 0.5 }, 0)
		world.flush()
		combatApplyDamage(world, { target: pig, amount: 2, source: player, tick: 1 })
		world.flush()
		tickAi(world, 2)
		const ai = world.get(pig, MobAi)!
		expect(ai.state).toBe(AI_STATE.Flee)
		expect(ai.target).toBe(player)
		const intent = world.get(pig, Intent)!
		// Running away from the origin means moving towards +X.
		expect(intent.strafe).toBeGreaterThan(0)
	})

	it('stops acting once the mob is dead', () => {
		const { world, ctx } = makeAiWorld()
		const zombie = mobSpawnMob(world, ctx, MOB.Zombie, { x: 1.5, y: STAND_Y, z: 0.5 }, 0)
		world.flush()
		world.get(zombie, Health)!.current = 0
		tickAi(world, 1)
		const ai = world.get(zombie, MobAi)!
		expect(ai.state).toBe(AI_STATE.Dead)
		expect(ai.target).toBe(-1)
		const intent = world.get(zombie, Intent)!
		expect(intent.forward).toBe(0)
		expect(intent.strafe).toBe(0)
	})
})
