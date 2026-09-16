import { INVENTORY, TOOL_CLASS, TOOL_TIER, type ItemDef } from '@voxelcraft/core-types'
import { ITEM_DEFS, isOwnBlockItem } from '../items/itemDefs'
import { BLOCK_V2_DEFS } from './blockDefsV2'

/**
 * Item forms of the v2 blocks.
 *
 * A block item keeps the block id, exactly like v1 (`ITEM_BLOCK_BASE`), so a
 * v2 block that world generation placed can be broken, picked up and placed
 * again. Blocks whose `itemId` is 0 (the nether portal) or which point at
 * another block's item (wet farmland, the crops, whose item is the seed) are
 * skipped, so every id appears exactly once.
 */
function buildBlockItemV2Defs(): readonly ItemDef[] {
	const v1Ids = new Set(ITEM_DEFS.map((def) => def.id))
	const v1Names = new Set(ITEM_DEFS.map((def) => def.name))
	const defs: ItemDef[] = []
	const seen = new Set<number>()

	for (const block of BLOCK_V2_DEFS) {
		if (!isOwnBlockItem(block)) continue
		if (v1Ids.has(block.itemId)) {
			throw new Error(`v2 block item id ${String(block.itemId)} collides with a v1 item`)
		}
		if (v1Names.has(block.name)) {
			throw new Error(`v2 block item '${block.name}' collides with a v1 item name`)
		}
		if (seen.has(block.itemId)) {
			throw new Error(`duplicate v2 block item id ${String(block.itemId)} (${block.name})`)
		}
		seen.add(block.itemId)
		defs.push({
			id: block.itemId,
			name: block.name,
			displayName: block.displayName,
			maxStack: INVENTORY.defaultMaxStack,
			texture: block.name,
			toolClass: TOOL_CLASS.None,
			tier: TOOL_TIER.None,
			durability: 0,
			attackDamage: 1,
			food: 0,
			fuelTicks: 0,
			placesBlock: block.id,
		})
	}

	defs.sort((a, b) => a.id - b.id)
	return Object.freeze(defs)
}

/** One item per placeable v2 block, ascending by id. */
export const BLOCK_ITEM_V2_DEFS: readonly ItemDef[] = buildBlockItemV2Defs()
export const BLOCK_ITEM_V2_DEF_COUNT = BLOCK_ITEM_V2_DEFS.length
