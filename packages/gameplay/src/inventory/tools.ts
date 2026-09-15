import {
	TOOL_CLASS,
	TOOL_TIER,
	breakTimeSeconds,
	canHarvest,
	type BlockDef,
	type ItemStack,
	type ToolClass,
	type ToolTier,
} from '@voxelcraft/core-types'
import { ITEMS } from '../items/registry'

/**
 * Bridge between a held `ItemStack` and the shared mining formulas. The
 * formulas themselves stay in `core-types` (`breakTimeSeconds` / `canHarvest`)
 * so the HUD progress bar and the mining system can never diverge.
 */
export interface ToolProfile {
	toolClass: ToolClass
	tier: ToolTier
}

export const BARE_HAND: ToolProfile = Object.freeze({
	toolClass: TOOL_CLASS.None,
	tier: TOOL_TIER.None,
})

/** Tool class and tier of a held stack; an empty hand is None/None. */
export function toolProfileOf(stack: ItemStack | null): ToolProfile {
	if (stack === null || stack.count <= 0) return BARE_HAND
	const def = ITEMS.tryById(stack.item)
	if (def === undefined) return BARE_HAND
	return { toolClass: def.toolClass, tier: def.tier }
}

/** Whether breaking the block with this stack yields its drops. */
export function canHarvestWith(stack: ItemStack | null, def: BlockDef): boolean {
	const profile = toolProfileOf(stack)
	return canHarvest(def, profile.tier, profile.toolClass)
}

/** Seconds needed to break the block with this stack. */
export function breakTimeWith(stack: ItemStack | null, def: BlockDef): number {
	const profile = toolProfileOf(stack)
	return breakTimeSeconds(def, profile.tier, profile.toolClass)
}

/** True when the stack is the tool class the block is mined with. */
export function isPreferredTool(stack: ItemStack | null, def: BlockDef): boolean {
	if (def.toolClass === TOOL_CLASS.None) return false
	return toolProfileOf(stack).toolClass === def.toolClass
}
