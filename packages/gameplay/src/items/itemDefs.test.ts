import { describe, expect, it } from 'vitest'
import {
	BLOCK,
	INVENTORY,
	ITEM,
	ITEM_NON_BLOCK_BASE,
	TOOL_CLASS,
	TOOL_TIER,
} from '@voxelcraft/core-types'
import { BLOCK_DEFS } from '../blocks/blockDefs'
import { BLOCKS } from '../blocks/registry'
import { ITEM_DEF_COUNT, ITEM_DEFS, TOOL_DURABILITY, isOwnBlockItem } from './itemDefs'
import { ITEMS, createDefaultItemRegistry, createItemRegistry } from './registry'
import { ALL_ITEM_DEF_COUNT } from '../v2items/itemDefsV2'

const ITEM_KEYS = Object.keys(ITEM) as Array<keyof typeof ITEM>
const TOOL_SUFFIXES = ['_PICKAXE', '_AXE', '_SHOVEL', '_SWORD']
const blockItems = BLOCK_DEFS.filter(isOwnBlockItem)

describe('ITEM_DEFS', () => {
	it('covers every block item and every contract item', () => {
		expect(ITEM_DEF_COUNT).toBe(blockItems.length + ITEM_KEYS.length)
		expect(new Set(ITEM_DEFS.map((def) => def.id)).size).toBe(ITEM_DEF_COUNT)
		expect(new Set(ITEM_DEFS.map((def) => def.name)).size).toBe(ITEM_DEF_COUNT)
	})

	it('keeps registry names aligned with the contract keys', () => {
		for (const key of ITEM_KEYS) {
			const def = ITEMS.byId(ITEM[key])
			expect(def.name.toUpperCase()).toBe(key.toUpperCase())
			expect(def.displayName.length).toBeGreaterThan(0)
			expect(def.id).toBeGreaterThanOrEqual(ITEM_NON_BLOCK_BASE)
		}
	})

	it('keeps block items below the non-block base and linked to their block', () => {
		for (const block of blockItems) {
			const item = ITEMS.byId(block.itemId)
			expect(item.id).toBeLessThan(ITEM_NON_BLOCK_BASE)
			expect(item.placesBlock).toBe(block.id)
			expect(item.maxStack).toBe(INVENTORY.defaultMaxStack)
		}
	})

	it('never gives a block item to air', () => {
		expect(ITEMS.tryById(BLOCK.AIR)).toBeUndefined()
	})

	it('gives every tool a tier, a class and matching durability', () => {
		const toolKeys = ITEM_KEYS.filter((key) => TOOL_SUFFIXES.some((suffix) => key.endsWith(suffix)))
		expect(toolKeys).toHaveLength(16)
		for (const key of toolKeys) {
			const def = ITEMS.byId(ITEM[key])
			expect(def.maxStack).toBe(INVENTORY.toolMaxStack)
			expect(def.toolClass).not.toBe(TOOL_CLASS.None)
			expect(def.tier).not.toBe(TOOL_TIER.None)
			expect(def.durability).toBe(TOOL_DURABILITY[def.tier])
			expect(def.durability).toBeGreaterThan(0)
			expect(def.attackDamage).toBeGreaterThan(0)
			expect(def.placesBlock).toBeNull()
		}
	})

	it('describes shears and sticks', () => {
		const shears = ITEMS.byId(ITEM.SHEARS)
		expect(shears.maxStack).toBe(INVENTORY.toolMaxStack)
		expect(shears.durability).toBeGreaterThan(0)
		expect(shears.toolClass).toBe(TOOL_CLASS.Shears)

		const stick = ITEMS.byId(ITEM.STICK)
		expect(stick.maxStack).toBe(INVENTORY.defaultMaxStack)
		expect(stick.fuelTicks).toBeGreaterThan(0)
		expect(stick.durability).toBe(0)
	})

	it('keeps stack sizes and fuel values sane', () => {
		for (const def of ITEM_DEFS) {
			expect(def.maxStack).toBeGreaterThanOrEqual(1)
			expect(def.maxStack).toBeLessThanOrEqual(INVENTORY.defaultMaxStack)
			expect(def.durability).toBeGreaterThanOrEqual(0)
			expect(def.fuelTicks).toBeGreaterThanOrEqual(0)
			expect(def.food).toBeGreaterThanOrEqual(0)
			if (def.durability > 0) expect(def.maxStack).toBe(INVENTORY.toolMaxStack)
		}
		// Planks and logs burn, stone does not.
		expect(ITEMS.byId(BLOCKS.byId(BLOCK.PLANKS).itemId).fuelTicks).toBeGreaterThan(0)
		expect(ITEMS.byId(BLOCKS.byId(BLOCK.OAK_LOG).itemId).fuelTicks).toBeGreaterThan(0)
		expect(ITEMS.byId(BLOCKS.byId(BLOCK.STONE).itemId).fuelTicks).toBe(0)
	})
})

describe('item registry', () => {
	it('round trips by id and by name', () => {
		expect(ITEMS.count()).toBe(ALL_ITEM_DEF_COUNT)
		expect(ITEMS.all()).toHaveLength(ALL_ITEM_DEF_COUNT)
		for (const def of ITEM_DEFS) {
			expect(ITEMS.byId(def.id)).toBe(def)
			expect(ITEMS.byName(def.name)).toBe(def)
			expect(ITEMS.maxStackOf(def.id)).toBe(def.maxStack)
		}
	})

	it('treats unknown ids as absent instead of guessing', () => {
		expect(ITEMS.tryById(9999)).toBeUndefined()
		expect(() => ITEMS.byId(9999)).toThrow()
	})

	it('builds independent registries', () => {
		const fresh = createDefaultItemRegistry()
		expect(fresh.count()).toBe(ALL_ITEM_DEF_COUNT)
		expect(fresh).not.toBe(ITEMS)

		const empty = createItemRegistry()
		expect(empty.count()).toBe(0)
		empty.define(ITEMS.byId(ITEM.STICK))
		expect(empty.count()).toBe(1)
		expect(empty.byId(ITEM.STICK).name).toBe(ITEMS.byId(ITEM.STICK).name)
	})
})
