import {
	BLOCK,
	BLOCK_V2,
	FARMING,
	type BlockId,
	type ItemStack,
} from '@voxelcraft/core-types'

/**
 * Farmland: tilling soil with the hoe, water hydration and trampling.
 *
 * v1 chunks carry no per-block metadata, so anything that cannot live in a
 * block id lives in caller-owned state: wet and dry farmland are two separate
 * ids, and the fall-impact counter sits in a `TrampleTracker`.
 */

/**
 * Minimal voxel access the farming code needs. Declared locally on purpose so
 * this folder never imports `@voxelcraft/world` or `@voxelcraft/sim`; the real
 * world and a small test fake both satisfy it.
 */
export interface FarmWorld {
	getBlock(x: number, y: number, z: number): BlockId
	setBlock(x: number, y: number, z: number, id: BlockId): void
}

/** Block light 0..15 at a position. Always passed in as an option. */
export type LightLookup = (x: number, y: number, z: number) => number

/** Light assumed when no `lightAt` lookup is supplied. */
export const ASSUMED_LIGHT = 15

/** Dry farmland first, wet farmland second. */
export const FARMLAND_BLOCKS: readonly BlockId[] = [BLOCK_V2.FARMLAND, BLOCK_V2.FARMLAND_WET]

/** The three v2 crop blocks. Their stage lives in a `CropField`, not in the id. */
export const CROP_BLOCKS: readonly BlockId[] = [
	BLOCK_V2.WHEAT_CROP,
	BLOCK_V2.CARROT_CROP,
	BLOCK_V2.POTATO_CROP,
]

/**
 * Blocks that tilling and planting may overwrite: air plus the thin v1 plant
 * and snow cover. Anything else counts as occupied.
 */
export const REPLACEABLE_BLOCKS: readonly BlockId[] = [
	BLOCK.AIR,
	BLOCK.TALL_GRASS,
	BLOCK.DEAD_BUSH,
	BLOCK.FLOWER_RED,
	BLOCK.FLOWER_YELLOW,
	BLOCK.OAK_SAPLING,
	BLOCK.SNOW_LAYER,
]

/** Blocks the hoe turns into farmland. */
export const TILLABLE_BLOCKS: readonly BlockId[] = [BLOCK.DIRT, BLOCK.GRASS_BLOCK]

/** Still and flowing water both hydrate. */
export const WATER_BLOCKS: readonly BlockId[] = [BLOCK.WATER, BLOCK.WATER_FLOWING]

/** Stable string key for a voxel position, coordinates truncated to integers. */
export function farmPosKey(x: number, y: number, z: number): string {
	return `${x | 0},${y | 0},${z | 0}`
}

export function isFarmland(id: BlockId): boolean {
	return id === BLOCK_V2.FARMLAND || id === BLOCK_V2.FARMLAND_WET
}

export function isWetFarmland(id: BlockId): boolean {
	return id === BLOCK_V2.FARMLAND_WET
}

export function isCropBlock(id: BlockId): boolean {
	return CROP_BLOCKS.includes(id)
}

/** True when the block may be overwritten by tilling or planting. */
export function isReplaceable(id: BlockId): boolean {
	return REPLACEABLE_BLOCKS.includes(id)
}

export function isWater(id: BlockId): boolean {
	return id === BLOCK.WATER || id === BLOCK.WATER_FLOWING
}

/** True when the held stack is the contract's hoe item. */
export function isHoe(heldStack: ItemStack | null | undefined): boolean {
	if (heldStack === null || heldStack === undefined || heldStack.count <= 0) return false
	return heldStack.item === FARMING.hoeItem
}

/**
 * Turns dirt or grass into dry farmland when the held item is
 * `FARMING.hoeItem` and the block above is air or replaceable. A replaceable
 * cover block (tall grass, a flower, a snow layer) is cleared to air; anything
 * else above rejects the till. Returns whether the world changed.
 */
