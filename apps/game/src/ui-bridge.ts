import {
	createDefaultUiSnapshot,
	type UiDebugInfo,
	type UiScreen,
	type UiSettings,
	type UiSlot,
	type UiSnapshot,
	type UiWorldEntry,
} from '@voxelcraft/client'
import { BLOCK } from '@voxelcraft/core-types'

export interface HotbarEntry {
	readonly id: number
	readonly label: string
}

/** Placeable blocks, in hotbar order. Creative-style: every slot is unlimited. */
export const HOTBAR: readonly HotbarEntry[] = [
	{ id: BLOCK.STONE, label: 'Stone' },
	{ id: BLOCK.COBBLESTONE, label: 'Cobblestone' },
	{ id: BLOCK.DIRT, label: 'Dirt' },
	{ id: BLOCK.PLANKS, label: 'Planks' },
	{ id: BLOCK.GLASS, label: 'Glass' },
	{ id: BLOCK.SAND, label: 'Sand' },
	{ id: BLOCK.OAK_LOG, label: 'Oak Log' },
	{ id: BLOCK.TORCH, label: 'Torch' },
	{ id: BLOCK.BRICKS, label: 'Bricks' },
]

const BASE = createDefaultUiSnapshot()

/**
 * The hotbar contents never change, so build the slots once. The UI reads them
 * as readonly data and the slot count stays in sync with `INVENTORY`.
 */
const HOTBAR_SLOTS: readonly UiSlot[] = BASE.hotbar.map((slot, index) => {
	const entry = HOTBAR[index]
	if (entry === undefined) return slot
	return { itemId: entry.id, count: 64, durability: null, label: entry.label }
})

/** Inventory mirrors the hotbar in its first row; the rest stays empty. */
const INVENTORY_SLOTS: readonly UiSlot[] = BASE.inventory.map((slot, index) => {
	const hotbarSlot = HOTBAR_SLOTS[index]
	return hotbarSlot ?? slot
})

export function hotbarBlockId(index: number): number {
	return HOTBAR[index]?.id ?? BLOCK.STONE
}

export interface SnapshotInput {
	screen: UiScreen
	health: number
	hunger: number
	selectedSlot: number
	debug: UiDebugInfo
	settings: UiSettings
	worlds: readonly UiWorldEntry[]
}

/** Adapts game state into the UI contract. Called once per rendered frame. */
export function buildSnapshot(input: SnapshotInput): UiSnapshot {
	return {
		...BASE,
		screen: input.screen,
		health: input.health,
		hunger: input.hunger,
		hotbar: HOTBAR_SLOTS,
		selectedSlot: input.selectedSlot,
		inventory: INVENTORY_SLOTS,
		debug: input.debug,
		settings: input.settings,
		worlds: input.worlds,
	}
}
