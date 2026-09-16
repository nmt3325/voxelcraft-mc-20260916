import {
	INVENTORY,
	ITEM_V2,
	ITEM_V2_BASE,
	ITEM_V2_MAX,
	TOOL_CLASS,
	TOOL_TIER,
	type ItemDef,
	type ItemV2KeyName,
} from '@voxelcraft/core-types'
import { displayNameOf } from '../blocks/blockDefs'
import { ITEM_DEFS } from '../items/itemDefs'
import { BLOCK_ITEM_V2_DEFS } from '../v2blocks/blockItemsV2'

/**
 * Additive v2 item table.
 *
 * Nothing is appended to `ITEM_DEFS`: the v1 table keeps exactly the ids the
 * frozen contract describes. `ALL_ITEM_DEFS` is the merged table the shipped
 * `ITEMS` registry defines, so every v2 id resolves in the registry the app
 * actually builds.
 *
 * The override table is typed `Record<ItemV2KeyName, ...>` so a future contract
 * id fails compilation instead of silently missing a definition.
 */
export type ItemV2DefOverrides = Partial<Omit<ItemDef, 'id' | 'name'>>

/** Registry names v1 already owns. A v2 twin takes a `_v2` suffix instead. */
const V1_ITEM_NAMES: ReadonlySet<string> = new Set(ITEM_DEFS.map((def) => def.name))

/** `FARMING.hoeItem` points at FLINT_AND_STEEL, so it is a damageable tool. */
export const FLINT_AND_STEEL_DURABILITY = 64

/** Eggs are thrown one at a time, so they stack smaller than food. */
export const EGG_MAX_STACK = 16

function food(points: number): ItemV2DefOverrides {
	return { food: points }
}

const ITEM_V2_OVERRIDES: Record<ItemV2KeyName, ItemV2DefOverrides> = {
	WHEAT_SEEDS: {},
	WHEAT: food(1),
	BREAD: food(5),
	CARROT: food(3),
	POTATO: food(1),
	BAKED_POTATO: food(5),
	ENCHANTED_BOOK: { maxStack: 1 },
	NETHER_QUARTZ: {},
	FLINT_AND_STEEL: { maxStack: INVENTORY.toolMaxStack, durability: FLINT_AND_STEEL_DURABILITY },
	EGG: { maxStack: EGG_MAX_STACK },
	RAW_BEEF: food(3),
	COOKED_BEEF: food(8),
	RAW_PORK: food(3),
	COOKED_PORK: food(8),
	RAW_CHICKEN: food(2),
	COOKED_CHICKEN: food(6),
	MUTTON: food(2),
	LEATHER: {},
}

/** `bread` while the name is free, `leather_v2` once v1 has taken it. */
export function itemV2NameOf(key: ItemV2KeyName): string {
	const name = key.toLowerCase()
	return V1_ITEM_NAMES.has(name) ? `${name}_v2` : name
}

function baseItem(id: number, key: ItemV2KeyName): ItemDef {
	const name = itemV2NameOf(key)
	return {
		id,
		name,
		displayName: displayNameOf(key.toLowerCase()),
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

function buildItemV2Defs(): readonly ItemDef[] {
	const defs: ItemDef[] = []
	const seen = new Set<number>()

	for (const key of Object.keys(ITEM_V2) as ItemV2KeyName[]) {
		const id: number = ITEM_V2[key]
		if (id < ITEM_V2_BASE || id > ITEM_V2_MAX) {
			throw new RangeError(
				`v2 item '${key}' id ${String(id)} is outside ${String(ITEM_V2_BASE)}..${String(ITEM_V2_MAX)}`,
			)
		}
		const name = itemV2NameOf(key)
		const merged: ItemDef = { ...baseItem(id, key), ...ITEM_V2_OVERRIDES[key], id, name }
		if (seen.has(merged.id)) throw new Error(`duplicate v2 item id ${String(merged.id)} (${name})`)
		seen.add(merged.id)
		defs.push(merged)
	}

	defs.sort((a, b) => a.id - b.id)
	return Object.freeze(defs)
}

/** Every additive v2 item, ascending by id. */
export const ITEM_V2_DEFS: readonly ItemDef[] = buildItemV2Defs()
export const ITEM_V2_DEF_COUNT = ITEM_V2_DEFS.length

/**
 * v1 items, the item forms of the v2 blocks and the additive v2 items: exactly
 * what the shipped `ITEMS` registry defines.
 */
export const ALL_ITEM_DEFS: readonly ItemDef[] = Object.freeze(
	[...ITEM_DEFS, ...BLOCK_ITEM_V2_DEFS, ...ITEM_V2_DEFS].sort((a, b) => a.id - b.id),
)
export const ALL_ITEM_DEF_COUNT = ALL_ITEM_DEFS.length
