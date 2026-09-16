import {
	INVENTORY,
	type InventoryState,
	type ItemStack,
	type RecipeRegistry,
	type ShapedRecipe,
	type ShapelessRecipe,
} from '@voxelcraft/core-types'
import { addStack, type InventoryOptions } from '../inventory/inventory'
import { RECIPES } from './registry'

/**
 * Crafting on top of a grid: the 2x2 grid carried in `InventoryState.crafting`
 * or the 3x3 grid of a crafting table. Crafting consumes exactly one item per
 * occupied cell.
 */
export type CraftableRecipe = ShapedRecipe | ShapelessRecipe

export interface CraftResult {
	recipe: CraftableRecipe
	result: ItemStack
}

export interface InventoryCraftResult extends CraftResult {
	/** The part of the result that did not fit into the inventory. */
	leftover: ItemStack | null
}

export interface CraftOptions extends InventoryOptions {
	registry?: RecipeRegistry
}

export function craftingGridSizeOf(cells: number): 2 | 3 {
	if (cells === INVENTORY.craftGrid2) return 2
	if (cells === INVENTORY.craftGrid3) return 3
	throw new RangeError(`unsupported crafting grid length: ${String(cells)}`)
}

/** The recipe the grid currently forms, without consuming anything. */
export function matchCraftingGrid(
	grid: readonly (ItemStack | null)[],
	registry: RecipeRegistry = RECIPES,
): CraftableRecipe | null {
	return registry.matchCrafting(grid, craftingGridSizeOf(grid.length))
}

/** Consumes one item from every occupied cell. */
export function consumeCraftingGrid(grid: (ItemStack | null)[]): void {
	for (let i = 0; i < grid.length; i++) {
		const cell = grid[i] ?? null
		if (cell === null) continue
		const count = cell.count - 1
		grid[i] = count > 0 ? { item: cell.item, count, damage: cell.damage } : null
	}
}

/** Crafts the grid in place and returns the produced stack. */
export function craftFromGrid(
	grid: (ItemStack | null)[],
	registry: RecipeRegistry = RECIPES,
): CraftResult | null {
	const recipe = matchCraftingGrid(grid, registry)
	if (recipe === null) return null
	consumeCraftingGrid(grid)
	return {
		recipe,
		result: {
			item: recipe.result.item,
			count: recipe.result.count,
			damage: recipe.result.damage,
		},
	}
}

/** The recipe the player's own crafting grid currently forms. */
export function craftableFromInventory(
	state: InventoryState,
	options: CraftOptions = {},
): CraftableRecipe | null {
	return matchCraftingGrid(state.crafting, options.registry ?? RECIPES)
}

/**
 * Crafts what the player's grid holds and stores the result in the inventory.
 * Anything that does not fit comes back as `leftover`.
 */
export function craftFromInventory(
	state: InventoryState,
	options: CraftOptions = {},
): InventoryCraftResult | null {
	const crafted = craftFromGrid(state.crafting, options.registry ?? RECIPES)
	if (crafted === null) return null
	const leftover = addStack(state, crafted.result, options)
	return { recipe: crafted.recipe, result: crafted.result, leftover }
}
