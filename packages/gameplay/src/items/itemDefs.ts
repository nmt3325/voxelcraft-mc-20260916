import {
	BLOCK,
	INVENTORY,
	ITEM,
	TOOL_CLASS,
	TOOL_TIER,
	type BlockDef,
	type BlockId,
	type ItemDef,
	type ItemKeyName,
	type ToolClass,
	type ToolTier,
} from '@voxelcraft/core-types'
import { BLOCK_DEFS, displayNameOf } from '../blocks/blockDefs'

/**
 * Item definition table for VoxelCraft v1.
 *
 * Two families live here:
 * 1. Block items, derived from `BLOCK_DEFS` (ids 0..255, `placesBlock` set).
 * 2. Non-block items, one per key of the frozen `ITEM` table (ids 256+).
 *
 * The non-block override table is typed `Record<ItemKeyName, ...>` so a new
 * contract id fails compilation instead of silently missing a definition.
 */
export type ItemDefOverrides = Partial<Omit<ItemDef, 'id' | 'name'>>

export const TOOL_DURABILITY: Record<ToolTier, number> = {
	[TOOL_TIER.None]: 0,
	[TOOL_TIER.Wood]: 59,
	[TOOL_TIER.Stone]: 131,
	[TOOL_TIER.Iron]: 250,
	[TOOL_TIER.Diamond]: 1561,
}

/** Base melee damage per tool class, before the tier bonus. */
const TOOL_DAMAGE_BASE: Record<ToolClass, number> = {
	[TOOL_CLASS.None]: 1,
	[TOOL_CLASS.Pickaxe]: 2,
	[TOOL_CLASS.Axe]: 3,
	[TOOL_CLASS.Shovel]: 1,
	[TOOL_CLASS.Sword]: 4,
	[TOOL_CLASS.Shears]: 1,
}

const TIER_DAMAGE_BONUS: Record<ToolTier, number> = {
	[TOOL_TIER.None]: 0,
	[TOOL_TIER.Wood]: 0,
	[TOOL_TIER.Stone]: 1,
	[TOOL_TIER.Iron]: 2,
	[TOOL_TIER.Diamond]: 3,
}

/** Furnace burn time for the block items that are fuel. */
const BLOCK_ITEM_FUEL_TICKS: ReadonlyMap<BlockId, number> = new Map<BlockId, number>([
	[BLOCK.OAK_LOG, 300],
	[BLOCK.BIRCH_LOG, 300],
	[BLOCK.SPRUCE_LOG, 300],
	[BLOCK.PLANKS, 300],
	[BLOCK.CRAFTING_TABLE, 300],
	[BLOCK.CHEST, 300],
	[BLOCK.LADDER, 300],
	[BLOCK.DOOR_LOWER, 200],
	[BLOCK.OAK_SAPLING, 100],
	[BLOCK.COAL_BLOCK, 16000],
])

function tool(toolClass: ToolClass, tier: ToolTier): ItemDefOverrides {
	return {
		maxStack: INVENTORY.toolMaxStack,
		toolClass,
		tier,
		durability: TOOL_DURABILITY[tier],
		attackDamage: TOOL_DAMAGE_BASE[toolClass] + TIER_DAMAGE_BONUS[tier],
		// Wooden tools are valid furnace fuel, like their planks.
		fuelTicks: tier === TOOL_TIER.Wood ? 200 : 0,
	}
}

function food(points: number): ItemDefOverrides {
	return { food: points }
}

