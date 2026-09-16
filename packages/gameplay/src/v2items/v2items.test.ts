import { describe, expect, it } from 'vitest'
import {
	FARMING,
	INVENTORY,
	ITEM,
	ITEM_V2,
	ITEM_V2_BASE,
	ITEM_V2_MAX,
	type ItemId,
	type ItemStack,
	type ItemV2KeyName,
} from '@voxelcraft/core-types'
import { RECIPE_DEF_COUNT, RECIPE_DEFS } from '../crafting/recipes'
import { RECIPES } from '../crafting/registry'
import { ITEM_DEF_COUNT, ITEM_DEFS } from '../items/itemDefs'
import { ITEMS } from '../items/registry'
import { ITEM_V2_DEF_COUNT, ITEM_V2_DEFS, createV2ItemRegistry, itemV2NameOf } from './itemDefsV2'
import {
	RECIPE_V2_DEF_COUNT,
	RECIPE_V2_DEFS,
	RECIPE_V2_ID,
	createV2RecipeRegistry,
} from './recipesV2'

const ITEM_V2_KEYS = Object.keys(ITEM_V2) as ItemV2KeyName[]

const V2_FOODS: readonly ItemId[] = [
	ITEM_V2.WHEAT,
	ITEM_V2.BREAD,
	ITEM_V2.CARROT,
	ITEM_V2.POTATO,
	ITEM_V2.BAKED_POTATO,
	ITEM_V2.RAW_BEEF,
	ITEM_V2.COOKED_BEEF,
	ITEM_V2.RAW_PORK,
	ITEM_V2.COOKED_PORK,
	ITEM_V2.RAW_CHICKEN,
	ITEM_V2.COOKED_CHICKEN,
	ITEM_V2.MUTTON,
]

function stack(item: ItemId, count = 1): ItemStack {
	return { item, count, damage: 0 }
}

/** Nine slot crafting grid, where 0 is an empty slot. */
function grid(slots: readonly number[]): (ItemStack | null)[] {
	return slots.map((item) => (item === 0 ? null : stack(item)))
}

describe('ITEM_V2_DEFS', () => {
	it('defines every ITEM_V2 key exactly once', () => {
		expect(ITEM_V2_DEF_COUNT).toBe(ITEM_V2_KEYS.length)
		expect(ITEM_V2_DEFS).toHaveLength(ITEM_V2_DEF_COUNT)

		const byId = new Map(ITEM_V2_DEFS.map((def) => [def.id, def]))
		for (const key of ITEM_V2_KEYS) {
			const def = byId.get(ITEM_V2[key])
			expect(def, key).toBeDefined()
			expect(def?.name).toBe(itemV2NameOf(key))
			expect(def?.texture).toBe(itemV2NameOf(key))
			expect((def?.displayName ?? '').length).toBeGreaterThan(0)
		}
	})

	it('keeps ids and names unique and inside the v2 band', () => {
		const ids = ITEM_V2_DEFS.map((def) => def.id)
		const names = ITEM_V2_DEFS.map((def) => def.name)
		expect(new Set(ids).size).toBe(ITEM_V2_DEF_COUNT)
		expect(new Set(names).size).toBe(ITEM_V2_DEF_COUNT)
		expect(Math.min(...ids)).toBe(305)
		expect(Math.max(...ids)).toBe(322)

		for (const def of ITEM_V2_DEFS) {
			expect(def.id).toBeGreaterThanOrEqual(ITEM_V2_BASE)
			expect(def.id).toBeLessThanOrEqual(ITEM_V2_MAX)
			expect(def.maxStack).toBeGreaterThanOrEqual(1)
			expect(def.maxStack).toBeLessThanOrEqual(INVENTORY.defaultMaxStack)
			if (def.durability > 0) expect(def.maxStack).toBe(INVENTORY.toolMaxStack)
		}
	})

	it('feeds the player and arms the farming hoe', () => {
		const byId = new Map(ITEM_V2_DEFS.map((def) => [def.id, def]))
		for (const id of V2_FOODS) {
			expect(byId.get(id)?.food, String(id)).toBeGreaterThan(0)
		}
		expect(byId.get(ITEM_V2.COOKED_BEEF)?.food ?? 0).toBeGreaterThan(
			byId.get(ITEM_V2.RAW_BEEF)?.food ?? 0,
		)
		expect(byId.get(ITEM_V2.BAKED_POTATO)?.food ?? 0).toBeGreaterThan(
			byId.get(ITEM_V2.POTATO)?.food ?? 0,
		)

		expect(FARMING.hoeItem).toBe(ITEM_V2.FLINT_AND_STEEL)
		const hoe = byId.get(FARMING.hoeItem)
		expect(hoe?.maxStack).toBe(INVENTORY.toolMaxStack)
		expect(hoe?.durability ?? 0).toBeGreaterThan(0)
	})
})

