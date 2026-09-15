import {
	GAME_MODE,
	INVENTORY,
	isSameItem,
	type GameMode,
	type InventoryState,
	type ItemId,
	type ItemStack,
} from '@voxelcraft/core-types'
import {
	cloneItemStack,
	damageStack,
	normalizeStack,
	registryStackLimit,
	stackLimitOf,
	type StackLimitResolver,
} from './stacks'

/**
 * Player inventory: 36 slots (hotbar 0..8, main 9..35) plus the cursor and the
 * crafting grid, exactly as `InventoryState` declares them in the contract.
 *
 * These helpers mutate the state they are handed, like the chest helpers do,
 * and always normalize empty slots to `null`. A fresh state starts with the
 * 2x2 player grid; `resizeCraftingGrid` switches to 3x3 for a crafting table.
 */
export interface InventoryOptions {
	stackLimitOf?: StackLimitResolver
}

function clampHotbar(index: number): number {
	if (!Number.isInteger(index)) return 0
	return Math.min(Math.max(index, 0), INVENTORY.hotbarSlots - 1)
}

export function createInventoryState(init: Partial<InventoryState> = {}): InventoryState {
	const slots = new Array<ItemStack | null>(INVENTORY.totalSlots).fill(null)
	if (init.slots !== undefined) {
		const copied = Math.min(init.slots.length, slots.length)
		for (let i = 0; i < copied; i++) slots[i] = normalizeStack(init.slots[i])
	}
	const length = init.crafting?.length ?? INVENTORY.craftGrid2
	const crafting = new Array<ItemStack | null>(length).fill(null)
	if (init.crafting !== undefined) {
		for (let i = 0; i < length; i++) crafting[i] = normalizeStack(init.crafting[i])
	}
	return {
		slots,
		selectedHotbar: clampHotbar(init.selectedHotbar ?? 0),
		cursor: normalizeStack(init.cursor ?? null),
		crafting,
	}
}

export function cloneInventoryState(state: InventoryState): InventoryState {
	return {
		slots: state.slots.map((slot) => cloneItemStack(slot)),
		selectedHotbar: state.selectedHotbar,
		cursor: cloneItemStack(state.cursor),
		crafting: state.crafting.map((slot) => cloneItemStack(slot)),
	}
}

function assertSlot(state: InventoryState, index: number): void {
	if (!Number.isInteger(index) || index < 0 || index >= state.slots.length) {
		throw new RangeError(`inventory slot out of range: ${String(index)}`)
	}
}

export function getSlot(state: InventoryState, index: number): ItemStack | null {
	assertSlot(state, index)
	return state.slots[index] ?? null
}

export function setSlot(state: InventoryState, index: number, stack: ItemStack | null): void {
	assertSlot(state, index)
	state.slots[index] = normalizeStack(stack)
}

/** Removes up to `count` items from one slot and returns what was removed. */
export function takeFromSlot(
	state: InventoryState,
	index: number,
	count = Number.POSITIVE_INFINITY,
): ItemStack | null {
	assertSlot(state, index)
	const current = state.slots[index] ?? null
	if (current === null || count <= 0) return null
	const taken = Math.min(current.count, count)
	const out: ItemStack = { item: current.item, count: taken, damage: current.damage }
	if (taken >= current.count) state.slots[index] = null
	else current.count -= taken
	return out
}

export function selectHotbar(state: InventoryState, index: number): number {
	if (!Number.isInteger(index) || index < 0 || index >= INVENTORY.hotbarSlots) {
		throw new RangeError(`hotbar index out of range: ${String(index)}`)
	}
	state.selectedHotbar = index
	return index
}

/** Scroll-wheel selection: wraps around both ends of the hotbar. */
export function cycleHotbar(state: InventoryState, delta: number): number {
	const size = INVENTORY.hotbarSlots
	const next = (((state.selectedHotbar + Math.trunc(delta)) % size) + size) % size
	state.selectedHotbar = next
	return next
}

export function heldStack(state: InventoryState): ItemStack | null {
	return state.slots[state.selectedHotbar] ?? null
}

