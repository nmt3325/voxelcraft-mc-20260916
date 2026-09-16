import {
	FURNACE_DEFAULT_COOK_TICKS,
	ITEM_V2,
	type ItemId,
	type Recipe,
	type ShapedRecipe,
	type SmeltingRecipe,
} from '@voxelcraft/core-types'
import { RECIPE_DEFS } from '../crafting/recipes'
import { createRecipeRegistry, type GameplayRecipeRegistry } from '../crafting/registry'

/**
 * Additive v2 recipes: bread, baked potato and the v2 meats.
 *
 * `RECIPE_DEFS` is left alone so the v1 count stays frozen. Every id here is
 * new and every smelting input is unique across the merged table, because the
 * shared registry rejects duplicate recipe ids and duplicate smelting inputs.
 */
function shaped(
	id: string,
	width: 1 | 2 | 3,
	height: 1 | 2 | 3,
	pattern: readonly ItemId[],
	result: ItemId,
	count = 1,
): ShapedRecipe {
	return { kind: 'shaped', id, width, height, pattern, result: { item: result, count, damage: 0 } }
}

function smelting(
	id: string,
	input: ItemId,
	result: ItemId,
	count = 1,
	cookTicks = FURNACE_DEFAULT_COOK_TICKS,
): SmeltingRecipe {
	return { kind: 'smelting', id, input, result: { item: result, count, damage: 0 }, cookTicks }
}

/** Recipe ids of the v2 table. None of them exists in the v1 table. */
export const RECIPE_V2_ID = {
	BreadFromWheat: 'bread_from_wheat',
	BakePotato: 'bake_potato',
	CookBeefV2: 'cook_beef_v2',
	CookPorkV2: 'cook_pork_v2',
	CookChickenV2: 'cook_chicken_v2',
} as const
export type RecipeV2Id = (typeof RECIPE_V2_ID)[keyof typeof RECIPE_V2_ID]

/** Bread is three wheat in a row, so the pattern is 3x1. */
const W: ItemId = ITEM_V2.WHEAT

/** Every additive v2 recipe, in registration order. */
export const RECIPE_V2_DEFS: readonly Recipe[] = Object.freeze([
	shaped(RECIPE_V2_ID.BreadFromWheat, 3, 1, [W, W, W], ITEM_V2.BREAD),
	smelting(RECIPE_V2_ID.BakePotato, ITEM_V2.POTATO, ITEM_V2.BAKED_POTATO),
	smelting(RECIPE_V2_ID.CookBeefV2, ITEM_V2.RAW_BEEF, ITEM_V2.COOKED_BEEF),
	smelting(RECIPE_V2_ID.CookPorkV2, ITEM_V2.RAW_PORK, ITEM_V2.COOKED_PORK),
	smelting(RECIPE_V2_ID.CookChickenV2, ITEM_V2.RAW_CHICKEN, ITEM_V2.COOKED_CHICKEN),
])
export const RECIPE_V2_DEF_COUNT = RECIPE_V2_DEFS.length

/** v1 and v2 recipes in one registry. The shared `RECIPES` stays v1 only. */
export function createV2RecipeRegistry(): GameplayRecipeRegistry {
	return createRecipeRegistry([...RECIPE_DEFS, ...RECIPE_V2_DEFS])
}
