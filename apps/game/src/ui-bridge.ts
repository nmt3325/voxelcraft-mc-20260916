/**
 * Adapter between the real gameplay inventory and the UI contract.
 *
 * Slots, stack limits, labels and durabilities come from `@voxelcraft/gameplay`
 * (`InventoryState`, the item registry and the crafting registry), so the HUD
 * shows what the simulation actually holds instead of a hard-coded palette.
 */
import {
	BLOCK,
	INVENTORY,
	type BlockId,
	type InventoryState,
	type ItemStack,
} from '@voxelcraft/core-types'
import {
	EMPTY_SLOT,
	createDefaultUiSnapshot,
	type UiDebugInfo,
	type UiScreen,
	type UiSettings,
	type UiSlot,
	type UiSnapshot,
	type UiWorldEntry,
} from '@voxelcraft/client'
import {
	ITEMS,
	craftableFromInventory,
	createInventoryState,
	heldStack,
	makeStack,
	maxDurabilityOf,
	remainingDurability,
} from '@voxelcraft/gameplay'

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

/** A fresh creative inventory: the palette in the hotbar, main slots empty. */
export function createCreativeInventory(): InventoryState {
	const slots: (ItemStack | null)[] = new Array<ItemStack | null>(INVENTORY.totalSlots).fill(null)
	for (let i = 0; i < HOTBAR_BLOCKS.length && i < INVENTORY.hotbarSlots; i++) {
		const item = HOTBAR_BLOCKS[i]
		slots[i] = makeStack(item, ITEMS.maxStackOf(item))
	}
	return createInventoryState({ slots })
}

export function itemLabel(item: number): string {
	return ITEMS.tryById(item)?.displayName ?? ''
}

/** Block a stack places, or null when it is not a block item. */
export function placedBlockOf(stack: ItemStack | null): BlockId | null {
	if (stack === null || stack.count <= 0) return null
	return ITEMS.tryById(stack.item)?.placesBlock ?? null
}

/** Block the selected hotbar slot would place. */
export function heldBlockId(inventory: InventoryState): BlockId | null {
	return placedBlockOf(heldStack(inventory))
}

export function toUiSlot(stack: ItemStack | null): UiSlot {
	if (stack === null || stack.count <= 0) return { ...EMPTY_SLOT }
	const max = maxDurabilityOf(stack.item)
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
	}
}
