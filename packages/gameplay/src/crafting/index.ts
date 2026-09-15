export { RECIPE_DEFS, RECIPE_DEF_COUNT } from './recipes'
export {
	RECIPES,
	createDefaultRecipeRegistry,
	createRecipeRegistry,
	type GameplayRecipeRegistry,
} from './registry'
export {
	consumeCraftingGrid,
	craftFromGrid,
	craftFromInventory,
	craftableFromInventory,
	craftingGridSizeOf,
	matchCraftingGrid,
	type CraftOptions,
	type CraftResult,
	type CraftableRecipe,
	type InventoryCraftResult,
} from './craft'
export {
	canAcceptOutput,
	cookTicksFor,
	fuelProgress,
	fuelTicksOf,
	furnaceProgress,
	isFuel,
	isFurnaceBurning,
	registryFuelTicks,
	smeltingRecipeFor,
	takeFurnaceOutput,
	tickFurnace,
	withFurnaceFuel,
	withFurnaceInput,
	type FuelTicksResolver,
	type FurnaceTickOptions,
} from './furnace'