export function setHeldStack(state: InventoryState, stack: ItemStack | null): void {
	state.slots[state.selectedHotbar] = normalizeStack(stack)
}

export function countItem(state: InventoryState, item: ItemId): number {
	let total = 0
	for (const slot of state.slots) {
		if (slot !== null && slot.item === item) total += slot.count
	}
	return total
}

/** First slot holding the item, or -1. */
export function findItem(state: InventoryState, item: ItemId): number {
	for (let i = 0; i < state.slots.length; i++) {
		const slot = state.slots[i]
		if (slot !== null && slot.item === item) return i
	}
	return -1
}

/**
 * Merges into matching stacks first, then fills empty slots in slot order
 * (hotbar before main). Returns the part that did not fit, or `null` when
 * everything was stored. The input stack is never mutated.
 */
export function addStack(
	state: InventoryState,
	stack: ItemStack,
	options: InventoryOptions = {},
): ItemStack | null {
	if (stack.count <= 0) return null
	const limit = stackLimitOf(stack.item, options.stackLimitOf ?? registryStackLimit)
	let remaining = stack.count

	for (let i = 0; i < state.slots.length && remaining > 0; i++) {
		const slot = state.slots[i]
		if (slot === null || !isSameItem(slot, stack)) continue
		const space = limit - slot.count
		if (space <= 0) continue
		const moved = Math.min(space, remaining)
		slot.count += moved
		remaining -= moved
	}

	for (let i = 0; i < state.slots.length && remaining > 0; i++) {
		if (state.slots[i] !== null) continue
		const moved = Math.min(limit, remaining)
		state.slots[i] = { item: stack.item, count: moved, damage: stack.damage }
		remaining -= moved
	}

	if (remaining <= 0) return null
	return { item: stack.item, count: remaining, damage: stack.damage }
}

export function hasRoomFor(
	state: InventoryState,
	stack: ItemStack,
	options: InventoryOptions = {},
): boolean {
	return addStack(cloneInventoryState(state), stack, options) === null
}

/** Removes up to `count` items and returns how many were actually removed. */
export function removeItem(state: InventoryState, item: ItemId, count = 1): number {
	let left = count
	for (let i = 0; i < state.slots.length && left > 0; i++) {
		const slot = state.slots[i]
		if (slot === null || slot.item !== item) continue
		const taken = Math.min(slot.count, left)
		slot.count -= taken
		left -= taken
		if (slot.count <= 0) state.slots[i] = null
	}
	return count - left
}

/** One inventory click: pick up, merge into, or swap with the cursor. */
export function swapCursorWithSlot(
	state: InventoryState,
	index: number,
	options: InventoryOptions = {},
): void {
	assertSlot(state, index)
	const slot = state.slots[index] ?? null
	const cursor = state.cursor
	if (cursor === null) {
		state.cursor = slot
		state.slots[index] = null
		return
	}
	if (slot !== null && isSameItem(slot, cursor)) {
		const limit = stackLimitOf(slot.item, options.stackLimitOf ?? registryStackLimit)
		const space = limit - slot.count
		if (space > 0) {
			const moved = Math.min(space, cursor.count)
			slot.count += moved
			const left = cursor.count - moved
			state.cursor = left > 0 ? { item: cursor.item, count: left, damage: cursor.damage } : null
			return
		}
	}
	state.slots[index] = cursor
	state.cursor = slot
}

export function isCreative(mode: GameMode): boolean {
	return mode === GAME_MODE.Creative
}

/**
 * Consumes `count` items from the selected hotbar slot. Creative mode never
 * consumes, so placing blocks is free there.
 */
export function consumeHeld(
	state: InventoryState,
	count = 1,
	mode: GameMode = GAME_MODE.Survival,
): boolean {
	if (isCreative(mode)) return true
	if (count <= 0) return true
	const index = state.selectedHotbar
	const slot = state.slots[index] ?? null
	if (slot === null || slot.count < count) return false
	slot.count -= count
	if (slot.count <= 0) state.slots[index] = null
	return true
}

