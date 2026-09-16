import { describe, expect, it } from 'vitest'
import {
	BLOCK,
	BLOCK_V2,
	COMBAT,
	ENCHANT_MAX_LEVEL,
	ENCHANTING,
	ENCHANTMENT,
	EVENT_V2,
	ITEM,
	TOOL_CLASS,
	XP,
	enchantLevelCost,
	makeRng,
	type BlockDef,
	type EventBusV2,
} from '@voxelcraft/core-types'
import { BLOCKS } from '../blocks/registry'
import { createXpState } from '../experience'
import { makeStack } from '../inventory/stacks'
import {
	addEnchantment,
	applicableEnchantments,
	applyOffer,
	arrowDamage,
	consumeDurability,
	countBookshelves,
	durabilityConsumed,
	enchantedBreakTime,
	enchantedDrops,
	levelOf,
	meleeDamage,
	reduceDamage,
	rollOffers,
	type EnchantOffer,
	type EnchantWorld,
	type EnchantmentSet,
} from './index'

function blockDef(id: number): BlockDef {
	const def = BLOCKS.tryById(id)
	if (def === undefined) throw new Error(`missing block def ${id}`)
	return def
}

const PICK = makeStack(ITEM.IRON_PICKAXE)
const SWORD = makeStack(ITEM.DIAMOND_SWORD)
const COAL_ORE = blockDef(BLOCK.COAL_ORE)
const STONE = blockDef(BLOCK.STONE)
const PICK_POOL = applicableEnchantments(TOOL_CLASS.Pickaxe)

function shelfWorld(positions: ReadonlyArray<readonly [number, number, number]>): EnchantWorld {
	const filled = new Set(positions.map(([x, y, z]) => `${x},${y},${z}`))
	return {
		getBlock: (x, y, z) => (filled.has(`${x},${y},${z}`) ? BLOCK_V2.BOOKSHELF : BLOCK.AIR),
	}
}

function recorder(): {
	bus: EventBusV2
	applied: Array<{ enchantment: number; level: number; cost: number }>
} {
	const applied: Array<{ enchantment: number; level: number; cost: number }> = []
	const bus: EventBusV2 = {
		on() {
			return () => undefined
		},
		emit(name, payload) {
			if (name !== EVENT_V2.EnchantApplied) return
			const event = payload as unknown as { enchantment: number; level: number; cost: number }
			applied.push({ enchantment: event.enchantment, level: event.level, cost: event.cost })
		},
		clear() {
			applied.length = 0
		},
	}
	return { bus, applied }
}

describe('enchantment sets', () => {
	it('clamps levels to the contract maximum', () => {
		const efficiency = addEnchantment([], ENCHANTMENT.Efficiency, 99) ?? []
		expect(levelOf(efficiency, ENCHANTMENT.Efficiency)).toBe(
			ENCHANT_MAX_LEVEL[ENCHANTMENT.Efficiency],
		)
		const silk = addEnchantment([], ENCHANTMENT.SilkTouch, 5) ?? []
		expect(levelOf(silk, ENCHANTMENT.SilkTouch)).toBe(1)
		const floored = addEnchantment([], ENCHANTMENT.Unbreaking, 0) ?? []
		expect(levelOf(floored, ENCHANTMENT.Unbreaking)).toBe(1)
	})

	it('keeps the higher level for a repeated id', () => {
		const high = addEnchantment([], ENCHANTMENT.Unbreaking, 3) ?? []
		expect(levelOf(addEnchantment(high, ENCHANTMENT.Unbreaking, 1) ?? [], ENCHANTMENT.Unbreaking)).toBe(3)
		const low = addEnchantment([], ENCHANTMENT.Unbreaking, 1) ?? []
		const raised = addEnchantment(low, ENCHANTMENT.Unbreaking, 3) ?? []
		expect(levelOf(raised, ENCHANTMENT.Unbreaking)).toBe(3)
		expect(raised).toHaveLength(1)
	})

	it('rejects conflicting ids in both directions', () => {
		const fortune = addEnchantment([], ENCHANTMENT.Fortune, 2) ?? []
		expect(addEnchantment(fortune, ENCHANTMENT.SilkTouch, 1)).toBeNull()
		const silk = addEnchantment([], ENCHANTMENT.SilkTouch, 1) ?? []
		expect(addEnchantment(silk, ENCHANTMENT.Fortune, 2)).toBeNull()
	})

	it('filters armour-only ids out of every tool class', () => {
		expect(PICK_POOL).toContain(ENCHANTMENT.Efficiency)
		expect(PICK_POOL).toContain(ENCHANTMENT.Fortune)
		expect(PICK_POOL).not.toContain(ENCHANTMENT.Protection)
		expect(PICK_POOL).not.toContain(ENCHANTMENT.Power)
		expect(PICK_POOL).not.toContain(ENCHANTMENT.FeatherFalling)
		expect(PICK_POOL).not.toContain(ENCHANTMENT.Sharpness)
		expect(applicableEnchantments(TOOL_CLASS.Sword)).toEqual([
			ENCHANTMENT.Unbreaking,
			ENCHANTMENT.Sharpness,
		])
		expect(applicableEnchantments(TOOL_CLASS.None)).toEqual([])
	})
})

