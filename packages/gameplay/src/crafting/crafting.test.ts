import { describe, expect, it } from 'vitest'
import {
	BLOCK,
	FURNACE_DEFAULT_COOK_TICKS,
	ITEM,
	type ItemStack,
} from '@voxelcraft/core-types'
import {
	createInventoryState,
	getSlot,
	resizeCraftingGrid,
	setCraftingSlot,
} from '../inventory/inventory'
import { craftFromGrid, craftFromInventory, matchCraftingGrid } from './craft'
import { RECIPE_DEFS, RECIPE_DEF_COUNT } from './recipes'
import { ALL_RECIPE_DEF_COUNT } from '../v2items/recipeDefsV2'
import { RECIPES, createRecipeRegistry } from './registry'

function stack(item: number, count = 1, damage = 0): ItemStack {
	return { item, count, damage }
}

function emptyGrid(size: 2 | 3): (ItemStack | null)[] {
	return new Array<ItemStack | null>(size * size).fill(null)
}

function place(
	grid: (ItemStack | null)[],
	size: number,
	x: number,
	y: number,
	cell: ItemStack,
): void {
	grid[y * size + x] = cell
}

describe('recipe registry', () => {
	it('registers the whole v1 and v2 tables', () => {
		expect(RECIPE_DEF_COUNT).toBe(RECIPE_DEFS.length)
		expect(RECIPES.count()).toBe(ALL_RECIPE_DEF_COUNT)
		expect(RECIPES.all()).toHaveLength(ALL_RECIPE_DEF_COUNT)
		expect(RECIPES.byId('crafting_table')?.result.item).toBe(BLOCK.CRAFTING_TABLE)
		expect(RECIPES.byId('no_such_recipe')).toBeUndefined()
	})

	it('covers every required recipe', () => {
		const required = [
			'planks_from_oak_log',
			'stick',
			'crafting_table',
			'furnace',
			'chest',
			'torch_from_coal',
			'wooden_door',
			'bed',
			'redstone_lamp',
			'lever',
			'stone_button',
			'wooden_pressure_plate',
			'piston',
		]
		for (const id of required) expect(RECIPES.byId(id), id).toBeDefined()
		for (const tier of ['wooden', 'stone', 'iron', 'diamond']) {
			for (const tool of ['pickaxe', 'axe', 'shovel', 'sword']) {
				const id = `${tier}_${tool}`
				expect(RECIPES.byId(id), id).toBeDefined()
			}
		}
	})
})

describe('shaped matching', () => {
	it('matches the same shape anywhere in the 3x3 grid', () => {
		for (let y = 0; y < 2; y++) {
			for (let x = 0; x < 3; x++) {
				const grid = emptyGrid(3)
				place(grid, 3, x, y, stack(ITEM.COAL))
				place(grid, 3, x, y + 1, stack(ITEM.STICK))
				const recipe = matchCraftingGrid(grid)
				expect(recipe?.id).toBe('torch_from_coal')
				expect(recipe?.result).toEqual(stack(BLOCK.TORCH, 4))
			}
		}
	})

	it('rejects a flipped shape or an extra ingredient', () => {
		const flipped = emptyGrid(3)
		place(flipped, 3, 0, 0, stack(ITEM.STICK))
		place(flipped, 3, 0, 1, stack(ITEM.COAL))
		expect(matchCraftingGrid(flipped)).toBeNull()

		const extra = emptyGrid(3)
		place(extra, 3, 0, 0, stack(ITEM.COAL))
		place(extra, 3, 0, 1, stack(ITEM.STICK))
		place(extra, 3, 2, 2, stack(BLOCK.DIRT))
		expect(matchCraftingGrid(extra)).toBeNull()
	})

	it('matches 2x2 recipes in the player grid', () => {
		const table = emptyGrid(2)
		for (let i = 0; i < 4; i++) table[i] = stack(BLOCK.PLANKS)
		expect(matchCraftingGrid(table)?.id).toBe('crafting_table')

		const log = emptyGrid(2)
		log[2] = stack(BLOCK.OAK_LOG)
		expect(matchCraftingGrid(log)?.id).toBe('planks_from_oak_log')
	})

	it('tells the tool tiers apart', () => {
		const grid = emptyGrid(3)
		place(grid, 3, 0, 0, stack(ITEM.DIAMOND))
		place(grid, 3, 1, 0, stack(ITEM.DIAMOND))
		place(grid, 3, 2, 0, stack(ITEM.DIAMOND))
		place(grid, 3, 1, 1, stack(ITEM.STICK))
		place(grid, 3, 1, 2, stack(ITEM.STICK))
		expect(matchCraftingGrid(grid)?.result.item).toBe(ITEM.DIAMOND_PICKAXE)
	})
})

