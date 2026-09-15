import type { BlockId, ItemId } from './ids'
import type { ToolClass, ToolTier } from './blocks'

/** Block items reuse the BlockId. Non-block items start at 256. */
export const ITEM_BLOCK_BASE = 0
export const ITEM_NON_BLOCK_BASE = 256
export const ITEM_EXPERIMENTAL_BASE = 400

/** Canonical non-block item ids. FROZEN for v1. */
export const ITEM = {
	STICK: 256,
	COAL: 257,
	CHARCOAL: 258,
	IRON_INGOT: 259,
	GOLD_INGOT: 260,
	DIAMOND: 261,
	REDSTONE_DUST: 262,
	LAPIS: 263,
	CLAY_BALL: 264,
	BRICK: 265,
	BOW: 266,
	ARROW: 267,
	BONE: 268,
	STRING: 269,
	FEATHER: 270,
	GUNPOWDER: 271,
	ROTTEN_FLESH: 272,
	LEATHER: 273,
	RAW_PORK: 274,
	COOKED_PORK: 275,
	RAW_BEEF: 276,
	COOKED_BEEF: 277,
	RAW_MUTTON: 278,
	COOKED_MUTTON: 279,
	RAW_CHICKEN: 280,
	COOKED_CHICKEN: 281,
	WOODEN_PICKAXE: 288,
	WOODEN_AXE: 289,
	WOODEN_SHOVEL: 290,
	WOODEN_SWORD: 291,
	STONE_PICKAXE: 292,
	STONE_AXE: 293,
	STONE_SHOVEL: 294,
	STONE_SWORD: 295,
	IRON_PICKAXE: 296,
	IRON_AXE: 297,
	IRON_SHOVEL: 298,
	IRON_SWORD: 299,
	DIAMOND_PICKAXE: 300,
	DIAMOND_AXE: 301,
	DIAMOND_SHOVEL: 302,
	DIAMOND_SWORD: 303,
	SHEARS: 304,
} as const
export type ItemKeyName = keyof typeof ITEM

export interface ItemDef {
	id: ItemId
	name: string
	displayName: string
	maxStack: number
	texture: string
	toolClass: ToolClass
	tier: ToolTier
	/** 0 = not damageable. */
	durability: number
	attackDamage: number
	/** Hunger/health restored, 0 = not food. */
	food: number
	/** Ticks of furnace burn time, 0 = not fuel. */
	fuelTicks: number
	placesBlock: BlockId | null
}

export interface ItemStack {
	item: ItemId
	count: number
	/** Used durability points. 0 = pristine. */
	damage: number
}

export interface ItemRegistry {
	define(def: ItemDef): void
	byId(id: ItemId): ItemDef
	byName(name: string): ItemDef | undefined
	all(): readonly ItemDef[]
}

export const INVENTORY = {
	hotbarSlots: 9,
	mainSlots: 27,
	totalSlots: 36,
	craftGrid2: 4,
	craftGrid3: 9,
	chestSlots: 27,
	furnaceSlots: 3,
	defaultMaxStack: 64,
	toolMaxStack: 1,
} as const

export interface InventoryState {
	/** Length INVENTORY.totalSlots. 0..8 is the hotbar. */
	slots: (ItemStack | null)[]
	selectedHotbar: number
	cursor: ItemStack | null
	crafting: (ItemStack | null)[]
}

export function isSameItem(a: ItemStack | null, b: ItemStack | null): boolean {
	if (a === null || b === null) return a === b
	return a.item === b.item && a.damage === b.damage
}
