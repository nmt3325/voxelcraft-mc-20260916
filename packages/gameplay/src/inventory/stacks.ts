import {
	INVENTORY,
	isSameItem,
	type ItemId,
	type ItemStack,
} from '@voxelcraft/core-types'
import { ITEMS } from '../items/registry'

/**
 * Stack primitives shared by the inventory, the crafting grid and the furnace.
 *
 * An empty stack is always `null`, never a zero-count object, so slot equality
 * and `isSameItem` comparisons keep their meaning everywhere downstream.
 */
export type StackLimitResolver = (item: ItemId) => number

/** Stack limit from the item registry: tools are 1, everything else 64. */
export const registryStackLimit: StackLimitResolver = (item) => ITEMS.maxStackOf(item)

export function stackLimitOf(
	item: ItemId,
	limitOf: StackLimitResolver = registryStackLimit,
): number {
	const limit = limitOf(item)
	if (!Number.isFinite(limit) || limit <= 0) return INVENTORY.defaultMaxStack
	return Math.floor(limit)
}

export function makeStack(item: ItemId, count = 1, damage = 0): ItemStack {
	return { item, count, damage }
}

export function cloneItemStack(stack: ItemStack | null): ItemStack | null {
	if (stack === null) return null
	return { item: stack.item, count: stack.count, damage: stack.damage }
}

export function isStackEmpty(stack: ItemStack | null): boolean {
	return stack === null || stack.count <= 0
}

/** `null` for missing or empty stacks, an independent copy otherwise. */
export function normalizeStack(stack: ItemStack | null | undefined): ItemStack | null {
	if (stack === null || stack === undefined || stack.count <= 0) return null
	return { item: stack.item, count: stack.count, damage: stack.damage }
}

/** True when both stacks hold the same item and damage, so they can merge. */
export function canMerge(a: ItemStack | null, b: ItemStack | null): boolean {
	if (a === null || b === null || a.count <= 0 || b.count <= 0) return false
	return isSameItem(a, b)
}

/** Splits `count` items off a stack. Both halves come back normalized. */
export function splitStack(
	stack: ItemStack | null,
	count: number,
): { taken: ItemStack | null; rest: ItemStack | null } {
	if (stack === null || stack.count <= 0 || count <= 0) {
		return { taken: null, rest: normalizeStack(stack) }
	}
	const taken = Math.min(stack.count, Math.floor(count))
	const rest = stack.count - taken
	return {
		taken: { item: stack.item, count: taken, damage: stack.damage },
		rest: rest > 0 ? { item: stack.item, count: rest, damage: stack.damage } : null,
	}
}

export function maxDurabilityOf(item: ItemId): number {
	return ITEMS.tryById(item)?.durability ?? 0
}

export function isDamageable(item: ItemId): boolean {
	return maxDurabilityOf(item) > 0
}

/** Durability points left, or 0 for items that cannot take damage. */
export function remainingDurability(stack: ItemStack | null): number {
	if (stack === null || stack.count <= 0) return 0
	const max = maxDurabilityOf(stack.item)
	if (max <= 0) return 0
	return Math.max(0, max - stack.damage)
}

/**
 * Applies `amount` durability points. Once the damage reaches the item's
 * durability one unit is destroyed, and because `INVENTORY.toolMaxStack` is 1
 * that removes the stack entirely.
 */
export function damageStack(stack: ItemStack | null, amount = 1): ItemStack | null {
	if (stack === null || stack.count <= 0) return null
	if (amount <= 0) return cloneItemStack(stack)
	const max = maxDurabilityOf(stack.item)
	if (max <= 0) return cloneItemStack(stack)
	const damage = stack.damage + Math.floor(amount)
	if (damage < max) return { item: stack.item, count: stack.count, damage }
	const count = stack.count - 1
	return count > 0 ? { item: stack.item, count, damage: 0 } : null
}
