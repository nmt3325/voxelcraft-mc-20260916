import {
	BLOCK,
	CROP,
	CROP_STAGES,
	EVENT_V2,
	FARMING,
	hash01,
	hashU32,
	type BlockId,
	type EventBusV2,
	type ItemId,
	type ItemStack,
} from '@voxelcraft/core-types'
import {
	ASSUMED_LIGHT,
	farmPosKey,
	isFarmland,
	isReplaceable,
	isWetFarmland,
	type FarmWorld,
	type LightLookup,
} from './farmland'

/**
 * Crops: planting, deterministic random-tick growth and harvest drops.
 *
 * v1 chunks have no per-block metadata, so the growth stage cannot live in the
 * block id. A `CropField` owns it instead: the world holds the crop block, the
 * field holds `{ crop, stage }` for the same position.
 */

/** The crops named by the contract. */
export type CropKey = keyof typeof CROP

/** A single crop definition from the contract table. */
export type CropDefinition = (typeof CROP)[CropKey]

/** Stable iteration order for the contract crops. */
export const CROP_KEYS: readonly CropKey[] = ['wheat', 'carrot', 'potato']

/** Last stage a crop can reach; a crop is mature here. */
export const MAX_CROP_STAGE = CROP_STAGES - 1

/** Salt folded with the tick so the growth roll changes every tick. */
const GROW_SALT = 0x67726f77

/** Salt for choosing which planted positions a random tick visits. */
const PICK_SALT = 0x7469636b

/** Fixed seed for harvest rolls, which depend only on the position. */
const HARVEST_SEED = 0x68617276
const PRODUCT_SALT = 0x70726f64
const FORTUNE_SALT = 0x666f7274

export interface CropState {
	crop: CropKey
	/** 0..MAX_CROP_STAGE. */
	stage: number
}

/** Crop stages keyed by position, owned by the caller. */
export interface CropField {
	crops: Map<string, CropState>
}

export function createCropField(): CropField {
	return { crops: new Map<string, CropState>() }
}

/**
 * Position key used by `CropField.crops`: `"x,y,z"` with the coordinates
 * truncated to integers, the same shape farmland uses for its counters.
 */
export function cropPosKey(x: number, y: number, z: number): string {
	return farmPosKey(x, y, z)
}

/** Contract definition for a crop. */
export function cropDefOf(crop: CropKey): CropDefinition {
	return CROP[crop]
}

/** Crop planted by a seed item, or undefined when the item is not a seed. */
export function cropKeyForSeed(seedItem: ItemId): CropKey | undefined {
	for (const key of CROP_KEYS) {
		if (CROP[key].seed === seedItem) return key
	}
	return undefined
}

/** Crop a block id belongs to, or undefined when it is not a crop block. */
export function cropKeyForBlock(block: BlockId): CropKey | undefined {
	for (const key of CROP_KEYS) {
		if (CROP[key].block === block) return key
	}
	return undefined
}

export function cropAt(field: CropField, x: number, y: number, z: number): CropState | undefined {
	return field.crops.get(cropPosKey(x, y, z))
}

/** Stage at the position, or -1 when nothing is planted there. */
export function cropStageAt(field: CropField, x: number, y: number, z: number): number {
	return field.crops.get(cropPosKey(x, y, z))?.stage ?? -1
}

export function cropCount(field: CropField): number {
	return field.crops.size
}

/** Drops the stage entry only. Returns whether something was removed. */
export function removeCrop(field: CropField, x: number, y: number, z: number): boolean {
	return field.crops.delete(cropPosKey(x, y, z))
}

/** Drops the stage entry and clears the crop block from the world. */
export function clearCropAt(
	field: CropField,
	world: FarmWorld,
	x: number,
	y: number,
	z: number,
): boolean {
	const removed = removeCrop(field, x, y, z)
	if (cropKeyForBlock(world.getBlock(x, y, z)) !== undefined) world.setBlock(x, y, z, BLOCK.AIR)
	return removed
}

export interface CropEntry {
	x: number
	y: number
	z: number
	crop: CropKey
	stage: number
}

/** Every planted crop, ordered by y, then z, then x, so ticks replay. */
export function cropEntries(field: CropField): CropEntry[] {
	const out: CropEntry[] = []
	for (const [key, state] of field.crops) {
		const parts = key.split(',')
		out.push({
			x: Number(parts[0]),
			y: Number(parts[1]),
			z: Number(parts[2]),
			crop: state.crop,
			stage: state.stage,
		})
	}
	out.sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x)
	return out
}

/**
 * Plants a seed on farmland. Requires `FARMLAND` or `FARMLAND_WET` directly
 * below, an empty (air or replaceable) target and nothing already tracked at
 * the position. Sets the crop block and stage 0.
 */
export function plantCrop(
	field: CropField,
	world: FarmWorld,
	x: number,
	y: number,
	z: number,
	seedItem: ItemId,
): boolean {
	const crop = cropKeyForSeed(seedItem)
	if (crop === undefined) return false
	if (!isFarmland(world.getBlock(x, y - 1, z))) return false
	if (!isReplaceable(world.getBlock(x, y, z))) return false
	const key = cropPosKey(x, y, z)
	if (field.crops.has(key)) return false
	world.setBlock(x, y, z, CROP[crop].block)
	field.crops.set(key, { crop, stage: 0 })
	return true
}

/**
 * Growth roll in [0, 1). A pure function of (seed, tick, position): the tick
 * is folded into the salt, so replays with the same seed match exactly.
 */
