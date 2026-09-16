import { describe, expect, it } from 'vitest'
import {
	BREEDING,
	EVENT_V2,
	XP,
	levelFromXp,
	xpForLevel,
	type AnyEventName,
	type EventBusV2,
} from '@voxelcraft/core-types'
import {
	MAX_LEVEL,
	XP_SOURCE,
	canAfford,
	createXpState,
	grantXp,
	grantXpFrom,
	levelFromTotalXp,
	levelProgress,
	spendLevels,
	xpForSource,
	xpInLevel,
	xpToNextLevel,
} from './xp'
import {
	collectOrbs,
	createOrbPool,
	mergeOrbs,
	orbCount,
	spawnOrb,
	tickOrbs,
	totalOrbXp,
	type XpOrb,
} from './orbs'

interface RecordedEvent {
	name: AnyEventName
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

function orb(id: number, x: number, amount: number, ageTicks = 0): XpOrb {
	return { id, x, y: 64, z: 0, amount, ageTicks }
}

describe('xp level curve', () => {
	it('follows the frozen curve', () => {
		expect(xpForLevel(0)).toBe(0)
		expect(xpForLevel(1)).toBe(1 + XP.baseCost)
		expect(xpForLevel(MAX_LEVEL)).toBe(MAX_LEVEL * MAX_LEVEL + XP.baseCost * MAX_LEVEL)
	})

	it('reverse lookup agrees with the contract for every total up to level 40', () => {
		const max = xpForLevel(40)
		for (let xp = 0; xp <= max; xp++) {
			expect(levelFromTotalXp(xp)).toBe(levelFromXp(xp))
		}
	})

	it('is exact at both sides of every level boundary', () => {
		for (let level = 0; level <= MAX_LEVEL; level++) {
			expect(levelFromTotalXp(xpForLevel(level))).toBe(level)
			if (level > 0) expect(levelFromTotalXp(xpForLevel(level) - 1)).toBe(level - 1)
			expect(xpForLevel(level + 1)).toBeGreaterThan(xpForLevel(level))
		}
	})

	it('reports progress inside a level', () => {
		const total = xpForLevel(5) + 3
		expect(xpInLevel(total)).toBe(3)
		expect(xpToNextLevel(total)).toBe(xpForLevel(6) - total)
		expect(levelProgress(xpForLevel(5))).toBe(0)
		expect(levelProgress(total)).toBeCloseTo(3 / (xpForLevel(6) - xpForLevel(5)), 10)
	})

	it('clamps junk totals to zero', () => {
		expect(levelFromTotalXp(-50)).toBe(0)
		expect(createXpState(-1).total).toBe(0)
		expect(createXpState(Number.NaN).level).toBe(0)
		expect(xpInLevel(-7)).toBe(0)
	})
})

describe('xp gains', () => {
	it('uses the frozen amount per source', () => {
		expect(xpForSource(XP_SOURCE.OreBreak)).toBe(XP.oreDrop)
		expect(xpForSource(XP_SOURCE.MobKill)).toBe(XP.mobDrop)
		expect(xpForSource(XP_SOURCE.Smelt, 4)).toBe(XP.smeltDrop * 4)
		expect(xpForSource(XP_SOURCE.Breed)).toBe(BREEDING.xpOnBreed)
		expect(xpForSource(XP_SOURCE.Smelt, 0)).toBe(0)
	})

	it('emits xp.changed with the new level on a level up', () => {
		const { bus, events } = recordingBus()
		const state = createXpState(0)
		const grant = grantXp(state, xpForLevel(1), bus)
		expect(grant.leveledUp).toBe(true)
		expect(grant.levelsGained).toBe(1)
		expect(events).toEqual([
			{ name: EVENT_V2.XpChanged, payload: { total: xpForLevel(1), level: 1 } },
		])
	})

	it('stays quiet when nothing is granted', () => {
		const { bus, events } = recordingBus()
		const state = createXpState(10)
		const grant = grantXp(state, 0, bus)
		expect(grant.gained).toBe(0)
		expect(grant.leveledUp).toBe(false)
		expect(events).toHaveLength(0)
		expect(state.total).toBe(10)
	})

	it('accumulates ore, mob, smelt and breed gains', () => {
		const state = createXpState(0)
		grantXpFrom(state, XP_SOURCE.OreBreak, 3)
		grantXpFrom(state, XP_SOURCE.MobKill)
		grantXpFrom(state, XP_SOURCE.Smelt, 2)
		grantXpFrom(state, XP_SOURCE.Breed)
		expect(state.total).toBe(
			XP.oreDrop * 3 + XP.mobDrop + XP.smeltDrop * 2 + BREEDING.xpOnBreed,
		)
		expect(state.level).toBe(levelFromXp(state.total))
	})
})

describe('spending levels', () => {
	it('keeps the progress earned inside the current level', () => {
		const state = createXpState(xpForLevel(10) + 3)
		expect(canAfford(state, 3)).toBe(true)
		const spend = spendLevels(state, 3)
		expect(spend.paid).toBe(true)
		expect(state.level).toBe(7)
		expect(xpInLevel(state.total)).toBe(3)
	})

	it('refuses a cost above the current level', () => {
		const state = createXpState(xpForLevel(2))
		expect(canAfford(state, 5)).toBe(false)
		const spend = spendLevels(state, 5)
		expect(spend.paid).toBe(false)
		expect(spend.spent).toBe(0)
		expect(state.total).toBe(xpForLevel(2))
	})
})

describe('xp orbs', () => {
	it('merges spawns inside the merge radius and leaves distant ones alone', () => {
		const pool = createOrbPool()
		spawnOrb(pool, 0, 64, 0, XP.oreDrop)
		spawnOrb(pool, XP.orbMergeRadius / 2, 64, 0, XP.oreDrop)
		spawnOrb(pool, 10, 64, 0, XP.mobDrop)
		expect(orbCount(pool)).toBe(2)
		expect(totalOrbXp(pool)).toBe(XP.oreDrop * 2 + XP.mobDrop)
		expect(spawnOrb(pool, 0, 64, 0, 0)).toBeNull()
	})

	it('mergeOrbs is deterministic, pure and conserves experience', () => {
		const orbs = [orb(3, 0, 1, 12), orb(1, 0.1, 2, 5), orb(2, 5, 4, 0)]
		const first = mergeOrbs(orbs)
		const second = mergeOrbs(orbs)
		expect(first).toEqual(second)
		expect(first).toHaveLength(2)
		expect(first[0].amount).toBe(3)
		expect(first[0].id).toBe(1)
		expect(first[0].ageTicks).toBe(5)
		expect(orbs[0].amount).toBe(1)
	})

	it('picks up only orbs inside the pickup radius', () => {
		const pool = createOrbPool()
		spawnOrb(pool, 0, 64, 0, 5)
		spawnOrb(pool, 0, 64, XP.orbPickupRadius + 1, 7)
		const { bus, events } = recordingBus()
		const state = createXpState(0)
		const pickup = collectOrbs(pool, 0, 64, 0, state, bus)
		expect(pickup.collected).toBe(5)
		expect(pickup.orbs).toHaveLength(1)
		expect(state.total).toBe(5)
		expect(orbCount(pool)).toBe(1)
		expect(events).toHaveLength(1)
	})

	it('expires orbs after the frozen lifetime', () => {
		const pool = createOrbPool()
		spawnOrb(pool, 0, 64, 0, 3)
		expect(tickOrbs(pool, XP.orbLifetimeTicks - 1)).toHaveLength(0)
		expect(orbCount(pool)).toBe(1)
		expect(tickOrbs(pool, 1)).toHaveLength(1)
		expect(orbCount(pool)).toBe(0)
	})

	it('restarts the lifetime when an orb absorbs a spawn', () => {
		const pool = createOrbPool()
		spawnOrb(pool, 0, 64, 0, 3)
		tickOrbs(pool, XP.orbLifetimeTicks - 10)
		spawnOrb(pool, 0, 64, 0, 3)
		expect(pool.orbs[0].ageTicks).toBe(0)
		expect(pool.orbs[0].amount).toBe(6)
		expect(tickOrbs(pool, 20)).toHaveLength(0)
	})
})
