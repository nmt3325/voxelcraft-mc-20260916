/**
 * v2 world contract: extra dimensions, portals, village structures and the
 * additive block/item ids they need. Additive only: every v1 id keeps its
 * meaning so existing saves stay readable.
 */
import type { BlockId, ItemId } from '../ids'
import { BLOCK } from '../blocks'
import { BIOME } from '../world'

export const DIMENSION = { Overworld: 0, Nether: 1 } as const
export type DimensionId = (typeof DIMENSION)[keyof typeof DIMENSION]
export const DIMENSION_COUNT = 2

export interface DimensionParams {
	readonly id: DimensionId
	readonly name: string
	/** Highest generated y. Chunks stay CHUNK_Y tall in every dimension. */
	readonly ceilingY: number
	readonly seaLevel: number
	/** Skylight injected at the top of a column, 0..15. */
	readonly skyLight: number
	readonly hasSky: boolean
	/** Horizontal scale when travelling from the Overworld. */
	readonly coordinateScale: number
	readonly ambientFluid: 'none' | 'water' | 'lava'
	/** Save-file sub-namespace. Chunk keys are `${dimensionKey}:${cx},${cz}`. */
	readonly dimensionKey: string
}

export const DIMENSION_PARAMS: Readonly<Record<DimensionId, DimensionParams>> = {
	0: {
		id: DIMENSION.Overworld,
		name: 'overworld',
		ceilingY: 255,
		seaLevel: 62,
		skyLight: 15,
		hasSky: true,
		coordinateScale: 1,
		ambientFluid: 'water',
		dimensionKey: 'ow',
	},
	1: {
		id: DIMENSION.Nether,
		name: 'nether',
		ceilingY: 127,
		seaLevel: 31,
		skyLight: 0,
		hasSky: false,
		coordinateScale: 8,
		ambientFluid: 'lava',
		dimensionKey: 'nt',
	},
}

/**
 * Nether generation knobs. The generator reuses the v1 3D noise cave sampler
 * with these thresholds instead of a second noise implementation.
 */
export const NETHER_GEN = {
	/** Solid netherrack shell below this y and above bedrockLayers. */
	roofY: 120,
	floorY: 4,
	lavaSeaLevel: 31,
	/** 3D noise above this value carves open space. */
	caveThreshold: 0.42,
	quartzOreChancePerColumn: 0.18,
	glowstoneClustersPerChunk: 2,
	soulSandPatchChance: 0.22,
	magmaPatchChance: 0.12,
	bedrockLayers: 4,
	/** Bump when nether terrain output changes; goldens key off this. */
	genVersion: 1,
} as const

export const PORTAL = {
	frameBlock: BLOCK.OBSIDIAN as BlockId,
	/** Inner opening, excluding the frame. */
	minInnerWidth: 2,
	minInnerHeight: 3,
	maxInnerWidth: 21,
	maxInnerHeight: 21,
	/** Ticks of continuous contact before the player is moved. */
	travelDelayTicks: 80,
	/** Ticks before the same entity can travel again. */
	cooldownTicks: 300,
	/** Search radius, in blocks, for an existing portal on the far side. */
	linkSearchRadius: 64,
	/** Portal blocks emit this much block light. */
	lightLevel: 11,
} as const

/** Additive v2 block ids. v1 owns 0..63; v2 owns 64..99. */
export const BLOCK_V2 = {
	NETHERRACK: 64,
	NETHER_PORTAL: 65,
	SOUL_SAND: 66,
	QUARTZ_ORE: 67,
	NETHER_BRICKS: 68,
	MAGMA_BLOCK: 69,
	FARMLAND: 70,
	FARMLAND_WET: 71,
	WHEAT_CROP: 72,
	CARROT_CROP: 73,
	POTATO_CROP: 74,
	ENCHANTING_TABLE: 75,
	BOOKSHELF: 76,
	GRAVEL_PATH: 77,
	COBBLESTONE_WALL: 78,
	HAY_BLOCK: 79,
	FENCE: 80,
	FENCE_GATE: 81,
} as const
export type BlockV2KeyName = keyof typeof BLOCK_V2
export const BLOCK_V2_BASE = 64
export const BLOCK_V2_MAX = 99

/** Additive v2 item ids. v1 owns 256..304; v2 owns 305..383. */
export const ITEM_V2 = {
	WHEAT_SEEDS: 305,
	WHEAT: 306,
	BREAD: 307,
	CARROT: 308,
	POTATO: 309,
	BAKED_POTATO: 310,
	ENCHANTED_BOOK: 311,
	NETHER_QUARTZ: 312,
	FLINT_AND_STEEL: 313,
	EGG: 314,
	RAW_BEEF: 315,
	COOKED_BEEF: 316,
	RAW_PORK: 317,
	COOKED_PORK: 318,
	RAW_CHICKEN: 319,
	COOKED_CHICKEN: 320,
	MUTTON: 321,
	LEATHER: 322,
} as const
export type ItemV2KeyName = keyof typeof ITEM_V2
export const ITEM_V2_BASE = 305
export const ITEM_V2_MAX = 383

export const STRUCTURE = {
	Well: 0,
	House: 1,
	Farm: 2,
	Church: 3,
	Smithy: 4,
	Lamp: 5,
} as const
export type StructureKind = (typeof STRUCTURE)[keyof typeof STRUCTURE]

/**
 * Village placement. Selection is a pure function of (seed, regionX, regionZ)
 * so a village is reproducible without storing structure state.
 */
export const VILLAGE = {
	/** Candidate grid: one village per region at most. */
	regionChunks: 32,
	/** Chunks of jitter inside the region, keeping villages apart. */
	jitterChunks: 10,
	spawnChancePercent: 35,
	minBuildings: 3,
	maxBuildings: 7,
	buildingMaxFootprint: 9,
	maxHeightVariance: 6,
	wellRadius: 2,
	pathWidth: 1,
	/** Villages only generate in these biomes. */
	allowedBiomes: [BIOME.Plains, BIOME.Forest, BIOME.Desert] as readonly number[],
	/** Bump when layouts change; village goldens key off this. */
	layoutVersion: 1,
} as const

export interface StructurePiece {
	readonly kind: StructureKind
	/** World-space origin of the piece footprint. */
	readonly x: number
	readonly y: number
	readonly z: number
	readonly sizeX: number
	readonly sizeY: number
	readonly sizeZ: number
	/** 0..3 quarter turns around +y. */
	readonly rotation: 0 | 1 | 2 | 3
}

export interface VillagePlan {
	readonly seed: number
	readonly regionX: number
	readonly regionZ: number
	/** Center column of the village, world space. */
	readonly centerX: number
	readonly centerZ: number
	readonly pieces: readonly StructurePiece[]
}

/** Items a crop drops and the seed it replants. */
export interface CropDrop {
	readonly product: ItemId
	readonly seed: ItemId
	readonly minProduct: number
	readonly maxProduct: number
}
