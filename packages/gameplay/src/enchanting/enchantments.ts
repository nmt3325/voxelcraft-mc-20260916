/**
 * Enchantment sets: the small immutable value type the rest of the enchanting
 * code passes around, plus the contract rules for composing one.
 *
 * Ids, level caps, the tool-class table and the conflict pairs are frozen in the
 * v2 contract; this module only decides how they combine.
 */

import {
	ENCHANT_APPLIES_TO,
	ENCHANT_CONFLICTS,
	ENCHANT_MAX_LEVEL,
	ENCHANTMENT,
	type EnchantmentId,
	type EnchantmentInstance,
	type ToolClass,
} from '@voxelcraft/core-types'

/** Enchantments carried by one item. Immutable: helpers return new sets. */
export type EnchantmentSet = readonly EnchantmentInstance[]

/** Every enchantment id, in contract order. */
export const ENCHANTMENT_IDS: readonly EnchantmentId[] = Object.values(
	ENCHANTMENT,
) as EnchantmentId[]

/** Highest level the contract allows for an id (0 when unknown). */
export function maxLevelOf(id: EnchantmentId): number {
	return ENCHANT_MAX_LEVEL[id] ?? 0
}

/** Level of `id` in the set, or 0 when it is absent. */
export function levelOf(set: EnchantmentSet, id: EnchantmentId): number {
	for (const entry of set) {
		if (entry.id === id) return entry.level
	}
	return 0
}

/** Whether the set holds `id` at all. */
export function hasEnchantment(set: EnchantmentSet, id: EnchantmentId): boolean {
	return levelOf(set, id) > 0
}

/** True when the set already holds something `id` excludes (Fortune vs SilkTouch). */
export function conflictsWith(set: EnchantmentSet, id: EnchantmentId): boolean {
	for (const pair of ENCHANT_CONFLICTS) {
		const [a, b] = pair
		if (a === id && hasEnchantment(set, b)) return true
		if (b === id && hasEnchantment(set, a)) return true
	}
	return false
}

/** Tool classes come from ENCHANT_APPLIES_TO; an empty list means armour-only. */
export function canApplyTo(id: EnchantmentId, toolClass: ToolClass): boolean {
	const classes: readonly ToolClass[] = ENCHANT_APPLIES_TO[id] ?? []
	return classes.includes(toolClass)
}

/** Ids that may be rolled onto this tool class, in contract order. */
export function applicableEnchantments(toolClass: ToolClass): EnchantmentId[] {
	return ENCHANTMENT_IDS.filter((id) => canApplyTo(id, toolClass))
}

/** Clamps a requested level into 1..ENCHANT_MAX_LEVEL[id]. */
export function clampEnchantLevel(id: EnchantmentId, level: number): number {
	const max = maxLevelOf(id)
	if (max <= 0) return 0
	const want = Number.isFinite(level) ? Math.floor(level) : 1
	return Math.min(max, Math.max(1, want))
}

/**
 * Adds `id` at `level`, clamped to the contract cap. An id already present keeps
 * the higher of the two levels. Returns `null` when `id` conflicts with
 * something in the set, so a caller can skip that pick instead of losing the set.
 */
export function addEnchantment(
	set: EnchantmentSet,
	id: EnchantmentId,
	level: number,
): EnchantmentSet | null {
	if (conflictsWith(set, id)) return null
	const wanted = clampEnchantLevel(id, level)
	const existing = levelOf(set, id)
	if (wanted <= 0 || existing >= wanted) return set.slice()
	if (existing > 0) {
		return set.map((entry) => (entry.id === id ? { id, level: wanted } : entry))
	}
	return [...set, { id, level: wanted }]
}
