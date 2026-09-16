import {
	INVENTORY,
	type ItemDef,
	type ItemId,
	type ItemRegistry,
} from '@voxelcraft/core-types'
import { ITEM_DEFS } from './itemDefs'

export interface GameplayItemRegistry extends ItemRegistry {
	/** Non-throwing variant of `byId`. */
	tryById(id: ItemId): ItemDef | undefined
	has(id: ItemId): boolean
	count(): number
	/** Stack limit for an item, falling back to the inventory default. */
	maxStackOf(id: ItemId): number
}

export function createItemRegistry(defs: readonly ItemDef[] = []): GameplayItemRegistry {
	const byIdMap = new Map<ItemId, ItemDef>()
	const byNameMap = new Map<string, ItemDef>()
	let ordered: ItemDef[] | null = null

	const registry: GameplayItemRegistry = {
		define(def: ItemDef): void {
			if (!Number.isInteger(def.id) || def.id <= 0) {
				throw new RangeError(`invalid item id: ${String(def.id)} (${def.name})`)
			}
			const existingById = byIdMap.get(def.id)
			if (existingById !== undefined && existingById.name !== def.name) {
				throw new Error(`duplicate item id ${def.id}: '${existingById.name}' vs '${def.name}'`)
			}
			const existingByName = byNameMap.get(def.name)
			if (existingByName !== undefined && existingByName.id !== def.id) {
				throw new Error(`duplicate item name '${def.name}': ${existingByName.id} vs ${def.id}`)
			}
			byIdMap.set(def.id, def)
			byNameMap.set(def.name, def)
			ordered = null
		},
		byId(id: ItemId): ItemDef {
			const def = byIdMap.get(id)
			if (def === undefined) throw new RangeError(`unknown item id: ${String(id)}`)
			return def
		},
		tryById(id: ItemId): ItemDef | undefined {
			return byIdMap.get(id)
		},
		byName(name: string): ItemDef | undefined {
			return byNameMap.get(name)
		},
		all(): readonly ItemDef[] {
			if (ordered === null) {
				ordered = [...byIdMap.values()].sort((a, b) => a.id - b.id)
			}
			return ordered
		},
		has(id: ItemId): boolean {
			return byIdMap.has(id)
		},
		count(): number {
			return byIdMap.size
		},
		maxStackOf(id: ItemId): number {
			return byIdMap.get(id)?.maxStack ?? INVENTORY.defaultMaxStack
		},
	}

	for (const def of defs) registry.define(def)
	return registry
}

export function createDefaultItemRegistry(): GameplayItemRegistry {
	return createItemRegistry(ITEM_DEFS)
}

/** Shared registry instance for the whole gameplay package. */
export const ITEMS: GameplayItemRegistry = createDefaultItemRegistry()