describe('shapeless matching', () => {
	it('ignores the order of the ingredients', () => {
		const registry = createRecipeRegistry([
			{
				kind: 'shapeless',
				id: 'test_mix',
				ingredients: [ITEM.IRON_INGOT, ITEM.DIAMOND, ITEM.STICK],
				result: stack(ITEM.SHEARS, 1),
			},
		])
		const orders = [
			[ITEM.IRON_INGOT, ITEM.DIAMOND, ITEM.STICK],
			[ITEM.STICK, ITEM.IRON_INGOT, ITEM.DIAMOND],
			[ITEM.DIAMOND, ITEM.STICK, ITEM.IRON_INGOT],
		]
		for (const order of orders) {
			const grid = emptyGrid(3)
			grid[4] = stack(order[0])
			grid[0] = stack(order[1])
			grid[8] = stack(order[2])
			expect(registry.matchCrafting(grid, 3)?.id).toBe('test_mix')
		}

		const missing = emptyGrid(3)
		missing[0] = stack(ITEM.IRON_INGOT)
		missing[1] = stack(ITEM.DIAMOND)
		expect(registry.matchCrafting(missing, 3)).toBeNull()
	})

	it('requires the exact multiset when an ingredient repeats', () => {
		const registry = createRecipeRegistry([
			{
				kind: 'shapeless',
				id: 'double_coal',
				ingredients: [ITEM.COAL, ITEM.COAL],
				result: stack(BLOCK.COAL_BLOCK, 1),
			},
		])
		const two = emptyGrid(2)
		two[0] = stack(ITEM.COAL)
		two[3] = stack(ITEM.COAL)
		expect(registry.matchCrafting(two, 2)?.id).toBe('double_coal')

		const one = emptyGrid(2)
		one[0] = stack(ITEM.COAL)
		expect(registry.matchCrafting(one, 2)).toBeNull()
	})
})

describe('smelting recipes', () => {
	it('matches furnace inputs by item', () => {
		const recipe = RECIPES.matchSmelting(stack(BLOCK.IRON_ORE))
		expect(recipe?.result).toEqual(stack(ITEM.IRON_INGOT, 1))
		expect(recipe?.cookTicks).toBe(FURNACE_DEFAULT_COOK_TICKS)
		expect(RECIPES.matchSmelting(stack(BLOCK.DIRT))).toBeNull()
		expect(RECIPES.matchSmelting(stack(BLOCK.IRON_ORE, 0))).toBeNull()
	})
})

describe('crafting', () => {
	it('consumes one item per occupied cell', () => {
		const grid = emptyGrid(3)
		place(grid, 3, 0, 0, stack(BLOCK.PLANKS, 3))
		place(grid, 3, 0, 1, stack(BLOCK.PLANKS, 1))
		const crafted = craftFromGrid(grid)
		expect(crafted?.recipe.id).toBe('stick')
		expect(crafted?.result).toEqual(stack(ITEM.STICK, 4))
		expect(grid[0]).toEqual(stack(BLOCK.PLANKS, 2))
		expect(grid[3]).toBeNull()
	})

	it('stores the crafted stack in the inventory', () => {
		const state = createInventoryState()
		resizeCraftingGrid(state, 3)
		for (let i = 0; i < 9; i++) setCraftingSlot(state, i, stack(BLOCK.COBBLESTONE, 1))
		setCraftingSlot(state, 4, null)
		const crafted = craftFromInventory(state)
		expect(crafted?.recipe.id).toBe('furnace')
		expect(crafted?.leftover).toBeNull()
		expect(getSlot(state, 0)).toEqual(stack(BLOCK.FURNACE, 1))
		expect(state.crafting.every((cell) => cell === null)).toBe(true)
	})

	it('returns null when the grid matches nothing', () => {
		const grid = emptyGrid(2)
		grid[0] = stack(BLOCK.DIRT)
		grid[1] = stack(BLOCK.SAND)
		expect(craftFromGrid(grid)).toBeNull()
		expect(grid[0]).toEqual(stack(BLOCK.DIRT))
	})

	it('validates grid sizes and recipe definitions', () => {
		expect(() => matchCraftingGrid(new Array<ItemStack | null>(5).fill(null))).toThrow(RangeError)
		expect(() => RECIPES.matchCrafting(emptyGrid(2), 3)).toThrow(RangeError)
		expect(() =>
			createRecipeRegistry([
				{
					kind: 'shaped',
					id: 'bad_pattern',
					width: 2,
					height: 2,
					pattern: [BLOCK.PLANKS],
					result: stack(BLOCK.CHEST, 1),
				},
			]),
		).toThrow(RangeError)
		expect(() => createRecipeRegistry([RECIPE_DEFS[0], RECIPE_DEFS[0]])).toThrow(
			/duplicate recipe id/,
		)
	})
})