describe('createV2ItemRegistry', () => {
	it('resolves both v1 and v2 ids', () => {
		const items = createV2ItemRegistry()

		expect(items.count()).toBe(ITEM_DEF_COUNT + ITEM_V2_DEF_COUNT)
		expect(items.byId(ITEM.RAW_BEEF).name).toBe('raw_beef')
		expect(items.byId(ITEM_V2.BREAD).name).toBe('bread')
		expect(items.byName('bread')?.id).toBe(ITEM_V2.BREAD)
		expect(items.has(ITEM_V2.WHEAT_SEEDS)).toBe(true)
		expect(items.maxStackOf(ITEM_V2.FLINT_AND_STEEL)).toBe(INVENTORY.toolMaxStack)
		expect(items.maxStackOf(ITEM_V2.WHEAT)).toBe(INVENTORY.defaultMaxStack)
	})

	it('suffixes only the v2 twins of v1 names', () => {
		const items = createV2ItemRegistry()

		expect(items.byId(ITEM.LEATHER).name).toBe('leather')
		expect(items.byId(ITEM_V2.LEATHER).name).toBe('leather_v2')
		expect(items.byId(ITEM_V2.RAW_BEEF).name).toBe('raw_beef_v2')
		expect(items.byId(ITEM_V2.MUTTON).name).toBe('mutton')
	})

	it('leaves the default item table untouched', () => {
		expect(ITEM_DEF_COUNT).toBe(ITEM_DEFS.length)
		expect(ITEMS.count()).toBe(ITEM_DEF_COUNT)
		expect(ITEMS.tryById(ITEM_V2.BREAD)).toBeUndefined()
		expect(ITEMS.has(ITEM_V2.FLINT_AND_STEEL)).toBe(false)
		expect(ITEM_DEFS.some((def) => def.id >= ITEM_V2_BASE)).toBe(false)
	})
})

describe('createV2RecipeRegistry', () => {
	it('registers every v2 recipe next to the v1 table', () => {
		const recipes = createV2RecipeRegistry()

		expect(RECIPE_V2_DEF_COUNT).toBe(RECIPE_V2_DEFS.length)
		expect(RECIPE_V2_DEF_COUNT).toBeGreaterThanOrEqual(4)
		expect(recipes.count()).toBe(RECIPE_DEF_COUNT + RECIPE_V2_DEF_COUNT)
		for (const id of Object.values(RECIPE_V2_ID)) {
			expect(recipes.byId(id), id).toBeDefined()
		}
		expect(recipes.byId('crafting_table')).toBeDefined()
		expect(RECIPES.count()).toBe(RECIPE_DEF_COUNT)
		expect(RECIPES.byId(RECIPE_V2_ID.BreadFromWheat)).toBeUndefined()
	})

	it('only outputs v2 items and never reuses a v1 recipe id', () => {
		const v1Ids = new Set(RECIPE_DEFS.map((recipe) => recipe.id))
		for (const recipe of RECIPE_V2_DEFS) {
			expect(v1Ids.has(recipe.id)).toBe(false)
			expect(recipe.result.item).toBeGreaterThanOrEqual(ITEM_V2_BASE)
			expect(recipe.result.item).toBeLessThanOrEqual(ITEM_V2_MAX)
		}
	})

	it('bakes bread from three wheat', () => {
		const recipes = createV2RecipeRegistry()
		const w = ITEM_V2.WHEAT

		const match = recipes.matchCrafting(grid([w, w, w, 0, 0, 0, 0, 0, 0]), 3)
		expect(match?.id).toBe(RECIPE_V2_ID.BreadFromWheat)
		expect(match?.result.item).toBe(ITEM_V2.BREAD)

		expect(recipes.matchCrafting(grid([w, w, 0, 0, 0, 0, 0, 0, 0]), 3)).toBeNull()
		expect(recipes.matchCrafting(grid([0, 0, 0, 0, w, 0, 0, 0, 0]), 3)).toBeNull()
	})

	it('cooks the new smelting inputs and keeps the v1 ones', () => {
		const recipes = createV2RecipeRegistry()

		expect(recipes.matchSmelting(stack(ITEM_V2.POTATO))?.id).toBe(RECIPE_V2_ID.BakePotato)
		expect(recipes.matchSmelting(stack(ITEM_V2.POTATO))?.result.item).toBe(ITEM_V2.BAKED_POTATO)
		expect(recipes.matchSmelting(stack(ITEM_V2.RAW_BEEF))?.id).toBe(RECIPE_V2_ID.CookBeefV2)
		expect(recipes.matchSmelting(stack(ITEM_V2.RAW_PORK))?.id).toBe(RECIPE_V2_ID.CookPorkV2)
		expect(recipes.matchSmelting(stack(ITEM_V2.RAW_CHICKEN))?.id).toBe(RECIPE_V2_ID.CookChickenV2)
		expect(recipes.matchSmelting(stack(ITEM.RAW_BEEF))?.id).toBe('cook_beef')
		expect(recipes.matchSmelting(stack(ITEM_V2.BREAD))).toBeNull()
	})
})
