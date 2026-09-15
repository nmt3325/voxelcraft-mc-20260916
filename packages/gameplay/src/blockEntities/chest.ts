import {
	INVENTORY,
	isSameItem,
	type ChestData,
	type ItemId,
	type ItemStack,
} from '@voxelcraft/core-types'
import { ITEMS } from '../items/registry'

export type MaxStackResolver = (item: ItemId) => number

const registryMaxStack: MaxStackResolver = (item) => ITEMS.maxStackOf(item)

export function chestSlotCount(): number {
	return INVENTORY.chestSlots
}

/**
 * Inserts a stack into a chest: merge into matching stacks first, then fill
 * empty slots. Returns the part that did not fit, or `null` when everything
 * was stored. The input stack is never mutated.
 */
export function insertIntoChest(
	data: ChestData,
	stack: ItemStack,
	maxStackOf: MaxStackResolver = registryMaxStack,
): ItemStack | null {
	if (stack.count <= 0) return null
	const limit = Math.max(1, maxStackOf(stack.item))
	let remaining = stack.count

	for (let i = 0; i < data.items.length && remaining > 0; i++) {
		const slot = data.items[i]
		if (slot === null || !isSameItem(slot, stack)) continue
		const space = limit - slot.count
		if (space <= 0) continue
		const moved = Math.min(space, remaining)
		slot.count += moved
		remaining -= moved
	}

	for (let i = 0; i < data.items.length && remaining > 0; i++) {
		if (data.items[i] !== null) continue
		const moved = Math.min(limit, remaining)
		data.items[i] = { item: stack.item, count: moved, damage: stack.damage }
		remaining -= moved
	}

	if (remaining <= 0) return null
	return { item: stack.item, count: remaining, damage: stack.damage }
}

/** Removes up to `count` items from a slot and returns what was removed. */
export function takeFromChest(
	data: ChestData,
	slot: number,
	count = Number.POSITIVE_INFINITY,
): ItemStack | null {
	if (!Number.isInteger(slot) || slot < 0 || slot >= data.items.length) {
		throw new RangeError(`chest slot out of range: ${String(slot)}`)
	}
	const current = data.items[slot]
	if (current === null) return null
	const taken = Math.min(current.count, count)
	if (taken <= 0) return null
	const out: ItemStack = { item: current.item, count: taken, damage: current.damage }
	if (taken >= current.count) data.items[slot] = null
	else current.count -= taken
	return out
}

export function countItemInChest(data: ChestData, item: ItemId): number {
	let total = 0
	for (const slot of data.items) {
		if (slot !== null && slot.item === item) total += slot.count
	}
	return total
}

export function isChestEmpty(data: ChestData): boolean {
	return data.items.every((slot) => slot === null)
}

/** Every stack a broken chest should spill, in slot order. */
export function drainChest(data: ChestData): ItemStack[] {
	const out: ItemStack[] = []
	for (let i = 0; i < data.items.length; i++) {
		const slot = data.items[i]
		if (slot === null) continue
		out.push({ item: slot.item, count: slot.count, damage: slot.damage })
		data.items[i] = null
	}
	return out
}