/**
 * Applies tool wear to one slot. Returns true when the stack was destroyed.
 * Creative mode never damages tools.
 */
export function damageSlot(
	state: InventoryState,
	index: number,
	amount = 1,
	mode: GameMode = GAME_MODE.Survival,
): boolean {
	assertSlot(state, index)
	if (isCreative(mode)) return false
	const before = state.slots[index] ?? null
	if (before === null) return false
	const after = damageStack(before, amount)
	state.slots[index] = after
	return after === null
}

export function damageHeld(
	state: InventoryState,
	amount = 1,
	mode: GameMode = GAME_MODE.Survival,
): boolean {
	return damageSlot(state, state.selectedHotbar, amount, mode)
}

/** Every stored stack in slot order: what a death drop spills. */
export function inventoryContents(state: InventoryState): ItemStack[] {
	const out: ItemStack[] = []
	for (const slot of state.slots) {
		if (slot !== null) out.push({ item: slot.item, count: slot.count, damage: slot.damage })
	}
	return out
}

export function isInventoryEmpty(state: InventoryState): boolean {
	return (
		state.slots.every((slot) => slot === null) &&
		state.crafting.every((slot) => slot === null) &&
		state.cursor === null
	)
}

/** Empties slots, crafting grid and cursor, returning everything removed. */
export function clearInventory(state: InventoryState): ItemStack[] {
	const out = inventoryContents(state)
	for (let i = 0; i < state.slots.length; i++) state.slots[i] = null
	for (let i = 0; i < state.crafting.length; i++) {
		const cell = state.crafting[i]
		if (cell !== null) out.push({ item: cell.item, count: cell.count, damage: cell.damage })
		state.crafting[i] = null
	}
	const cursor = state.cursor
	if (cursor !== null) {
		out.push({ item: cursor.item, count: cursor.count, damage: cursor.damage })
	}
	state.cursor = null
	return out
}

export function craftingGridSize(state: InventoryState): 2 | 3 {
	if (state.crafting.length === INVENTORY.craftGrid2) return 2
	if (state.crafting.length === INVENTORY.craftGrid3) return 3
	throw new RangeError(`unsupported crafting grid length: ${String(state.crafting.length)}`)
}

function assertCraftingSlot(state: InventoryState, index: number): void {
	if (!Number.isInteger(index) || index < 0 || index >= state.crafting.length) {
		throw new RangeError(`crafting slot out of range: ${String(index)}`)
	}
}

export function getCraftingSlot(state: InventoryState, index: number): ItemStack | null {
	assertCraftingSlot(state, index)
	return state.crafting[index] ?? null
}

export function setCraftingSlot(
	state: InventoryState,
	index: number,
	stack: ItemStack | null,
): void {
	assertCraftingSlot(state, index)
	state.crafting[index] = normalizeStack(stack)
}

/**
 * Switches between the 2x2 player grid and the 3x3 crafting table grid. Cells
 * keep their (x, y) position and the stacks that no longer fit are returned.
 */
export function resizeCraftingGrid(state: InventoryState, size: 2 | 3): ItemStack[] {
	const from = craftingGridSize(state)
	const length = size === 2 ? INVENTORY.craftGrid2 : INVENTORY.craftGrid3
	const next = new Array<ItemStack | null>(length).fill(null)
	const spilled: ItemStack[] = []
	for (let y = 0; y < from; y++) {
		for (let x = 0; x < from; x++) {
			const cell = normalizeStack(state.crafting[y * from + x])
			if (cell === null) continue
			if (x < size && y < size) next[y * size + x] = cell
			else spilled.push(cell)
		}
	}
	state.crafting = next
	return spilled
}

/** Empties the crafting grid, e.g. when the screen closes. */
export function clearCraftingGrid(state: InventoryState): ItemStack[] {
	const out: ItemStack[] = []
	for (let i = 0; i < state.crafting.length; i++) {
		const cell = state.crafting[i]
		if (cell === null) continue
		out.push({ item: cell.item, count: cell.count, damage: cell.damage })
		state.crafting[i] = null
	}
	return out
}