export function tillSoil(
	world: FarmWorld,
	x: number,
	y: number,
	z: number,
	heldStack: ItemStack | null | undefined,
): boolean {
	if (!isHoe(heldStack)) return false
	if (!TILLABLE_BLOCKS.includes(world.getBlock(x, y, z))) return false
	const above = world.getBlock(x, y + 1, z)
	if (!isReplaceable(above)) return false
	if (above !== BLOCK.AIR) world.setBlock(x, y + 1, z, BLOCK.AIR)
	world.setBlock(x, y, z, BLOCK_V2.FARMLAND)
	return true
}

/**
 * Water search shape, kept cheap and symmetric:
 * `|dx| <= FARMING.hydrationRadius`, `|dz| <= FARMING.hydrationRadius` and
 * `dy` in `{0, +1}` — a 9x2x9 box measured with the Chebyshev distance, so
 * water 4 blocks away hydrates while water 5 blocks away does not. Water
 * below the farmland is ignored.
 */
export function isHydrated(world: FarmWorld, x: number, y: number, z: number): boolean {
	const r = FARMING.hydrationRadius
	for (let dy = 0; dy <= 1; dy++) {
		for (let dz = -r; dz <= r; dz++) {
			for (let dx = -r; dx <= r; dx++) {
				if (isWater(world.getBlock(x + dx, y + dy, z + dz))) return true
			}
		}
	}
	return false
}

/**
 * Switches farmland between `FARMLAND` and `FARMLAND_WET` from `isHydrated`.
 * Non-farmland is left alone. Returns whether the block id changed.
 */
export function updateFarmland(world: FarmWorld, x: number, y: number, z: number): boolean {
	const current = world.getBlock(x, y, z)
	if (!isFarmland(current)) return false
	const wanted = isHydrated(world, x, y, z) ? BLOCK_V2.FARMLAND_WET : BLOCK_V2.FARMLAND
	if (current === wanted) return false
	world.setBlock(x, y, z, wanted)
	return true
}

/** Per-position fall-impact counter. Owned by the caller, never by the world. */
export interface TrampleTracker {
	impacts: Map<string, number>
}

export function createTrampleTracker(): TrampleTracker {
	return { impacts: new Map<string, number>() }
}

export interface TrampleOptions {
	/** Impact counter to accumulate into. */
	tracker: TrampleTracker
	/**
	 * Called with the crop position after a crop above the farmland is cleared,
	 * so crop stage state can drop it without this file importing `crops.ts`.
	 */
	onCropCleared?: (x: number, y: number, z: number) => void
}

export interface TrampleResult {
	/** The farmland became dirt on this call. */
	reverted: boolean
	/** Impacts counted at this position, including this call. */
	impacts: number
	cropCleared: boolean
}

/**
 * Counts `falls` fall impacts on the farmland at (x, y, z). Once the total
 * reaches `FARMING.trampleFalls` the block reverts to `BLOCK.DIRT`, any crop
 * directly above is removed and the counter is cleared.
 */
export function trampleFarmland(
	world: FarmWorld,
	x: number,
	y: number,
	z: number,
	falls: number,
	options: TrampleOptions,
): TrampleResult {
	const key = farmPosKey(x, y, z)
	const tracker = options.tracker
	if (!isFarmland(world.getBlock(x, y, z))) {
		tracker.impacts.delete(key)
		return { reverted: false, impacts: 0, cropCleared: false }
	}
	const added = Number.isFinite(falls) && falls > 0 ? Math.floor(falls) : 0
	const impacts = (tracker.impacts.get(key) ?? 0) + added
	if (impacts < FARMING.trampleFalls) {
		tracker.impacts.set(key, impacts)
		return { reverted: false, impacts, cropCleared: false }
	}
	tracker.impacts.delete(key)
	world.setBlock(x, y, z, BLOCK.DIRT)
	let cropCleared = false
	if (isCropBlock(world.getBlock(x, y + 1, z))) {
		world.setBlock(x, y + 1, z, BLOCK.AIR)
		cropCleared = true
		if (options.onCropCleared !== undefined) options.onCropCleared(x, y + 1, z)
	}
	return { reverted: true, impacts, cropCleared }
}
