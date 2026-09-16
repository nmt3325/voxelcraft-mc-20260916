import { describe, expect, it } from 'vitest'
import { BREEDING, EVENT, EVENT_V2, ITEM_V2, MOB, PARTICLE } from '@voxelcraft/core-types'
import type { EcsWorld, EntityId, MobType } from '@voxelcraft/core-types'
import { Collider, Intent, Transform, createEcsWorld, spawnLivingEntity } from '../../ecs'
import { MobTag } from '../../mob/components'
import { mobDefOf } from '../../mob/mobDefs'
import { createRecordingEventBusV2, v2CountEvents, v2EventsNamed } from '../eventsV2'
import type { RecordingEventBusV2 } from '../eventsV2'
import { babyColliderSize } from './babyBehavior'
import {
	BabyTag,
	BreedCooldown,
	breedBindContext,
	breedIsInLoveMode,
	breedIsOnCooldown,
} from './babyComponents'
import {
	BREED_RULES,
	breedCanBreed,
	breedFeedAdult,
	breedFoodFor,
	breedIsFood,
	breedSpawnBaby,
	breedTryPair,
} from './breedingApi'

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

/** Two pigs 4 blocks apart on X and Z, both fed, so the midpoint is (0, 64, 2). */
function makeLovingPair(world: EcsWorld): { a: EntityId; b: EntityId } {
	const a = spawnAdult(world, MOB.Pig, -2, 0)
	const b = spawnAdult(world, MOB.Pig, 2, 4)
	breedFeedAdult(world, a, ITEM_V2.CARROT)
	breedFeedAdult(world, b, ITEM_V2.POTATO)
	world.flush()
	return { a, b }
}

describe('breeding rules', () => {
	it('re-exposes the frozen numbers', () => {
		expect(BREED_RULES.loveTicks).toBe(BREEDING.loveTicks)
		expect(BREED_RULES.babyGrowTicks).toBe(BREEDING.babyGrowTicks)
		expect(BREED_RULES.cooldownTicks).toBe(BREEDING.cooldownTicks)
		expect(BREED_RULES.partnerRadius).toBe(BREEDING.partnerRadius)
		expect(BREED_RULES.babyScale).toBe(BREEDING.babyScale)
		expect(BREED_RULES.babySpeedFactor).toBe(BREEDING.babySpeedFactor)
		expect(BREED_RULES.xpOnBreed).toBe(BREEDING.xpOnBreed)
		expect(BREED_RULES.food[MOB.Pig]).toContain(ITEM_V2.CARROT)
	})

	it('answers food questions per mob type', () => {
		expect(breedIsFood(MOB.Pig, ITEM_V2.CARROT)).toBe(true)
		expect(breedIsFood(MOB.Pig, ITEM_V2.WHEAT)).toBe(false)
		expect(breedIsFood(MOB.Cow, ITEM_V2.WHEAT)).toBe(true)
		expect(breedCanBreed(MOB.Chicken)).toBe(true)
		expect(breedCanBreed(MOB.Zombie)).toBe(false)
		expect(breedFoodFor(MOB.Zombie)).toHaveLength(0)
	})
})

describe('feeding', () => {
	it('puts a fed adult into love mode', () => {
		const { world } = makeWorld()
		const pig = spawnAdult(world, MOB.Pig, 0, 0)
		const result = breedFeedAdult(world, pig, ITEM_V2.CARROT)
		world.flush()
		expect(result).toEqual({ ok: true, loveTicks: BREEDING.loveTicks })
		expect(breedIsInLoveMode(world, pig)).toBe(true)
	})

	it('refuses the wrong food and mobs that cannot breed', () => {
		const { world } = makeWorld()
		const pig = spawnAdult(world, MOB.Pig, 0, 0)
		const zombie = spawnAdult(world, MOB.Zombie, 2, 0)
		expect(breedFeedAdult(world, pig, ITEM_V2.WHEAT)).toEqual({
			ok: false,
			reason: 'wrong-food',
		})
		expect(breedFeedAdult(world, zombie, ITEM_V2.WHEAT)).toEqual({
			ok: false,
			reason: 'not-breedable',
		})
		expect(breedIsInLoveMode(world, pig)).toBe(false)
	})

	it('refuses to feed a baby', () => {
		const { world } = makeWorld()
		const baby = breedSpawnBaby(world, { type: MOB.Pig, at: { x: 0, y: STAND_Y, z: 0 } })
		world.flush()
		expect(breedFeedAdult(world, baby, ITEM_V2.CARROT)).toEqual({ ok: false, reason: 'baby' })
	})
})

