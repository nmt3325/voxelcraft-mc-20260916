/**
 * The registries apps/game resolves blocks and items through.
 *
 * There is exactly one source of truth: `@voxelcraft/gameplay` builds `BLOCKS`
 * and `ITEMS` from the v1 plus v2 definition tables, which are themselves
 * generated from the frozen `@voxelcraft/core-types` contract.
 *
 * This module used to declare a second, hand written v2 block table. Review
 * rev5 (B-02) measured that copy drifting from the shipped one on 14 of the 18
 * v2 block ids: it made the Nether portal breakable (`hardness 0` instead of
 * the contract's `-1`) and handed the player the undefined item id 65, and it
 * gave the three crops an item form, so a mature plant could be pocketed and
 * replanted. Deriving both registries from the package removes the copy.
 *
 * Only the app-specific helpers live here now. `registries.test.ts` pins every
 * field of all 36 v2 ids against the gameplay registries, so reintroducing a
 * local table - or losing a single id from one - fails `pnpm -r test`.
 */
import { type BlockId, type ItemId } from '@voxelcraft/core-types'
import {
	BLOCKS,
	ITEMS,
	type GameplayBlockRegistry,
	type GameplayItemRegistry,
} from '@voxelcraft/gameplay'

/** Blocks the app breaks, places and measures: the shipped registry. */
export const BLOCKS_V2: GameplayBlockRegistry = BLOCKS

/** Items the app holds, names, stacks and places from: the shipped registry. */
export const ITEMS_V2: GameplayItemRegistry = ITEMS

/** Stack limit resolver over the registry that knows both id bands. */
export function v2StackLimitOf(item: ItemId): number {
	return ITEMS_V2.maxStackOf(item)
}

/**
 * Inventory options for every call this app makes: without them the shared
 * `registryStackLimit` would resolve an item against a registry of its own.
 */
export const V2_INVENTORY = { stackLimitOf: v2StackLimitOf }

/** Display name of an item, including the v2 items. */
export function itemDisplayName(item: ItemId): string {
	return ITEMS_V2.tryById(item)?.displayName ?? `Item ${item}`
}

/** Display name of a block, including the v2 blocks. */
export function blockDisplayName(id: BlockId): string {
	return BLOCKS_V2.tryById(id)?.displayName ?? `Block ${id}`
}

/** Durability of an item, including the v2 tools. 0 when not damageable. */
export function v2MaxDurabilityOf(item: ItemId): number {
	return ITEMS_V2.tryById(item)?.durability ?? 0
}

/**
 * Block an item places, or `null` for items that are not blocks. The contract
 * gives the Nether portal and the crops `itemId: 0`, so nothing places them.
 */
export function v2PlacesBlock(item: ItemId): BlockId | null {
	return ITEMS_V2.tryById(item)?.placesBlock ?? null
}