const NON_BLOCK_OVERRIDES: Record<ItemKeyName, ItemDefOverrides> = {
	STICK: { fuelTicks: 100 },
	COAL: { fuelTicks: 1600 },
	CHARCOAL: { fuelTicks: 1600 },
	IRON_INGOT: {},
	GOLD_INGOT: {},
	DIAMOND: {},
	REDSTONE_DUST: { placesBlock: BLOCK.REDSTONE_WIRE },
	LAPIS: {},
	CLAY_BALL: {},
	BRICK: {},
	BOW: { maxStack: 1, durability: 384, attackDamage: 1 },
	ARROW: { attackDamage: 2 },
	BONE: {},
	STRING: {},
	FEATHER: {},
	GUNPOWDER: {},
	ROTTEN_FLESH: food(4),
	LEATHER: {},
	RAW_PORK: food(3),
	COOKED_PORK: food(8),
	RAW_BEEF: food(3),
	COOKED_BEEF: food(8),
	RAW_MUTTON: food(2),
	COOKED_MUTTON: food(6),
	RAW_CHICKEN: food(2),
	COOKED_CHICKEN: food(6),
	WOODEN_PICKAXE: tool(TOOL_CLASS.Pickaxe, TOOL_TIER.Wood),
	WOODEN_AXE: tool(TOOL_CLASS.Axe, TOOL_TIER.Wood),
	WOODEN_SHOVEL: tool(TOOL_CLASS.Shovel, TOOL_TIER.Wood),
	WOODEN_SWORD: tool(TOOL_CLASS.Sword, TOOL_TIER.Wood),
	STONE_PICKAXE: tool(TOOL_CLASS.Pickaxe, TOOL_TIER.Stone),
	STONE_AXE: tool(TOOL_CLASS.Axe, TOOL_TIER.Stone),
	STONE_SHOVEL: tool(TOOL_CLASS.Shovel, TOOL_TIER.Stone),
	STONE_SWORD: tool(TOOL_CLASS.Sword, TOOL_TIER.Stone),
	IRON_PICKAXE: tool(TOOL_CLASS.Pickaxe, TOOL_TIER.Iron),
	IRON_AXE: tool(TOOL_CLASS.Axe, TOOL_TIER.Iron),
	IRON_SHOVEL: tool(TOOL_CLASS.Shovel, TOOL_TIER.Iron),
	IRON_SWORD: tool(TOOL_CLASS.Sword, TOOL_TIER.Iron),
	DIAMOND_PICKAXE: tool(TOOL_CLASS.Pickaxe, TOOL_TIER.Diamond),
	DIAMOND_AXE: tool(TOOL_CLASS.Axe, TOOL_TIER.Diamond),
	DIAMOND_SHOVEL: tool(TOOL_CLASS.Shovel, TOOL_TIER.Diamond),
	DIAMOND_SWORD: tool(TOOL_CLASS.Sword, TOOL_TIER.Diamond),
	SHEARS: { maxStack: 1, toolClass: TOOL_CLASS.Shears, durability: 238 },
}

function baseItem(id: number, name: string): ItemDef {
	return {
		id,
		name,
		displayName: displayNameOf(name),
		maxStack: INVENTORY.defaultMaxStack,
		texture: name,
		toolClass: TOOL_CLASS.None,
		tier: TOOL_TIER.None,
		durability: 0,
		attackDamage: 1,
		food: 0,
		fuelTicks: 0,
		placesBlock: null,
	}
}

/** A block item exists for every block that maps onto its own id. */
export function isOwnBlockItem(def: BlockDef): boolean {
	return def.itemId === def.id && def.id !== BLOCK.AIR
}

function buildItemDefs(): readonly ItemDef[] {
	const defs: ItemDef[] = []
	const seen = new Set<number>()

	for (const block of BLOCK_DEFS) {
		if (!isOwnBlockItem(block)) continue
		const def = baseItem(block.itemId, block.name)
		def.displayName = block.displayName
		def.placesBlock = block.id
		def.fuelTicks = BLOCK_ITEM_FUEL_TICKS.get(block.id) ?? 0
		if (seen.has(def.id)) throw new Error(`duplicate block item id ${def.id} (${def.name})`)
		seen.add(def.id)
		defs.push(def)
	}

	for (const key of Object.keys(ITEM) as ItemKeyName[]) {
		const id = ITEM[key]
		const name = key.toLowerCase()
		const merged: ItemDef = { ...baseItem(id, name), ...NON_BLOCK_OVERRIDES[key], id, name }
		if (seen.has(merged.id)) throw new Error(`duplicate item id ${merged.id} (${merged.name})`)
		seen.add(merged.id)
		defs.push(merged)
	}

	defs.sort((a, b) => a.id - b.id)
	return Object.freeze(defs)
}

/** Every item of the frozen v1 contract, ascending by id. */
export const ITEM_DEFS: readonly ItemDef[] = buildItemDefs()
export const ITEM_DEF_COUNT = ITEM_DEFS.length
