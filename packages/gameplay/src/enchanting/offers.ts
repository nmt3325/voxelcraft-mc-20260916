/**
 * The enchanting table: how much power the room has, which three offers the
 * table shows and what taking one costs.
 *
 * Offers are a pure function of (seed, bookshelves, slot), so the UI, the sim
 * and the tests all see the same three rolls until one is taken.
 */

import {
	ENCHANTING,
	EVENT_V2,
	XP,
	enchantLevelCost,
	makeRng,
	type BlockId,
	type EnchantmentId,
	type EnchantmentInstance,
	type EventBusV2,
	type ItemStack,
	type ToolClass,
} from '@voxelcraft/core-types'
import { canAfford, spendLevels, type XpState } from '../experience'
import {
	addEnchantment,
	applicableEnchantments,
	levelOf,
	maxLevelOf,
	type EnchantmentSet,
} from './enchantments'

/** Everything the table needs from the world; keeps gameplay free of world/sim. */
export interface EnchantWorld {
	getBlock(x: number, y: number, z: number): BlockId
}

/** One of the three offers a table shows. */
export interface EnchantOffer {
	slot: number
	levelCost: number
	lapisCost: number
	enchantments: EnchantmentInstance[]
}

/** The inputs that fully determine a table's offers. */
export interface RollOffersInput {
	seed: number
	bookshelves: number
	toolClass: ToolClass
}

/** What the player brings when taking an offer. */
export interface ApplyOfferOptions {
	lapis: number
	bus?: EventBusV2 | null
	/** Enchantments already on the item; defaults to an empty set. */
	set?: EnchantmentSet
}

/** Result of taking an offer. `reason` is only set when `ok` is false. */
export interface ApplyOfferResult {
	ok: boolean
	stack: ItemStack | null
	set: EnchantmentSet
	reason?: string
}

/** Clamps a bookshelf count into 0..ENCHANTING.maxBookshelves. */
export function clampBookshelves(bookshelves: number): number {
	const shelves = Number.isFinite(bookshelves) ? Math.floor(bookshelves) : 0
	return Math.min(ENCHANTING.maxBookshelves, Math.max(0, shelves))
}

/** Clamps a slot index into 0..ENCHANTING.offerSlots - 1. */
export function clampSlot(slot: number): number {
	const index = Number.isFinite(slot) ? Math.floor(slot) : 0
	return Math.min(ENCHANTING.offerSlots - 1, Math.max(0, index))
}

/** Lapis the given slot costs, straight from ENCHANTING.lapisPerSlot. */
export function lapisCostOf(slot: number): number {
	const index = clampSlot(slot)
	return ENCHANTING.lapisPerSlot[index] ?? index + 1
}

/**
 * Bookshelves powering a table at (x, y, z): every shelf within
 * ENCHANTING.bookshelfRadius horizontally, on the table's own layer and the one
 * above it, capped at ENCHANTING.maxBookshelves. The table's own cell is skipped.
 */
export function countBookshelves(world: EnchantWorld, x: number, y: number, z: number): number {
	const radius = ENCHANTING.bookshelfRadius
	let shelves = 0
	for (let dy = 0; dy <= 1; dy++) {
		for (let dx = -radius; dx <= radius; dx++) {
			for (let dz = -radius; dz <= radius; dz++) {
				if (dx === 0 && dz === 0 && dy === 0) continue
				if (world.getBlock(x + dx, y + dy, z + dz) !== ENCHANTING.bookshelfBlock) continue
				shelves += 1
				if (shelves >= ENCHANTING.maxBookshelves) return ENCHANTING.maxBookshelves
			}
		}
	}
	return shelves
}

/** Later slots in a better stocked room roll more enchantments at once. */
function pickCount(levelCost: number, poolSize: number): number {
	return Math.min(poolSize, 1 + Math.floor(levelCost / 15))
}

/** Level cap for one pick: the contract cap scaled by how costly the slot is. */
function levelCapFor(id: EnchantmentId, levelCost: number): number {
	const max = maxLevelOf(id)
	if (max <= 0) return 0
	return Math.max(1, Math.min(max, Math.ceil((max * levelCost) / XP.maxLevel)))
}

/** Rolls one slot. Pure in (seed, shelves, slot); toolClass only filters the pool. */
function rollSlot(seed: number, shelves: number, toolClass: ToolClass, slot: number): EnchantOffer {
	const levelCost = enchantLevelCost(shelves, slot)
	const pool = applicableEnchantments(toolClass)
	const rng = makeRng(seed, shelves, slot)
	let set: EnchantmentSet = []
	const picks = pickCount(levelCost, pool.length)
	for (let pick = 0; pick < picks; pick++) {
		const start = rng.nextInt(Math.max(1, pool.length))
		for (let step = 0; step < pool.length; step++) {
			const id = pool[(start + step) % pool.length]
			const level = 1 + rng.nextInt(levelCapFor(id, levelCost))
			const next = addEnchantment(set, id, level)
			if (next === null || levelOf(next, id) === levelOf(set, id)) continue
			set = next
			break
		}
	}
	return {
		slot,
		levelCost,
		lapisCost: lapisCostOf(slot),
		enchantments: set.map((entry) => ({ id: entry.id, level: entry.level })),
	}
}

/** The three offers a table shows. Identical inputs always give identical offers. */
export function rollOffers(input: RollOffersInput): EnchantOffer[] {
	const shelves = clampBookshelves(input.bookshelves)
	const offers: EnchantOffer[] = []
	for (let slot = 0; slot < ENCHANTING.offerSlots; slot++) {
		offers.push(rollSlot(input.seed, shelves, input.toolClass, slot))
	}
	return offers
}

/**
 * Takes an offer: checks lapis and levels, spends the levels through the XP
 * module, then builds the item's new set and emits `enchant.applied` once per
 * enchantment that actually landed.
 */
export function applyOffer(
	xpState: XpState,
	stack: ItemStack | null,
	offer: EnchantOffer,
	options: ApplyOfferOptions,
): ApplyOfferResult {
	const base = options.set ?? []
	const bus = options.bus ?? null
	if (stack === null || stack.count <= 0) {
		return { ok: false, stack: null, set: base, reason: 'no-item' }
	}
	const item: ItemStack = { item: stack.item, count: stack.count, damage: stack.damage }
	const lapis = Number.isFinite(options.lapis) ? Math.floor(options.lapis) : 0
	if (lapis < offer.lapisCost) {
		return { ok: false, stack: item, set: base, reason: 'lapis' }
	}
	if (!canAfford(xpState, offer.levelCost)) {
		return { ok: false, stack: item, set: base, reason: 'levels' }
	}
	const spend = spendLevels(xpState, offer.levelCost, bus)
	if (!spend.paid) {
		return { ok: false, stack: item, set: base, reason: 'levels' }
	}
	let set: EnchantmentSet = base
	for (const entry of offer.enchantments) {
		const next = addEnchantment(set, entry.id, entry.level)
		if (next === null) continue
		const applied = levelOf(next, entry.id)
		if (applied === levelOf(set, entry.id)) continue
		set = next
		bus?.emit(EVENT_V2.EnchantApplied, {
			item,
			enchantment: entry.id,
			level: applied,
			cost: offer.levelCost,
		})
	}
	return { ok: true, stack: item, set }
}
