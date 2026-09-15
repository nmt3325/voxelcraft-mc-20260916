import type { ItemId } from './ids'
import type { ItemStack } from './items'

export const RECIPE_KIND = {
	Shaped: 'shaped',
	Shapeless: 'shapeless',
	Smelting: 'smelting',
} as const
export type RecipeKind = (typeof RECIPE_KIND)[keyof typeof RECIPE_KIND]

/** 0 means an empty cell. Pattern is row-major, length width * height. */
export interface ShapedRecipe {
	kind: 'shaped'
	id: string
	width: 1 | 2 | 3
	height: 1 | 2 | 3
	pattern: readonly ItemId[]
	result: ItemStack
}

export interface ShapelessRecipe {
	kind: 'shapeless'
	id: string
	ingredients: readonly ItemId[]
	result: ItemStack
}

export interface SmeltingRecipe {
	kind: 'smelting'
	id: string
	input: ItemId
	result: ItemStack
	cookTicks: number
}

export type Recipe = ShapedRecipe | ShapelessRecipe | SmeltingRecipe

export interface RecipeRegistry {
	register(recipe: Recipe): void
	/** grid length must be gridSize * gridSize. Shaped matches are shift-invariant. */
	matchCrafting(
		grid: readonly (ItemStack | null)[],
		gridSize: 2 | 3,
	): ShapedRecipe | ShapelessRecipe | null
	matchSmelting(input: ItemStack): SmeltingRecipe | null
	all(): readonly Recipe[]
}

export const FURNACE_DEFAULT_COOK_TICKS = 200
