/**
 * v2 gameplay contract: experience, enchanting, farming, breeding and
 * particles. Pure formulas live here so sim, gameplay and client agree.
 */
import type { ItemId } from '../ids'
import { TOOL_CLASS, type ToolClass } from '../blocks'
import { MOB, type MobType } from '../mob'
import { BLOCK_V2, ITEM_V2 } from './world2'

export const XP = {
	/** Orbs closer than this merge into one entity. */
	orbMergeRadius: 0.5,
	orbPickupRadius: 1.5,
	orbLifetimeTicks: 6000,
	/** Levels 0..15 cost 2 xp each plus this base. */
	baseCost: 7,
	lowSlope: 2,
	/** Ore and mob drops. */
	oreDrop: 3,
	mobDrop: 5,
	smeltDrop: 1,
	maxLevel: 30,
} as const

/** Total experience needed to reach `level` from zero. Monotonic. */
export function xpForLevel(level: number): number {
	const l = Math.max(0, Math.floor(level))
	return l * l + XP.baseCost * l
}

/** Highest level fully paid for by `totalXp`. */
export function levelFromXp(totalXp: number): number {
	const xp = Math.max(0, Math.floor(totalXp))
	let level = 0
	while (xpForLevel(level + 1) <= xp) level += 1
	return level
}

export const ENCHANTMENT = {
	Efficiency: 0,
	Unbreaking: 1,
	Fortune: 2,
	SilkTouch: 3,
	Sharpness: 4,
	Protection: 5,
	Power: 6,
	FeatherFalling: 7,
} as const
export type EnchantmentId = (typeof ENCHANTMENT)[keyof typeof ENCHANTMENT]

export const ENCHANT_MAX_LEVEL: Readonly<Record<EnchantmentId, number>> = {
	0: 5,
	1: 3,
	2: 3,
	3: 1,
	4: 5,
	5: 4,
	6: 5,
	7: 4,
}

/** Tool classes an enchantment may be rolled onto. Empty means armour only. */
export const ENCHANT_APPLIES_TO: Readonly<Record<EnchantmentId, readonly ToolClass[]>> = {
	0: [TOOL_CLASS.Pickaxe, TOOL_CLASS.Axe, TOOL_CLASS.Shovel, TOOL_CLASS.Shears],
	1: [TOOL_CLASS.Pickaxe, TOOL_CLASS.Axe, TOOL_CLASS.Shovel, TOOL_CLASS.Sword, TOOL_CLASS.Shears],
	2: [TOOL_CLASS.Pickaxe, TOOL_CLASS.Axe, TOOL_CLASS.Shovel],
	3: [TOOL_CLASS.Pickaxe, TOOL_CLASS.Axe, TOOL_CLASS.Shovel, TOOL_CLASS.Shears],
	4: [TOOL_CLASS.Sword],
	5: [],
	6: [],
	7: [],
}

/** Fortune and Silk Touch are mutually exclusive on the same item. */
export const ENCHANT_CONFLICTS: readonly (readonly [EnchantmentId, EnchantmentId])[] = [
	[ENCHANTMENT.Fortune, ENCHANTMENT.SilkTouch],
]

export const ENCHANTING = {
	tableBlock: BLOCK_V2.ENCHANTING_TABLE,
	bookshelfBlock: BLOCK_V2.BOOKSHELF,
	/** Bookshelves are counted in this radius at the same or +1 y. */
	bookshelfRadius: 2,
	maxBookshelves: 15,
	offerSlots: 3,
	lapisPerSlot: [1, 2, 3] as readonly number[],
	/** Enchantment power scales with bookshelf count. */
	powerPerBookshelf: 2,
} as const

/**
 * Level cost shown in enchanting slot `slot` (0..2) for `bookshelves` shelves.
 * Deterministic so the UI, gameplay and tests agree.
 */
export function enchantLevelCost(bookshelves: number, slot: number): number {
	const shelves = Math.min(ENCHANTING.maxBookshelves, Math.max(0, Math.floor(bookshelves)))
	const s = Math.min(ENCHANTING.offerSlots - 1, Math.max(0, Math.floor(slot)))
	const power = shelves * ENCHANTING.powerPerBookshelf
	const top = Math.max(1, Math.floor((power * (s + 1)) / 3) + s + 1)
	return Math.min(XP.maxLevel, top)
}

export interface EnchantmentInstance {
	readonly id: EnchantmentId
	/** 1..ENCHANT_MAX_LEVEL[id]. */
	readonly level: number
}

export const CROP_STAGES = 8