describe('bookshelf counting', () => {
	it('counts shelves in range on both layers and ignores far ones', () => {
		const world = shelfWorld([
			[2, 0, 0],
			[0, 1, -2],
			[3, 0, 0],
			[0, 0, 3],
			[0, 2, 0],
		])
		expect(countBookshelves(world, 0, 0, 0)).toBe(2)
	})

	it('caps the count at the contract maximum', () => {
		const positions: Array<readonly [number, number, number]> = []
		for (let dx = -2; dx <= 2; dx++) {
			for (let dz = -2; dz <= 2; dz++) {
				positions.push([dx, 0, dz], [dx, 1, dz])
			}
		}
		expect(countBookshelves(shelfWorld(positions), 0, 0, 0)).toBe(ENCHANTING.maxBookshelves)
	})
})

describe('table offers', () => {
	it('is a pure function of seed, bookshelves and slot', () => {
		const input = { seed: 12345, bookshelves: 7, toolClass: TOOL_CLASS.Pickaxe }
		expect(rollOffers(input)).toEqual(rollOffers(input))
		expect(rollOffers({ ...input, seed: 987 })).not.toEqual(rollOffers(input))
		expect(rollOffers({ ...input, bookshelves: 12 })).not.toEqual(rollOffers(input))
	})

	it('returns one offer per slot with the contract costs', () => {
		for (const shelves of [0, 1, 5, 15]) {
			const offers = rollOffers({ seed: 42, bookshelves: shelves, toolClass: TOOL_CLASS.Pickaxe })
			expect(offers).toHaveLength(ENCHANTING.offerSlots)
			expect(offers.map((offer) => offer.lapisCost)).toEqual([1, 2, 3])
			offers.forEach((offer, slot) => {
				expect(offer.slot).toBe(slot)
				expect(offer.lapisCost).toBe(ENCHANTING.lapisPerSlot[slot])
				expect(offer.levelCost).toBe(enchantLevelCost(shelves, slot))
				expect(offer.levelCost).toBeLessThanOrEqual(XP.maxLevel)
				expect(offer.levelCost).toBeGreaterThanOrEqual(1)
			})
		}
	})

	it('clamps bookshelf counts to 0..15', () => {
		const base = { seed: 7, toolClass: TOOL_CLASS.Pickaxe }
		const capped = rollOffers({ ...base, bookshelves: ENCHANTING.maxBookshelves })
		expect(rollOffers({ ...base, bookshelves: 16 })).toEqual(capped)
		expect(rollOffers({ ...base, bookshelves: 99 })).toEqual(capped)
		const floored = rollOffers({ ...base, bookshelves: 0 })
		expect(rollOffers({ ...base, bookshelves: -8 })).toEqual(floored)
	})

	it('never rolls conflicts, over-levels or foreign ids', () => {
		for (let seed = 0; seed < 40; seed++) {
			for (let shelves = 0; shelves <= ENCHANTING.maxBookshelves; shelves++) {
				const offers = rollOffers({ seed, bookshelves: shelves, toolClass: TOOL_CLASS.Pickaxe })
				for (const offer of offers) {
					const ids = offer.enchantments.map((entry) => entry.id)
					expect(ids.includes(ENCHANTMENT.Fortune) && ids.includes(ENCHANTMENT.SilkTouch)).toBe(false)
					expect(new Set(ids).size).toBe(ids.length)
					for (const entry of offer.enchantments) {
						expect(PICK_POOL).toContain(entry.id)
						expect(entry.level).toBeGreaterThanOrEqual(1)
						expect(entry.level).toBeLessThanOrEqual(ENCHANT_MAX_LEVEL[entry.id])
					}
				}
			}
		}
	})
})

