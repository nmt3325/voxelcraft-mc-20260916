import { describe, expect, it } from 'vitest'
import { BREEDING, EVENT_V2, ITEM_V2, MOB, type EventBusV2 } from '@voxelcraft/core-types'
import { createXpState } from '../experience'
import {
	BABY_ID_BASE,
	BABY_ID_SPAN,
	addAnimal,
	canBreed,
	createHerd,
	feed,
	findPartner,
	getAnimal,
	listAnimals,
	removeAnimal,
	scaleOf,
	speedFactorOf,
	tickHerd,
	tryBreed,
	withinPartnerRadius,
	type Herd,
} from './breeding'

interface RecordedEvent {
	name: string
	payload: unknown
}

function recordingBus(): { bus: EventBusV2; events: RecordedEvent[] } {
	const events: RecordedEvent[] = []
	const bus: EventBusV2 = {
		on() {
			return () => {}
		},
		emit(name, payload) {
			events.push({ name, payload })
		},
		clear() {
			events.length = 0
		},
	}
	return { bus, events }
}

/** Two adult cows `distance` blocks apart on x, both already in love. */
function cowPair(distance: number): Herd {
	const herd = createHerd()
	addAnimal(herd, { id: 1, mob: MOB.Cow, x: 0, y: 64, z: 0 })
	addAnimal(herd, { id: 2, mob: MOB.Cow, x: distance, y: 64, z: 0 })
	expect(feed(herd, 1, ITEM_V2.WHEAT)).toBe(true)
	expect(feed(herd, 2, ITEM_V2.WHEAT)).toBe(true)
	return herd
}

describe('herd bookkeeping', () => {
	it('adds, reads and removes members', () => {
		const herd = createHerd()
		addAnimal(herd, { id: 1, mob: MOB.Cow, x: 0, y: 64, z: 0 })
		expect(getAnimal(herd, 1)?.mob).toBe(MOB.Cow)
		expect(getAnimal(herd, 1)?.baby).toBe(false)
		expect(listAnimals(herd)).toHaveLength(1)
		expect(removeAnimal(herd, 1)).toBe(true)
		expect(removeAnimal(herd, 1)).toBe(false)
		expect(getAnimal(herd, 1)).toBeUndefined()
	})
})

describe('feeding', () => {
	it('accepts only the breeding food of that species', () => {
		const herd = createHerd()
		addAnimal(herd, { id: 1, mob: MOB.Cow, x: 0, y: 64, z: 0 })
		addAnimal(herd, { id: 2, mob: MOB.Pig, x: 0, y: 64, z: 0 })
		addAnimal(herd, { id: 3, mob: MOB.Chicken, x: 0, y: 64, z: 0 })
		addAnimal(herd, { id: 4, mob: MOB.Sheep, x: 0, y: 64, z: 0 })

		expect(feed(herd, 1, ITEM_V2.WHEAT)).toBe(true)
		expect(getAnimal(herd, 1)?.loveTicks).toBe(BREEDING.loveTicks)
		expect(feed(herd, 1, ITEM_V2.CARROT)).toBe(false)

		expect(feed(herd, 2, ITEM_V2.CARROT)).toBe(true)
		expect(feed(herd, 2, ITEM_V2.POTATO)).toBe(true)
		expect(feed(herd, 2, ITEM_V2.WHEAT)).toBe(false)

		expect(feed(herd, 3, ITEM_V2.WHEAT_SEEDS)).toBe(true)
		expect(feed(herd, 3, ITEM_V2.WHEAT)).toBe(false)

		expect(feed(herd, 4, ITEM_V2.WHEAT)).toBe(true)
		expect(feed(herd, 4, ITEM_V2.WHEAT_SEEDS)).toBe(false)
	})

	it('refuses babies, non-breedable mobs and unknown ids', () => {
		const herd = createHerd()
		addAnimal(herd, { id: 1, mob: MOB.Cow, x: 0, y: 64, z: 0, baby: true })
		addAnimal(herd, { id: 2, mob: MOB.Zombie, x: 0, y: 64, z: 0 })

		expect(canBreed(herd, 1)).toBe(false)
		expect(feed(herd, 1, ITEM_V2.WHEAT)).toBe(false)
		expect(canBreed(herd, 2)).toBe(false)
		expect(feed(herd, 2, ITEM_V2.WHEAT)).toBe(false)
		expect(canBreed(herd, 99)).toBe(false)
		expect(feed(herd, 99, ITEM_V2.WHEAT)).toBe(false)
	})
})

