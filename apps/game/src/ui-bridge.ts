/**
 * Adapter between the real gameplay inventory and the UI contract.
 *
 * Slots, stack limits, labels and durabilities come from `@voxelcraft/gameplay`
 * (`InventoryState`, the item registry and the crafting registry), so the HUD
 * shows what the simulation actually holds instead of a hard-coded palette.
 */
import {
	BLOCK,
	BLOCK_V2,
	FARMING,
	INVENTORY,
	ITEM,
	ITEM_V2,
	PORTAL,
	type BlockId,
	type InventoryState,
	type ItemId,
	type ItemStack,
} from '@voxelcraft/core-types'
import {
	EMPTY_SLOT,
	createDefaultUiSnapshot,
	type UiDebugInfo,
	type UiEnchantState,
	type UiFarmInfo,
	type UiHerdInfo,
	type UiNetInfo,
	type UiScreen,
	type UiSettings,
	type UiSlot,
	type UiSnapshot,
	type UiWorldEntry,
	type UiXpInfo,
} from '@voxelcraft/client'
import {
	craftableFromInventory,
	createInventoryState,
	heldStack,
	makeStack,
	remainingDurability,
} from '@voxelcraft/gameplay'
import { ITEMS_V2 } from './registries'

/** Creative palette, in hotbar order. */
export const HOTBAR_BLOCKS: readonly BlockId[] = [
	BLOCK.STONE,
	BLOCK.COBBLESTONE,
	BLOCK.DIRT,
	BLOCK.PLANKS,
	BLOCK.GLASS,
	BLOCK.SAND,
	BLOCK.OAK_LOG,
	BLOCK.TORCH,
	BLOCK.BRICKS,
]

const BASE = createDefaultUiSnapshot()

/** Item that places a block, or null when the block has no item form. */
function itemForBlock(block: BlockId): ItemId | null {
	for (const def of ITEMS_V2.all()) {
		if (def.placesBlock === block) return def.id
	}
	return null
}

/**
 * Phase 8 starter kit. The hotbar palette is unchanged, so these go into the
 * main rows: without them tilling, planting, enchanting and portal building
 * would have no reachable items in a fresh creative world.
 */
function v2KitItems(): ItemId[] {
	const wanted: (ItemId | null)[] = [
		FARMING.hoeItem,
		ITEM_V2.WHEAT_SEEDS,
		ITEM.LAPIS,
		itemForBlock(BLOCK_V2.ENCHANTING_TABLE),
		itemForBlock(BLOCK_V2.BOOKSHELF),
		itemForBlock(PORTAL.frameBlock),
		itemForBlock(BLOCK_V2.NETHERRACK),
	]
	return wanted.filter((item): item is ItemId => item !== null)
}

/** A fresh creative inventory: the palette in the hotbar, main slots empty. */
export function createCreativeInventory(): InventoryState {
	const slots: (ItemStack | null)[] = new Array<ItemStack | null>(INVENTORY.totalSlots).fill(null)
	for (let i = 0; i < HOTBAR_BLOCKS.length && i < INVENTORY.hotbarSlots; i++) {
		const item = HOTBAR_BLOCKS[i]
		slots[i] = makeStack(item, ITEMS_V2.maxStackOf(item))
	}
	let next = INVENTORY.hotbarSlots
	for (const item of v2KitItems()) {
		if (next >= INVENTORY.totalSlots) break
		slots[next] = makeStack(item, ITEMS_V2.maxStackOf(item))
		next += 1
	}
	return createInventoryState({ slots })
}

export function itemLabel(item: number): string {
	return ITEMS_V2.tryById(item)?.displayName ?? ''
}

/** Block a stack places, or null when it is not a block item. */
export function placedBlockOf(stack: ItemStack | null): BlockId | null {
	if (stack === null || stack.count <= 0) return null
	return ITEMS_V2.tryById(stack.item)?.placesBlock ?? null
}

/** Block the selected hotbar slot would place. */
export function heldBlockId(inventory: InventoryState): BlockId | null {
	return placedBlockOf(heldStack(inventory))
}

export function toUiSlot(stack: ItemStack | null): UiSlot {
	if (stack === null || stack.count <= 0) return { ...EMPTY_SLOT }
	const max = ITEMS_V2.tryById(stack.item)?.durability ?? 0
	return {
		itemId: stack.item,
		count: stack.count,
		durability: max > 0 ? remainingDurability(stack) / max : null,
		label: itemLabel(stack.item),
	}
}

function toUiSlots(stacks: readonly (ItemStack | null)[]): UiSlot[] {
	return stacks.map((stack) => toUiSlot(stack))
}

export interface SnapshotInput {
	screen: UiScreen
	health: number
	maxHealth: number
	hunger: number
	inventory: InventoryState
	debug: UiDebugInfo
	settings: UiSettings
	worlds: readonly UiWorldEntry[]
	/** Phase 8 additions. Omitted fields fall back to the neutral snapshot. */
	xp?: UiXpInfo
	dimension?: string
	farm?: UiFarmInfo
	herd?: UiHerdInfo
	multiplayer?: UiNetInfo
	enchanting?: UiEnchantState | null
}

/** Adapts game state into the UI contract. Called a few times per second. */
export function buildSnapshot(input: SnapshotInput): UiSnapshot {
	const slots = toUiSlots(input.inventory.slots)
	const craftable = craftableFromInventory(input.inventory)
	return {
		...BASE,
		screen: input.screen,
		health: input.health,
		maxHealth: input.maxHealth,
		hunger: input.hunger,
		hotbar: slots.slice(0, INVENTORY.hotbarSlots),
		selectedSlot: input.inventory.selectedHotbar,
		inventory: slots,
		craftingGrid: input.inventory.crafting.map((stack) =>
			stack === null ? null : toUiSlot(stack),
		),
		craftingResult:
			craftable === null
				? null
				: toUiSlot({
						item: craftable.result.item,
						count: craftable.result.count,
						damage: craftable.result.damage ?? 0,
					}),
		debug: input.debug,
		settings: input.settings,
		worlds: input.worlds,
		xp: input.xp ?? BASE.xp,
		dimension: input.dimension ?? BASE.dimension,
		farm: input.farm ?? BASE.farm,
		herd: input.herd ?? BASE.herd,
		multiplayer: input.multiplayer ?? BASE.multiplayer,
		enchanting: input.enchanting ?? null,
	}
}
