import { createRecipeRegistry, type GameplayRecipeRegistry } from '../crafting/registry'
import { ALL_RECIPE_DEFS } from './recipeDefsV2'

/**
 * The v2 recipe registry factory.
 *
 * The recipe data moved to `recipeDefsV2.ts` so the shipped `RECIPES` registry
 * can register it without importing the factory that builds a registry. This
 * factory therefore now builds exactly the table the default registry ships:
 * it used to hold five recipes the shipped registry was missing.
 */
export function createV2RecipeRegistry(): GameplayRecipeRegistry {
	return createRecipeRegistry(ALL_RECIPE_DEFS)
}

export {
	ALL_RECIPE_DEFS,
	ALL_RECIPE_DEF_COUNT,
	RECIPE_V2_DEFS,
	RECIPE_V2_DEF_COUNT,
	RECIPE_V2_ID,
	type RecipeV2Id,
} from './recipeDefsV2'