export function growthRoll(
	seed: number,
	tick: number,
	x: number,
	y: number,
	z: number,
): number {
	return hash01(seed, hashU32(GROW_SALT, tick | 0), x, y, z)
}

export interface RandomTickOptions {
	seed: number
	tick: number
	/** Omitted means full light. */
	lightAt?: LightLookup
	bus?: EventBusV2 | null
}

export interface CropGrowth {
	x: number
	y: number
	z: number
	crop: CropKey
	/** Stage after the growth step, 1..MAX_CROP_STAGE. */
	stage: number
}

/** Which planted position attempt `n` of this tick visits. */
function pickIndex(seed: number, tick: number, attempt: number, count: number): number {
	return hashU32(seed, PICK_SALT, tick | 0, attempt) % count
}

/** One growth attempt. Returns the growth when the crop advanced a stage. */
function tryGrow(
	field: CropField,
	world: FarmWorld,
	entry: CropEntry,
	options: RandomTickOptions,
): CropGrowth | null {
	const { x, y, z } = entry
	const key = cropPosKey(x, y, z)
	const state = field.crops.get(key)
	if (state === undefined) return null
	const def = CROP[state.crop]
	// The crop block was broken or trampled: drop the stale stage entry.
	if (world.getBlock(x, y, z) !== def.block) {
		field.crops.delete(key)
		return null
	}
	if (state.stage >= MAX_CROP_STAGE) return null
	const light = options.lightAt !== undefined ? options.lightAt(x, y, z) : ASSUMED_LIGHT
	if (light < FARMING.minLight) return null
	const below = world.getBlock(x, y - 1, z)
	if (!isFarmland(below)) return null
	const chance = isWetFarmland(below) ? def.growChanceWet : def.growChanceDry
	if (growthRoll(options.seed, options.tick, x, y, z) >= chance) return null
	state.stage += 1
	if (options.bus !== undefined && options.bus !== null) {
		options.bus.emit(EVENT_V2.CropGrown, { x, y, z, stage: state.stage })
	}
	return { x, y, z, crop: state.crop, stage: state.stage }
}

/**
 * Runs `FARMING.randomTicksPerSection` growth attempts over the planted
 * positions. Attempts skip crops below `FARMING.minLight`, use the wet or dry
 * chance of the farmland below, and advance at most one stage per successful
 * roll up to `MAX_CROP_STAGE`, emitting `EVENT_V2.CropGrown`. A position
 * picked twice in the same tick is only attempted once, because the roll is a
 * pure function of (seed, tick, position) and would otherwise repeat.
 */
export function randomTickCrops(
	field: CropField,
	world: FarmWorld,
	options: RandomTickOptions,
): CropGrowth[] {
	const entries = cropEntries(field)
	if (entries.length === 0) return []
	const grown: CropGrowth[] = []
	const visited = new Set<number>()
	for (let attempt = 0; attempt < FARMING.randomTicksPerSection; attempt++) {
		const index = pickIndex(options.seed, options.tick, attempt, entries.length)
		if (visited.has(index)) continue
		visited.add(index)
		const growth = tryGrow(field, world, entries[index], options)
		if (growth !== null) grown.push(growth)
	}
	return grown
}

export function isMature(field: CropField, x: number, y: number, z: number): boolean {
	return cropStageAt(field, x, y, z) >= MAX_CROP_STAGE
}

/** Base product roll in 0..span, a pure function of the position. */
function productRoll(x: number, y: number, z: number, span: number): number {
	if (span <= 0) return 0
	return hashU32(HARVEST_SEED, PRODUCT_SALT, x, y, z) % (span + 1)
}

/**
 * Fortune bonus: `1 + (hash % floor(fortune))`, so Fortune n adds 1..n extra
 * product on top of the minProduct..maxProduct roll. Deterministic per
 * position; fortune <= 0 adds nothing.
 */
export function fortuneBonus(fortune: number, x: number, y: number, z: number): number {
	const level = Number.isFinite(fortune) && fortune > 0 ? Math.floor(fortune) : 0
	if (level <= 0) return 0
	return 1 + (hashU32(HARVEST_SEED, FORTUNE_SALT, x, y, z) % level)
}

export interface CropHarvest {
	crop: CropKey
	/** Stage the crop had when it was harvested. */
	stage: number
	mature: boolean
	/** Product count, 0 for an immature crop. */
	product: number
	/** Product stack first when mature, then exactly one seed. */
	drops: ItemStack[]
}

/**
 * Harvests the crop at the position. A mature crop drops
 * minProduct..maxProduct product plus the fortune bonus and exactly one seed;
 * an immature crop drops only the seed. The crop is cleared from the field
 * and from the world. Returns null when nothing is planted there.
 */
export function harvestCrop(
	field: CropField,
	world: FarmWorld,
	x: number,
	y: number,
	z: number,
	fortune = 0,
): CropHarvest | null {
	const key = cropPosKey(x, y, z)
	const state = field.crops.get(key)
	if (state === undefined) return null
	const def = CROP[state.crop]
	const stage = state.stage
	const mature = stage >= MAX_CROP_STAGE
	const drops: ItemStack[] = []
	let product = 0
	if (mature) {
		const span = Math.max(0, def.maxProduct - def.minProduct)
		product = def.minProduct + productRoll(x, y, z, span) + fortuneBonus(fortune, x, y, z)
		drops.push({ item: def.product, count: product, damage: 0 })
	}
	drops.push({ item: def.seed, count: 1, damage: 0 })
	field.crops.delete(key)
	if (world.getBlock(x, y, z) === def.block) world.setBlock(x, y, z, BLOCK.AIR)
	return { crop: state.crop, stage, mature, product, drops }
}