describe('partner radius', () => {
	it('pairs at exactly BREEDING.partnerRadius but not one block further', () => {
		expect(BREEDING.partnerRadius).toBe(8)

		const inRange = cowPair(BREEDING.partnerRadius)
		const parents = listAnimals(inRange)
		expect(withinPartnerRadius(parents[0], parents[1])).toBe(true)
		expect(findPartner(inRange, 1)?.id).toBe(2)
		expect(tryBreed(inRange, { seed: 7 })).not.toBeNull()
		expect(listAnimals(inRange)).toHaveLength(3)

		const outOfRange = cowPair(BREEDING.partnerRadius + 1)
		const apart = listAnimals(outOfRange)
		expect(withinPartnerRadius(apart[0], apart[1])).toBe(false)
		expect(findPartner(outOfRange, 1)).toBeNull()
		expect(tryBreed(outOfRange, { seed: 7 })).toBeNull()
		expect(getAnimal(outOfRange, 1)?.loveTicks).toBe(BREEDING.loveTicks)
		expect(listAnimals(outOfRange)).toHaveLength(2)
	})

	it('never pairs two different species', () => {
		const herd = createHerd()
		addAnimal(herd, { id: 1, mob: MOB.Cow, x: 0, y: 64, z: 0 })
		addAnimal(herd, { id: 2, mob: MOB.Sheep, x: 1, y: 64, z: 0 })
		expect(feed(herd, 1, ITEM_V2.WHEAT)).toBe(true)
		expect(feed(herd, 2, ITEM_V2.WHEAT)).toBe(true)
		expect(tryBreed(herd, { seed: 1 })).toBeNull()
	})
})

