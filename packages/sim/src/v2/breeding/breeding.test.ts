import { describe, expect, it } from 'vitest'
import { BREEDING, EVENT, EVENT_V2, MOB, PARTICLE, PERF, PHYSICS } from '@voxelcraft/core-types'
import type { EcsWorld, EntityId, MobType } from '@voxelcraft/core-types'
import { Collider, Intent, createEcsWorld, spawnLivingEntity } from '../../ecs'
import { MobTag } from '../../mob/components'
import { mobDefOf } from '../../mob/mobDefs'
import { createRecordingEventBusV2, v2CountEvents, v2EventsNamed } from '../eventsV2'
import type { RecordingEventBusV2 } from '../eventsV2'
import {
	BABY_PANIC_TICKS,
	BREED_HEART_INTERVAL_TICKS,
	BREED_HEART_PARTICLE_COUNT,
	BREED_NO_ENTITY,
	BabyPanic,
	BabyTag,
	babyBeginPanic,
	babyBindPanicToEventBus,
	babyColliderSize,
	babyMoveScale,
	breedBindContext,
	breedSetLoveTicks,
	breedSpawnBaby,
	breedTickSystem,
} from './index'

const DT = 1 / PERF.simTickHz
const STAND_Y = 64

function makeWorld(): { world: EcsWorld; bus: RecordingEventBusV2 } {
	const world = createEcsWorld()
	const bus = createRecordingEventBusV2()
	breedBindContext(world, { bus })
	return { world, bus }
}

/** Minimal adult mob: living entity with the adult collider, intent and tag. */
function spawnAdult(world: EcsWorld, type: MobType, x: number, z: number): EntityId {
	const def = mobDefOf(type)
	const entity = spawnLivingEntity(world, {
		x,
		y: STAND_Y,
		z,
		width: def.width,
		height: def.height,
		maxHealth: def.maxHealth,
	})
	world.add(entity, Intent, {
		forward: 0,
		strafe: 0,
		jump: false,
		sprint: false,
		sneak: false,
		yaw: 0,
	})
	world.add(entity, MobTag, { type, hostile: def.hostile })
	world.flush()
	return entity
}

function runTicks(world: EcsWorld, count: number, from = 1): void {
	for (let i = 0; i < count; i++) {
		breedTickSystem(world, DT, from + i)
		world.flush()
	}
}

function intentOf(world: EcsWorld, entity: EntityId) {
	const intent = world.get(entity, Intent)
	if (!intent) throw new Error('entity has no Intent')
	return intent
}

describe('baby following', () => {
	it('prefers the recorded parent over a closer adult', () => {
		const { world } = makeWorld()
		const closer = spawnAdult(world, MOB.Pig, 0, 0)
		const parent = spawnAdult(world, MOB.Pig, 3, 0)
		expect(closer).not.toBe(parent)
		const baby = breedSpawnBaby(world, {
			type: MOB.Pig,
			at: { x: 1.2, y: STAND_Y, z: 0 },
			parent,
		})
		world.flush()
		runTicks(world, 1)
		const intent = intentOf(world, baby)
		// Walks +X towards the parent at x = 3, not -X towards the closer adult.
		expect(intent.strafe).toBeGreaterThan(0)
		expect(intent.forward).toBe(0)
		expect(intent.yaw).toBe(0)
	})

	it('falls back to the nearest adult of the same type', () => {
		const { world } = makeWorld()
		spawnAdult(world, MOB.Pig, 0, 0)
		spawnAdult(world, MOB.Pig, 3, 0)
		const baby = breedSpawnBaby(world, {
			type: MOB.Pig,
			at: { x: 1.2, y: STAND_Y, z: 0 },
			parent: BREED_NO_ENTITY,
		})
		world.flush()
		runTicks(world, 1)
		expect(intentOf(world, baby).strafe).toBeLessThan(0)
	})

	it('ignores adults of another type and stands still', () => {
		const { world } = makeWorld()
		spawnAdult(world, MOB.Cow, 3, 0)
		const baby = breedSpawnBaby(world, { type: MOB.Pig, at: { x: 0, y: STAND_Y, z: 0 } })
		world.flush()
		runTicks(world, 1)
		const intent = intentOf(world, baby)
		expect(intent.strafe).toBe(0)
		expect(intent.forward).toBe(0)
	})
})