describe('pairing', () => {
	it('spawns the baby at the midpoint and reports both parents in id order', () => {
		const { world, bus } = makeWorld()
		const { a, b } = makeLovingPair(world)
		// Passed in reverse on purpose: the payload must not depend on call order.
		const result = breedTryPair(world, b, a, 7)
		world.flush()
		expect(result.ok).toBe(true)
		if (!result.ok) return

		const low = Math.min(a, b)
		const high = Math.max(a, b)
		expect(result.parentA).toBe(low)
		expect(result.parentB).toBe(high)
		expect(result.at).toEqual({ x: 0, y: STAND_Y, z: 2 })

		const def = mobDefOf(MOB.Pig)
		expect(world.get(result.baby, MobTag)?.type).toBe(MOB.Pig)
		expect(world.get(result.baby, BabyTag)?.growTicks).toBe(BREEDING.babyGrowTicks)
		expect(world.get(result.baby, BabyTag)?.parent).toBe(low)
		expect(world.get(result.baby, Collider)?.width).toBeCloseTo(babyColliderSize(def).width)
		expect(world.get(result.baby, Transform)?.x).toBe(0)
		expect(world.get(result.baby, Transform)?.z).toBe(2)

		expect(v2EventsNamed(bus, EVENT_V2.EntityBred)).toEqual([
			{ parentA: low, parentB: high, baby: result.baby, at: result.at },
		])
		const [heart] = v2EventsNamed(bus, EVENT_V2.ParticleSpawn)
		expect(heart.kind).toBe(PARTICLE.Heart)
		expect(heart.x).toBe(0)
		expect(v2CountEvents(bus, EVENT.EntitySpawned)).toBe(1)
	})

	it('puts both parents on cooldown and clears both love modes', () => {
		const { world } = makeWorld()
		const { a, b } = makeLovingPair(world)
		expect(breedTryPair(world, a, b).ok).toBe(true)
		world.flush()
		expect(breedIsInLoveMode(world, a)).toBe(false)
		expect(breedIsInLoveMode(world, b)).toBe(false)
		expect(breedIsOnCooldown(world, a)).toBe(true)
		expect(breedIsOnCooldown(world, b)).toBe(true)
		expect(world.get(a, BreedCooldown)?.cooldownTicks).toBe(BREEDING.cooldownTicks)
		expect(world.get(b, BreedCooldown)?.cooldownTicks).toBe(BREEDING.cooldownTicks)
	})

	it('refuses a feed and a second pairing while the cooldown runs', () => {
		const { world } = makeWorld()
		const { a, b } = makeLovingPair(world)
		expect(breedTryPair(world, a, b).ok).toBe(true)
		world.flush()
		expect(breedFeedAdult(world, a, ITEM_V2.CARROT)).toEqual({ ok: false, reason: 'cooldown' })
		expect(breedTryPair(world, a, b)).toEqual({ ok: false, reason: 'cooldown' })
	})

	it('refuses partners that are not in love, too far apart or the same entity', () => {
		const { world } = makeWorld()
		const a = spawnAdult(world, MOB.Pig, 0, 0)
		const b = spawnAdult(world, MOB.Pig, BREEDING.partnerRadius + 2, 0)
		expect(breedTryPair(world, a, b)).toEqual({ ok: false, reason: 'not-in-love' })
		breedFeedAdult(world, a, ITEM_V2.CARROT)
		breedFeedAdult(world, b, ITEM_V2.CARROT)
		world.flush()
		expect(breedTryPair(world, a, b)).toEqual({ ok: false, reason: 'too-far' })
		expect(breedTryPair(world, a, a)).toEqual({ ok: false, reason: 'same-entity' })
	})

	it('refuses two different mob types', () => {
		const { world } = makeWorld()
		const pig = spawnAdult(world, MOB.Pig, 0, 0)
		const cow = spawnAdult(world, MOB.Cow, 1, 0)
		breedFeedAdult(world, pig, ITEM_V2.CARROT)
		breedFeedAdult(world, cow, ITEM_V2.WHEAT)
		world.flush()
		expect(breedTryPair(world, pig, cow)).toEqual({ ok: false, reason: 'different-type' })
	})
})