describe('applying an offer', () => {
	const offer: EnchantOffer = {
		slot: 1,
		levelCost: 5,
		lapisCost: 2,
		enchantments: [
			{ id: ENCHANTMENT.Efficiency, level: 3 },
			{ id: ENCHANTMENT.Fortune, level: 2 },
		],
	}

	it('spends the level cost and emits one event per enchantment', () => {
		const xp = createXpState(1000)
		const before = xp.level
		const { bus, applied } = recorder()
		const result = applyOffer(xp, PICK, offer, { lapis: 3, bus })
		expect(result.ok).toBe(true)
		expect(xp.level).toBe(before - offer.levelCost)
		expect(levelOf(result.set, ENCHANTMENT.Efficiency)).toBe(3)
		expect(levelOf(result.set, ENCHANTMENT.Fortune)).toBe(2)
		expect(applied).toEqual([
			{ enchantment: ENCHANTMENT.Efficiency, level: 3, cost: 5 },
			{ enchantment: ENCHANTMENT.Fortune, level: 2, cost: 5 },
		])
	})

	it('rejects without enough lapis or levels and spends nothing', () => {
		const rich = createXpState(1000)
		const richLevel = rich.level
		const noLapis = applyOffer(rich, PICK, offer, { lapis: 1 })
		expect(noLapis.ok).toBe(false)
		expect(noLapis.reason).toBe('lapis')
		expect(noLapis.set).toEqual([])
		expect(rich.level).toBe(richLevel)

		const poor = createXpState(0)
		const noLevels = applyOffer(poor, PICK, offer, { lapis: 3 })
		expect(noLevels.ok).toBe(false)
		expect(noLevels.reason).toBe('levels')
		expect(poor.total).toBe(0)
	})

	it('skips an enchantment that conflicts with the item it already has', () => {
		const xp = createXpState(1000)
		const silkOffer: EnchantOffer = {
			slot: 0,
			levelCost: 1,
			lapisCost: 1,
			enchantments: [{ id: ENCHANTMENT.SilkTouch, level: 1 }],
		}
		const existing: EnchantmentSet = [{ id: ENCHANTMENT.Fortune, level: 2 }]
		const result = applyOffer(xp, PICK, silkOffer, { lapis: 1, set: existing })
		expect(result.ok).toBe(true)
		expect(levelOf(result.set, ENCHANTMENT.SilkTouch)).toBe(0)
		expect(levelOf(result.set, ENCHANTMENT.Fortune)).toBe(2)
	})
})