describe('tryBreed', () => {
	it('spawns the baby at the midpoint and announces entity.bred', () => {
		const herd = cowPair(4)
		const { bus, events } = recordingBus()

		const result = tryBreed(herd, { seed: 5, bus })
		expect(result).not.toBeNull()
		expect(result?.baby.baby).toBe(true)
		expect(result?.baby.mob).toBe(MOB.Cow)
		expect(result?.baby.ageTicks).toBe(0)
		expect(result?.at).toEqual({ x: 2, y: 64, z: 0 })
		expect(result?.baby.x).toBe(2)

		expect(events).toHaveLength(1)
		expect(events[0].name).toBe(EVENT_V2.EntityBred)
		expect(events[0].payload).toEqual({
			parentA: 1,
			parentB: 2,
			baby: result?.baby.id,
			at: { x: 2, y: 64, z: 0 },
		})
	})

	it('grants exactly BREEDING.xpOnBreed', () => {
		const herd = cowPair(1)
		const xpState = createXpState()

		const result = tryBreed(herd, { seed: 11, xpState })
		expect(result?.xpGained).toBe(BREEDING.xpOnBreed)
		expect(xpState.total).toBe(BREEDING.xpOnBreed)
	})

	it('grants no experience without an xp state', () => {
		expect(tryBreed(cowPair(1), { seed: 11 })?.xpGained).toBe(0)
	})

	it('blocks a second breed until BREEDING.cooldownTicks have elapsed', () => {
		const herd = cowPair(2)
		expect(tryBreed(herd, { seed: 3 })).not.toBeNull()

		expect(getAnimal(herd, 1)?.cooldownTicks).toBe(BREEDING.cooldownTicks)
		expect(getAnimal(herd, 2)?.cooldownTicks).toBe(BREEDING.cooldownTicks)
		expect(getAnimal(herd, 1)?.loveTicks).toBe(0)
		expect(canBreed(herd, 1)).toBe(false)
		expect(feed(herd, 1, ITEM_V2.WHEAT)).toBe(false)

		tickHerd(herd, BREEDING.cooldownTicks - 1)
		expect(getAnimal(herd, 1)?.cooldownTicks).toBe(1)
		expect(feed(herd, 1, ITEM_V2.WHEAT)).toBe(false)
		expect(tryBreed(herd, { seed: 3 })).toBeNull()

		tickHerd(herd, 1)
		expect(getAnimal(herd, 1)?.cooldownTicks).toBe(0)
		expect(feed(herd, 1, ITEM_V2.WHEAT)).toBe(true)
		expect(feed(herd, 2, ITEM_V2.WHEAT)).toBe(true)
		expect(tryBreed(herd, { seed: 3 })).not.toBeNull()
		expect(listAnimals(herd)).toHaveLength(4)
	})

	it('lets love expire after BREEDING.loveTicks', () => {
		const herd = cowPair(2)
		tickHerd(herd, BREEDING.loveTicks)
		expect(getAnimal(herd, 1)?.loveTicks).toBe(0)
		expect(tryBreed(herd, { seed: 1 })).toBeNull()
	})

	it('is deterministic for the same seed and herd', () => {
		const first = tryBreed(cowPair(3), { seed: 4242 })
		const second = tryBreed(cowPair(3), { seed: 4242 })

		expect(first?.baby.id).toBe(second?.baby.id)
		expect(first?.baby.id).toBeGreaterThanOrEqual(BABY_ID_BASE)
		expect(first?.baby.id).toBeLessThan(BABY_ID_BASE + BABY_ID_SPAN)
	})
})

describe('growing up', () => {
	it('promotes a baby exactly at BREEDING.babyGrowTicks and announces entity.grown', () => {
		expect(BREEDING.babyGrowTicks).toBe(24000)
		const herd = createHerd()
		addAnimal(herd, { id: 9, mob: MOB.Cow, x: 0, y: 64, z: 0, baby: true })
		const { bus, events } = recordingBus()

		expect(tickHerd(herd, BREEDING.babyGrowTicks - 1, bus)).toHaveLength(0)
		expect(getAnimal(herd, 9)?.baby).toBe(true)
		expect(events).toHaveLength(0)

		const grown = tickHerd(herd, 1, bus)
		expect(grown.map((animal) => animal.id)).toEqual([9])
		expect(getAnimal(herd, 9)?.baby).toBe(false)
		expect(getAnimal(herd, 9)?.ageTicks).toBe(BREEDING.babyGrowTicks)
		expect(events).toHaveLength(1)
		expect(events[0].name).toBe(EVENT_V2.EntityGrown)
		expect(events[0].payload).toEqual({ entity: 9, mob: MOB.Cow })

		expect(tickHerd(herd, 1, bus)).toHaveLength(0)
		expect(events).toHaveLength(1)
	})

	it('applies babyScale and babySpeedFactor while young', () => {
		const herd = createHerd()
		const baby = addAnimal(herd, { id: 1, mob: MOB.Pig, x: 0, y: 64, z: 0, baby: true })
		const adult = addAnimal(herd, { id: 2, mob: MOB.Pig, x: 0, y: 64, z: 0 })

		expect(scaleOf(baby)).toBe(BREEDING.babyScale)
		expect(scaleOf(adult)).toBe(1)
		expect(speedFactorOf(baby, 4)).toBeCloseTo(4 * BREEDING.babySpeedFactor)
		expect(speedFactorOf(adult, 4)).toBe(4)

		tickHerd(herd, BREEDING.babyGrowTicks)
		expect(scaleOf(baby)).toBe(1)
		expect(speedFactorOf(baby, 4)).toBe(4)
	})
})
