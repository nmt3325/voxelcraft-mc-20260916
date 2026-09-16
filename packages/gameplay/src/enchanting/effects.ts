/**
 * Applied enchantment effects, wired into the existing tool, drop and combat
 * math instead of duplicating it.
 *
 * Every roll goes through the injected Rng so mining and combat stay
 * reproducible from a seed.
 */

import {
	COMBAT,
	ENCHANTMENT,
	TOOL_TIER,
	type BlockDef,
	type BlockDrop,
	type ItemStack,
	type Rng,
} from '@voxelcraft/core-types'
import { breakTimeWith, canHarvestWith, toolProfileOf } from '../inventory/tools'
import { cloneItemStack, damageStack, makeStack } from '../inventory/stacks'
import { ITEMS } from '../items/registry'
import { levelOf, type EnchantmentSet } from './enchantments'

/** Damage a bare fist deals, used when the held item has no attack value. */
const BARE_HAND_DAMAGE = 1

/** Efficiency speeds mining up by 30% per level: 1 + 0.3 * level. */
export function efficiencyMultiplier(set: EnchantmentSet): number {
	return 1 + 0.3 * levelOf(set, ENCHANTMENT.Efficiency)
}

/** Break time in seconds: the tool's base time divided by the Efficiency multiplier. */
export function enchantedBreakTime(
	stack: ItemStack | null,
	blockDef: BlockDef,
	set: EnchantmentSet,
): number {
	return breakTimeWith(stack, blockDef) / efficiencyMultiplier(set)
}

/**
 * A drop entry only lands when the held tool can harvest the block and reaches
 * the entry's requiresTier. With no tool passed at all (an explosion, say) only
 * entries that need no tier drop.
 */
function dropAllowed(
	blockDef: BlockDef,
	drop: BlockDrop,
	stack: ItemStack | null | undefined,
): boolean {
	if (stack === undefined) return drop.requiresTier === TOOL_TIER.None
	if (!canHarvestWith(stack, blockDef)) return false
	return toolProfileOf(stack).tier >= drop.requiresTier
}

/** Fortune adds a uniform 0..level bonus, so level N averages +N/2 items. */
export function fortuneBonus(level: number, rng: Rng): number {
	if (level <= 0) return 0
	return rng.nextInt(level + 1)
}

/**
 * Drops for a broken block. SilkTouch yields the block itself exactly once;
 * otherwise every entry is rolled against its chance and tier requirement and
 * Fortune raises the count of drops that are not the block itself (ores, seeds).
 * Fortune and SilkTouch can never both be present, so the branches are exclusive.
 */
export function enchantedDrops(
	blockDef: BlockDef,
	set: EnchantmentSet,
	rng: Rng,
	stack?: ItemStack | null,
): ItemStack[] {
	if (levelOf(set, ENCHANTMENT.SilkTouch) > 0) {
		return blockDef.itemId > 0 ? [makeStack(blockDef.itemId, 1)] : []
	}
	const fortune = levelOf(set, ENCHANTMENT.Fortune)
	const out: ItemStack[] = []
	for (const drop of blockDef.drops) {
		if (!dropAllowed(blockDef, drop, stack)) continue
		if (drop.chance < 1 && rng.next01() >= drop.chance) continue
		const span = Math.max(0, drop.max - drop.min)
		let count = drop.min + (span > 0 ? rng.nextInt(span + 1) : 0)
		if (drop.item !== blockDef.itemId) count += fortuneBonus(fortune, rng)
		if (count <= 0) continue
		out.push(makeStack(drop.item, count))
	}
	return out
}

/** Unbreaking: a durability point is consumed with probability 1 / (level + 1). */
export function durabilityConsumed(set: EnchantmentSet, rng: Rng): number {
	const level = levelOf(set, ENCHANTMENT.Unbreaking)
	if (level <= 0) return 1
	return rng.next01() < 1 / (level + 1) ? 1 : 0
}

/** Applies one use of a tool, skipping the damage when Unbreaking absorbs it. */
export function consumeDurability(
	stack: ItemStack | null,
	set: EnchantmentSet,
	rng: Rng,
): ItemStack | null {
	if (stack === null) return null
	const points = durabilityConsumed(set, rng)
	return points > 0 ? damageStack(stack, points) : cloneItemStack(stack)
}

/** Sharpness adds 1 damage at level 1 and 0.5 for every level above it. */
export function sharpnessBonus(level: number): number {
	return level <= 0 ? 0 : 1 + 0.5 * (level - 1)
}

/** Melee damage of the held item plus its Sharpness bonus. */
export function meleeDamage(stack: ItemStack | null, set: EnchantmentSet): number {
	const def = stack === null || stack.count <= 0 ? undefined : ITEMS.tryById(stack.item)
	const attack = def?.attackDamage ?? 0
	const base = attack > 0 ? attack : BARE_HAND_DAMAGE
	return base + sharpnessBonus(levelOf(set, ENCHANTMENT.Sharpness))
}

/** Power scales COMBAT.arrowDamage by 25% per level. */
export function arrowDamage(set: EnchantmentSet): number {
	return COMBAT.arrowDamage * (1 + 0.25 * levelOf(set, ENCHANTMENT.Power))
}

/**
 * Incoming damage after armour enchantments: Protection takes 4% per level off
 * every source, FeatherFalling a further 12% per level off fall damage only.
 * Never returns a negative number.
 */
export function reduceDamage(
	amount: number,
	set: EnchantmentSet,
	options: { fall?: boolean } = {},
): number {
	if (!Number.isFinite(amount) || amount <= 0) return 0
	const protection = Math.max(0, 1 - 0.04 * levelOf(set, ENCHANTMENT.Protection))
	const feather =
		options.fall === true ? Math.max(0, 1 - 0.12 * levelOf(set, ENCHANTMENT.FeatherFalling)) : 1
	return Math.max(0, amount * protection * feather)
}
