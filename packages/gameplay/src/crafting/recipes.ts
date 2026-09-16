import {
	BLOCK,
	FURNACE_DEFAULT_COOK_TICKS,
	ITEM,
	type ItemId,
	type Recipe,
	type ShapedRecipe,
	type ShapelessRecipe,
	type SmeltingRecipe,
} from '@voxelcraft/core-types'

/**
 * Recipe table for VoxelCraft v1.
 *
 * Shaped patterns are row-major with `0` for an empty cell, as `ShapedRecipe`
 * specifies. The registry matches them shift-invariantly, so every pattern is
 * written in its tightest bounding box here.
 */
const E = 0

function shaped(
	id: string,
	width: 1 | 2 | 3,
	height: 1 | 2 | 3,
	pattern: readonly ItemId[],
	result: ItemId,
	count = 1,
): ShapedRecipe {
	return {
		kind: 'shaped',
		id,
		width,
		height,
		pattern,
		result: { item: result, count, damage: 0 },
	}
}

function shapeless(
	id: string,
	ingredients: readonly ItemId[],
	result: ItemId,
	count = 1,
): ShapelessRecipe {
	return { kind: 'shapeless', id, ingredients, result: { item: result, count, damage: 0 } }
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

/** A full 3x3 of one ingredient: the block-compression recipes. */
function filled3x3(item: ItemId): readonly ItemId[] {
	return new Array<ItemId>(9).fill(item)
}

interface ToolSet {
	prefix: string
	material: ItemId
	pickaxe: ItemId
	axe: ItemId
	shovel: ItemId
	sword: ItemId
}

const TOOL_SETS: readonly ToolSet[] = [
	{
		prefix: 'wooden',
		material: BLOCK.PLANKS,
		pickaxe: ITEM.WOODEN_PICKAXE,
		axe: ITEM.WOODEN_AXE,
		shovel: ITEM.WOODEN_SHOVEL,
		sword: ITEM.WOODEN_SWORD,
	},
	{
		prefix: 'stone',
		material: BLOCK.COBBLESTONE,
		pickaxe: ITEM.STONE_PICKAXE,
		axe: ITEM.STONE_AXE,
		shovel: ITEM.STONE_SHOVEL,
		sword: ITEM.STONE_SWORD,
	},
	{
		prefix: 'iron',
		material: ITEM.IRON_INGOT,
		pickaxe: ITEM.IRON_PICKAXE,
		axe: ITEM.IRON_AXE,
		shovel: ITEM.IRON_SHOVEL,
		sword: ITEM.IRON_SWORD,
	},
	{
		prefix: 'diamond',
		material: ITEM.DIAMOND,
		pickaxe: ITEM.DIAMOND_PICKAXE,
		axe: ITEM.DIAMOND_AXE,
		shovel: ITEM.DIAMOND_SHOVEL,
		sword: ITEM.DIAMOND_SWORD,
	},
]

/** Pickaxe, axe, shovel and sword for every tool tier. */
function toolRecipes(): ShapedRecipe[] {
	const S = ITEM.STICK
	const out: ShapedRecipe[] = []
	for (const set of TOOL_SETS) {
		const M = set.material
		out.push(shaped(`${set.prefix}_pickaxe`, 3, 3, [M, M, M, E, S, E, E, S, E], set.pickaxe))
		out.push(shaped(`${set.prefix}_axe`, 2, 3, [M, M, M, S, E, S], set.axe))
		out.push(shaped(`${set.prefix}_shovel`, 1, 3, [M, S, S], set.shovel))
		out.push(shaped(`${set.prefix}_sword`, 1, 3, [M, M, S], set.sword))
	}
	return out
}

function craftingRecipes(): (ShapedRecipe | ShapelessRecipe)[] {
	const P = BLOCK.PLANKS
	const C = BLOCK.COBBLESTONE
	const S = ITEM.STICK
	const R = ITEM.REDSTONE_DUST
	const I = ITEM.IRON_INGOT
	const W = BLOCK.WOOL
	return [
		shapeless('planks_from_oak_log', [BLOCK.OAK_LOG], BLOCK.PLANKS, 4),
		shapeless('planks_from_birch_log', [BLOCK.BIRCH_LOG], BLOCK.PLANKS, 4),
		shapeless('planks_from_spruce_log', [BLOCK.SPRUCE_LOG], BLOCK.PLANKS, 4),
		shapeless('stone_button', [BLOCK.STONE], BLOCK.BUTTON),
		shaped('stick', 1, 2, [P, P], S, 4),
		shaped('crafting_table', 2, 2, [P, P, P, P], BLOCK.CRAFTING_TABLE),
		shaped('furnace', 3, 3, [C, C, C, C, E, C, C, C, C], BLOCK.FURNACE),
		shaped('chest', 3, 3, [P, P, P, P, E, P, P, P, P], BLOCK.CHEST),
		shaped('torch_from_coal', 1, 2, [ITEM.COAL, S], BLOCK.TORCH, 4),
		shaped('torch_from_charcoal', 1, 2, [ITEM.CHARCOAL, S], BLOCK.TORCH, 4),
		shaped('wooden_door', 2, 3, [P, P, P, P, P, P], BLOCK.DOOR_LOWER),
		shaped('bed', 3, 2, [W, W, W, P, P, P], BLOCK.BED_FOOT),
		shaped('ladder', 3, 3, [S, E, S, S, S, S, S, E, S], BLOCK.LADDER, 3),
		shaped('lever', 1, 2, [S, C], BLOCK.LEVER),
		shaped('wooden_pressure_plate', 2, 1, [P, P], BLOCK.PRESSURE_PLATE),
		shaped('redstone_lamp', 3, 3, [E, R, E, R, BLOCK.GLOWSTONE, R, E, R, E], BLOCK.REDSTONE_LAMP),
		shaped('piston', 3, 3, [P, P, P, C, I, C, C, R, C], BLOCK.PISTON),
		shaped('shears', 2, 2, [E, I, I, E], ITEM.SHEARS),
		shaped('sandstone', 2, 2, filled2x2(BLOCK.SAND), BLOCK.SANDSTONE),
		shaped('stone_bricks', 2, 2, filled2x2(BLOCK.STONE), BLOCK.STONE_BRICKS, 4),
		shaped('bricks', 2, 2, filled2x2(ITEM.BRICK), BLOCK.BRICKS),
		shaped('coal_block', 3, 3, filled3x3(ITEM.COAL), BLOCK.COAL_BLOCK),
		shaped('iron_block', 3, 3, filled3x3(I), BLOCK.IRON_BLOCK),
		shaped('gold_block', 3, 3, filled3x3(ITEM.GOLD_INGOT), BLOCK.GOLD_BLOCK),
		shaped('diamond_block', 3, 3, filled3x3(ITEM.DIAMOND), BLOCK.DIAMOND_BLOCK),
	]
}

function filled2x2(item: ItemId): readonly ItemId[] {
	return new Array<ItemId>(4).fill(item)
}

function smeltingRecipes(): SmeltingRecipe[] {
	return [
		smelting('smelt_iron', BLOCK.IRON_ORE, ITEM.IRON_INGOT),
		smelting('smelt_gold', BLOCK.GOLD_ORE, ITEM.GOLD_INGOT),
		smelting('smelt_glass', BLOCK.SAND, BLOCK.GLASS),
		smelting('smelt_stone', BLOCK.COBBLESTONE, BLOCK.STONE),
		smelting('charcoal_from_oak_log', BLOCK.OAK_LOG, ITEM.CHARCOAL),
		smelting('charcoal_from_birch_log', BLOCK.BIRCH_LOG, ITEM.CHARCOAL),
		smelting('charcoal_from_spruce_log', BLOCK.SPRUCE_LOG, ITEM.CHARCOAL),
		smelting('smelt_brick', ITEM.CLAY_BALL, ITEM.BRICK),
		smelting('cook_pork', ITEM.RAW_PORK, ITEM.COOKED_PORK),
		smelting('cook_beef', ITEM.RAW_BEEF, ITEM.COOKED_BEEF),
		smelting('cook_mutton', ITEM.RAW_MUTTON, ITEM.COOKED_MUTTON),
		smelting('cook_chicken', ITEM.RAW_CHICKEN, ITEM.COOKED_CHICKEN),
	]
}

/** Every recipe of the v1 table, in registration order. */
export const RECIPE_DEFS: readonly Recipe[] = Object.freeze([
	...craftingRecipes(),
	...toolRecipes(),
	...smeltingRecipes(),
])
export const RECIPE_DEF_COUNT = RECIPE_DEFS.length
