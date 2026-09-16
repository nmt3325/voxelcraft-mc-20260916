import { describe, expect, it } from 'vitest'
import { BLOCK, BLOCK_V2, BREEDING, MOB, XP } from '@voxelcraft/core-types'
import {
	XP_ORE_BLOCKS,
	dropBlockBreakXp,
	dropBreedingXp,
	dropMobKillXp,
	dropSmeltXp,
	isOreBlock,
	xpForBlockBreak,
	xpForBreeding,
	xpForMobKill,
	xpForSmelt,
} from './sources'
import { createOrbPool, createXpState, collectOrbs, orbCount, totalOrbXp } from './index'

describe('xp sources', () => {
	it('releases ore experience for every ore and nothing else', () => {
		for (const ore of XP_ORE_BLOCKS) {
			expect(isOreBlock(ore)).toBe(true)
			expect(xpForBlockBreak(ore)).toBe(XP.oreDrop)
		}
		expect(XP_ORE_BLOCKS).toContain(BLOCK_V2.QUARTZ_ORE)
		for (const plain of [BLOCK.STONE, BLOCK.DIRT, BLOCK.PLANKS, BLOCK.AIR]) {
			expect(isOreBlock(plain)).toBe(false)
			expect(xpForBlockBreak(plain)).toBe(0)
		}
	})

	it('gives no ore experience under silk touch', () => {
		expect(xpForBlockBreak(BLOCK.DIAMOND_ORE, { silkTouch: true })).toBe(0)
		expect(xpForBlockBreak(BLOCK.DIAMOND_ORE, { silkTouch: false })).toBe(XP.oreDrop)
	})

	it('uses the frozen amounts for mobs, smelting and breeding', () => {
		expect(xpForMobKill(MOB.Zombie)).toBe(XP.mobDrop)
		expect(xpForMobKill(MOB.Cow)).toBe(XP.mobDrop)
		expect(xpForSmelt()).toBe(XP.smeltDrop)
		expect(xpForSmelt(8)).toBe(XP.smeltDrop * 8)
		expect(xpForBreeding()).toBe(BREEDING.xpOnBreed)
	})
})

describe('dropping source experience into orbs', () => {
	it('spawns one orb per event and merges events at the same spot', () => {
		const pool = createOrbPool()
		const ore = dropBlockBreakXp(pool, 1, 64, 1, BLOCK.COAL_ORE)
		const mob = dropMobKillXp(pool, 1, 64, 1, MOB.Pig)
		expect(ore.amount).toBe(XP.oreDrop)
		expect(mob.amount).toBe(XP.mobDrop)
		expect(orbCount(pool)).toBe(1)
		expect(totalOrbXp(pool)).toBe(XP.oreDrop + XP.mobDrop)
	})

	it('drops nothing for a block that carries no experience', () => {
		const pool = createOrbPool()
		const plain = dropBlockBreakXp(pool, 0, 64, 0, BLOCK.DIRT)
		expect(plain.amount).toBe(0)
		expect(plain.orb).toBeNull()
		expect(orbCount(pool)).toBe(0)
	})

	it('feeds a player total that matches the sum of the events', () => {
		const pool = createOrbPool()
		dropBlockBreakXp(pool, 0, 64, 0, BLOCK.IRON_ORE)
		dropSmeltXp(pool, 0, 64, 0, 3)
		dropBreedingXp(pool, 0, 64, 0)
		const state = createXpState(0)
		const pickup = collectOrbs(pool, 0, 64, 0, state)
		expect(pickup.collected).toBe(XP.oreDrop + XP.smeltDrop * 3 + BREEDING.xpOnBreed)
		expect(state.total).toBe(pickup.collected)
		expect(orbCount(pool)).toBe(0)
	})
})