export interface CropDef {
	readonly block: number
	/** Item planted to create stage 0. */
	readonly seed: ItemId
	/** Item harvested from a mature crop. */
	readonly product: ItemId
	readonly minProduct: number
	readonly maxProduct: number
	/** Chance per random tick on hydrated farmland, 0..1. */
	readonly growChanceWet: number
	readonly growChanceDry: number
}

export const CROP: Readonly<Record<'wheat' | 'carrot' | 'potato', CropDef>> = {
	wheat: {
		block: BLOCK_V2.WHEAT_CROP,
		seed: ITEM_V2.WHEAT_SEEDS as ItemId,
		product: ITEM_V2.WHEAT as ItemId,
		minProduct: 1,
		maxProduct: 3,
		growChanceWet: 0.35,
		growChanceDry: 0.12,
	},
	carrot: {
		block: BLOCK_V2.CARROT_CROP,
		seed: ITEM_V2.CARROT as ItemId,
		product: ITEM_V2.CARROT as ItemId,
		minProduct: 1,
		maxProduct: 4,
		growChanceWet: 0.3,
		growChanceDry: 0.1,
	},
	potato: {
		block: BLOCK_V2.POTATO_CROP,
		seed: ITEM_V2.POTATO as ItemId,
		product: ITEM_V2.POTATO as ItemId,
		minProduct: 1,
		maxProduct: 4,
		growChanceWet: 0.3,
		growChanceDry: 0.1,
	},
}

export const FARMING = {
	/** Blocks searched around farmland for water. */
	hydrationRadius: 4,
	/** Random ticks per chunk section per sim tick. */
	randomTicksPerSection: 3,
	/** Trampling: farmland reverts to dirt after this many fall impacts. */
	trampleFalls: 1,
	/** Growth needs at least this much light on the crop column. */
	minLight: 9,
	hoeItem: ITEM_V2.FLINT_AND_STEEL as ItemId,
} as const

export const BREEDING = {
	/** Ticks an adult stays in love mode after being fed. */
	loveTicks: 600,
	/** Ticks before a baby becomes an adult. */
	babyGrowTicks: 24000,
	/** Ticks before the same adult can breed again. */
	cooldownTicks: 6000,
	/** Partner search radius in blocks. */
	partnerRadius: 8,
	/** Babies move faster and take a smaller hitbox scale. */
	babyScale: 0.5,
	babySpeedFactor: 1.15,
	xpOnBreed: 4,
} as const

/** Items that put a passive mob into love mode. */
export const BREED_FOOD: Readonly<Partial<Record<MobType, readonly ItemId[]>>> = {
	[MOB.Pig]: [ITEM_V2.CARROT as ItemId, ITEM_V2.POTATO as ItemId],
	[MOB.Cow]: [ITEM_V2.WHEAT as ItemId],
	[MOB.Sheep]: [ITEM_V2.WHEAT as ItemId],
	[MOB.Chicken]: [ITEM_V2.WHEAT_SEEDS as ItemId],
}

/** Drops added in v2 so passive mobs are worth farming. */
export const MOB_DROPS_V2: Readonly<Partial<Record<MobType, readonly ItemId[]>>> = {
	[MOB.Pig]: [ITEM_V2.RAW_PORK as ItemId],
	[MOB.Cow]: [ITEM_V2.RAW_BEEF as ItemId, ITEM_V2.LEATHER as ItemId],
	[MOB.Sheep]: [ITEM_V2.MUTTON as ItemId],
	[MOB.Chicken]: [ITEM_V2.RAW_CHICKEN as ItemId, ITEM_V2.EGG as ItemId],
}

export const PARTICLE = {
	Smoke: 0,
	Flame: 1,
	Splash: 2,
	Bubble: 3,
	Crit: 4,
	BlockBreak: 5,
	Redstone: 6,
	Heart: 7,
	Portal: 8,
	Lava: 9,
} as const
export type ParticleId = (typeof PARTICLE)[keyof typeof PARTICLE]

export const PARTICLE_BUDGET = {
	maxAlive: 2048,
	maxSpawnPerTick: 256,
	/** One instanced quad per particle: pos3 + age1 + kind1 + size1. */
	floatsPerParticle: 6,
	defaultLifetimeTicks: 40,
	gravity: -6,
	drag: 0.92,
} as const

export interface ParticleSpawn {
	readonly kind: ParticleId
	readonly x: number
	readonly y: number
	readonly z: number
	readonly count: number
	/** Random velocity spread in blocks per second. */
	readonly spread: number
}