describe('applied effects', () => {
	it('Efficiency lowers break time', () => {
		const plain = enchantedBreakTime(PICK, STONE, [])
		const fast = enchantedBreakTime(PICK, STONE, [{ id: ENCHANTMENT.Efficiency, level: 5 }])
		expect(fast).toBeLessThan(plain)
		expect(fast).toBeCloseTo(plain / 2.5)
	})

	it('rolls drop tables with and without Fortune', () => {
		expect(enchantedDrops(COAL_ORE, [], makeRng(11), PICK)).toEqual([
			{ item: ITEM.COAL, count: 1, damage: 0 },
		])

		const fortune: EnchantmentSet = [{ id: ENCHANTMENT.Fortune, level: 3 }]
		const rng = makeRng(11)
		let total = 0
		for (let i = 0; i < 64; i++) {
			const drops = enchantedDrops(COAL_ORE, fortune, rng, PICK)
			expect(drops).toHaveLength(1)
			expect(drops[0].item).toBe(ITEM.COAL)
			expect(drops[0].count).toBeGreaterThanOrEqual(1)
			expect(drops[0].count).toBeLessThanOrEqual(4)
			total += drops[0].count
		}
		expect(total).toBeGreaterThan(64)
	})

	it('SilkTouch yields the block itself exactly once', () => {
		const silk: EnchantmentSet = [{ id: ENCHANTMENT.SilkTouch, level: 1 }]
		expect(enchantedDrops(COAL_ORE, silk, makeRng(3), PICK)).toEqual([
			{ item: COAL_ORE.itemId, count: 1, damage: 0 },
		])
		expect(enchantedDrops(STONE, silk, makeRng(3), PICK)).toEqual([
			{ item: STONE.itemId, count: 1, damage: 0 },
		])

		const mined = enchantedDrops(STONE, [], makeRng(3), PICK)
		expect(mined).toHaveLength(1)
		expect(mined[0].item).toBe(STONE.drops[0].item)
		expect(mined[0].item).not.toBe(STONE.itemId)
	})

	it('drops nothing when the held tool cannot harvest the block', () => {
		expect(enchantedDrops(COAL_ORE, [], makeRng(5), null)).toEqual([])
		expect(enchantedDrops(STONE, [], makeRng(5), null)).toEqual([])
	})

	it('Unbreaking lowers the durability consumed over a fixed roll sequence', () => {
		const consumed = (set: EnchantmentSet): number => {
			const rng = makeRng(2024)
			let total = 0
			for (let i = 0; i < 256; i++) total += durabilityConsumed(set, rng)
			return total
		}
		const plain = consumed([])
		const light = consumed([{ id: ENCHANTMENT.Unbreaking, level: 1 }])
		const heavy = consumed([{ id: ENCHANTMENT.Unbreaking, level: 3 }])
		expect(plain).toBe(256)
		expect(light).toBeLessThan(plain)
		expect(heavy).toBeLessThan(light)
		expect(heavy).toBeGreaterThan(0)
		expect(consumeDurability(PICK, [], makeRng(1))?.damage).toBe(1)
	})

	it('Sharpness and Power raise damage', () => {
		const base = meleeDamage(SWORD, [])
		expect(meleeDamage(SWORD, [{ id: ENCHANTMENT.Sharpness, level: 5 }])).toBeGreaterThan(base)
		expect(meleeDamage(SWORD, [{ id: ENCHANTMENT.Sharpness, level: 3 }])).toBeCloseTo(base + 2)
		expect(arrowDamage([])).toBe(COMBAT.arrowDamage)
		expect(arrowDamage([{ id: ENCHANTMENT.Power, level: 5 }])).toBeCloseTo(COMBAT.arrowDamage * 2.25)
	})

	it('Protection and FeatherFalling lower incoming damage', () => {
		const protection: EnchantmentSet = [{ id: ENCHANTMENT.Protection, level: 4 }]
		expect(reduceDamage(10, protection, { fall: false })).toBeCloseTo(8.4)
		expect(reduceDamage(10, protection, { fall: true })).toBeCloseTo(8.4)

		const feather: EnchantmentSet = [{ id: ENCHANTMENT.FeatherFalling, level: 4 }]
		expect(reduceDamage(10, feather, { fall: true })).toBeCloseTo(5.2)
		expect(reduceDamage(10, feather, { fall: false })).toBe(10)
		expect(reduceDamage(0, protection, { fall: true })).toBe(0)
		expect(reduceDamage(10, [], { fall: true })).toBe(10)
	})
})