describe('growing up', () => {
	it('grows on exactly the babyGrowTicks-th tick', () => {
		const { world, bus } = makeWorld()
		const def = mobDefOf(MOB.Pig)
		const size = babyColliderSize(def)
		const baby = breedSpawnBaby(world, { type: MOB.Pig, at: { x: 0, y: STAND_Y, z: 0 } })
		world.flush()
		expect(world.get(baby, Collider)?.width).toBeCloseTo(size.width)
		expect(world.get(baby, Collider)?.height).toBeCloseTo(size.height)

		runTicks(world, BREEDING.babyGrowTicks - 1)
		expect(world.get(baby, BabyTag)?.growTicks).toBe(1)
		expect(v2CountEvents(bus, EVENT_V2.EntityGrown)).toBe(0)
		expect(world.get(baby, Collider)?.width).toBeCloseTo(size.width)

		runTicks(world, 1, BREEDING.babyGrowTicks)
		expect(world.get(baby, BabyTag)).toBeUndefined()
		expect(v2EventsNamed(bus, EVENT_V2.EntityGrown)).toEqual([{ entity: baby, mob: MOB.Pig }])
		expect(world.get(baby, Collider)?.width).toBeCloseTo(def.width)
		expect(world.get(baby, Collider)?.height).toBeCloseTo(def.height)
	})
})

describe('panic', () => {
	it('flees the damage source and outranks following the parent', () => {
		const { world } = makeWorld()
		const parent = spawnAdult(world, MOB.Pig, 4, 0)
		const attacker = spawnLivingEntity(world, { x: 6, y: STAND_Y, z: 0 })
		world.flush()
		const baby = breedSpawnBaby(world, { type: MOB.Pig, at: { x: 0, y: STAND_Y, z: 0 }, parent })
		world.flush()

		babyBeginPanic(world, baby, attacker)
		world.flush()
		runTicks(world, 1)
		// Parent and attacker are both at +X, so following would be positive.
		expect(intentOf(world, baby).strafe).toBeLessThan(0)

		runTicks(world, BABY_PANIC_TICKS - 1, 2)
		expect(intentOf(world, baby).strafe).toBeLessThan(0)
		expect(world.get(baby, BabyPanic)).toBeUndefined()

		runTicks(world, 1, BABY_PANIC_TICKS + 1)
		expect(intentOf(world, baby).strafe).toBeGreaterThan(0)
	})

	it('starts panicking from an entity.damaged event', () => {
		const { world, bus } = makeWorld()
		const adult = spawnAdult(world, MOB.Pig, 0, 0)
		const attacker = spawnLivingEntity(world, { x: 0, y: STAND_Y, z: 4 })
		world.flush()
		const unbind = babyBindPanicToEventBus(world, bus)
		bus.emit(EVENT.EntityDamaged, { entity: adult, amount: 2, source: attacker })
		world.flush()
		runTicks(world, 1)
		expect(intentOf(world, adult).forward).toBeLessThan(0)
		unbind()
	})
})

describe('baby size and speed', () => {
	it('scales the collider and walks faster than the adult', () => {
		const def = mobDefOf(MOB.Pig)
		expect(babyColliderSize(def).width).toBeCloseTo(def.width * BREEDING.babyScale)
		expect(babyColliderSize(def).height).toBeCloseTo(def.height * BREEDING.babyScale)
		expect(babyMoveScale(def, true)).toBeGreaterThan(babyMoveScale(def, false))
		expect(babyMoveScale(def, true)).toBeCloseTo(
			(def.speed * BREEDING.babySpeedFactor) / PHYSICS.walkSpeed,
		)
		expect(babyMoveScale(def, false)).toBeCloseTo(def.speed / PHYSICS.walkSpeed)
	})
})

describe('love mode', () => {
	it('walks the pair together and beats hearts on a fixed cadence', () => {
		const { world, bus } = makeWorld()
		const left = spawnAdult(world, MOB.Pig, 0, 0)
		const right = spawnAdult(world, MOB.Pig, 4, 0)
		breedSetLoveTicks(world, left, BREEDING.loveTicks)
		breedSetLoveTicks(world, right, BREEDING.loveTicks)
		world.flush()

		runTicks(world, 1)
		expect(intentOf(world, left).strafe).toBeGreaterThan(0)
		expect(intentOf(world, right).strafe).toBeLessThan(0)
		const hearts = v2EventsNamed(bus, EVENT_V2.ParticleSpawn)
		expect(hearts).toHaveLength(2)
		const [first] = hearts
		expect(first.kind).toBe(PARTICLE.Heart)
		expect(first.count).toBe(BREED_HEART_PARTICLE_COUNT)

		// Next burst lands exactly BREED_HEART_INTERVAL_TICKS later.
		runTicks(world, BREED_HEART_INTERVAL_TICKS - 1, 2)
		expect(v2CountEvents(bus, EVENT_V2.ParticleSpawn)).toBe(2)
		runTicks(world, 1, BREED_HEART_INTERVAL_TICKS + 1)
		expect(v2CountEvents(bus, EVENT_V2.ParticleSpawn)).toBe(4)
	})
})
