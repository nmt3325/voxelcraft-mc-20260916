/**
 * Internal seam of @voxelcraft/world.
 *
 * Owned by task world-a (L1-A). The L2 tasks implement the interfaces declared
 * here inside their own directories and must not edit this file:
 *   - world-b: `src/noise/**`    -> CreateNoiseBasis / NoiseBasis
 *   - world-c: `src/features/**` -> CreateFeatureSet / FeatureSet
 *
 * The salts and frozen constants below are part of the world format: changing
 * one changes every previously generated world, so they only move together
 * with a WORLD_GEN_VERSION bump (owned by core-types, i.e. by L0).
 *
 * Determinism rules for every file in this package: the only randomness
 * allowed is hashU32 / hash01 / makeRng from core-types. Wall-clock time,
 * global PRNGs and trigonometric helpers are forbidden, because generation
 * must be a pure function of (seed, cx, cz) regardless of call order.
 */
import type {
	BiomeId,
	ClimateSample,
	ColumnSample,
	FbmOptions,
	OreDef,
	VoxelEditView,
} from '@voxelcraft/core-types'
import { BLOCK, SEA_LEVEL } from '@voxelcraft/core-types'

/** Column index inside a chunk. Matches the CHUNK_AREA heightmap layout. */
export function columnIndex(x: number, z: number): number {
	return (z << 4) | x
}

/** Frozen per-field noise salts. */
export const SALT = {
	continent: 0x1101,
	erosion: 0x1102,
	temperature: 0x1103,
	humidity: 0x1104,
	ridge: 0x1105,
	detail: 0x1106,
	warpX: 0x1107,
	warpZ: 0x1108,
	warpX2: 0x1109,
	warpZ2: 0x110a,
	caveCheese: 0x2201,
	caveTunnelA: 0x2202,
	caveTunnelB: 0x2203,
	bedrock: 0x3301,
	ore: 0x4401,
	tree: 0x5501,
	treeKind: 0x5502,
	treeShape: 0x5503,
	plant: 0x5504,
	plantKind: 0x5505,
} as const

export interface NoiseField {
	readonly salt: number
	readonly fbm: FbmOptions
}

export interface WarpField {
	readonly saltX: number
	readonly saltZ: number
	readonly saltX2: number
	readonly saltZ2: number
	readonly amount: number
	readonly frequency: number
}

/** Frozen field parameters shared by the noise layer and the terrain layer. */
export const NOISE_FIELDS: {
	readonly continent: NoiseField
	readonly erosion: NoiseField
	readonly temperature: NoiseField
	readonly humidity: NoiseField
	readonly ridge: NoiseField
	readonly detail: NoiseField
	readonly warp: WarpField
} = {
	continent: {
		salt: SALT.continent,
		fbm: { octaves: 5, lacunarity: 1.98, gain: 0.51, frequency: 1 / 384, rotatePerOctave: true },
	},
	erosion: {
		salt: SALT.erosion,
		fbm: { octaves: 3, lacunarity: 1.98, gain: 0.5, frequency: 1 / 256, rotatePerOctave: true },
	},
	temperature: {
		salt: SALT.temperature,
		fbm: { octaves: 3, lacunarity: 1.98, gain: 0.5, frequency: 1 / 512, rotatePerOctave: true },
	},
	humidity: {
		salt: SALT.humidity,
		fbm: { octaves: 3, lacunarity: 1.98, gain: 0.5, frequency: 1 / 448, rotatePerOctave: true },
	},
	ridge: {
		salt: SALT.ridge,
		fbm: { octaves: 4, lacunarity: 2.01, gain: 0.5, frequency: 1 / 192, rotatePerOctave: true },
	},
	detail: {
		salt: SALT.detail,
		fbm: { octaves: 3, lacunarity: 2.03, gain: 0.5, frequency: 1 / 44, rotatePerOctave: false },
	},
	warp: {
		saltX: SALT.warpX,
		saltZ: SALT.warpZ,
		saltX2: SALT.warpX2,
		saltZ2: SALT.warpZ2,
		amount: 28,
		frequency: 1 / 224,
	},
}

/** Height field shape. Tuned so all six biomes occur at a sane rate. */
export const TERRAIN = {
	minSurfaceY: 6,
	maxSurfaceY: 232,
	/** Surface height where the continent field is 0. */
	baseHeight: SEA_LEVEL + 3,
	continentAmplitude: 34,
	ridgeAmplitude: 62,
	ridgeErosionStart: 0.1,
	ridgeErosionSpan: 0.5,
	detailAmplitude: 4,
	/** Anything under sea level is pushed further down, to carve real basins. */
	oceanDeepenFactor: 1.7,
	/** Filler depth between the stone body and the surface block. */
	topsoilDepth: 4,
} as const

/** Biome decision thresholds. */
export const BIOME_RULES = {
	oceanSurfaceY: SEA_LEVEL - 4,
	mountainSurfaceY: SEA_LEVEL + 22,
	snowyTemperature: -0.3,
	desertTemperature: 0.24,
	desertHumidity: -0.02,
	forestHumidity: 0.08,
} as const

/** 3D cave fields. Sampled on a lattice and trilinearly interpolated. */
export const CAVES = {
	minY: 2,
	maxY: 118,
	/** Carving stops this many blocks below the surface, so the crust survives. */
	surfaceMargin: 4,
	latticeStep: 4,
	cheeseThreshold: 0.62,
	tunnelThreshold: 0.9,
	cheese: { octaves: 3, lacunarity: 2.0, gain: 0.5, frequency: 1 / 40, rotatePerOctave: false },
	tunnel: { octaves: 2, lacunarity: 2.0, gain: 0.5, frequency: 1 / 96, rotatePerOctave: false },
	/** Y is scaled before sampling, so caves are wider than they are tall. */
	verticalSquash: 2.4,
} as const

export const VEGETATION = {
	/** One tree candidate per treeCell x treeCell column cell. */
	treeCell: 4,
	minTrunk: 4,
	maxTrunk: 7,
} as const

/**
 * Depth dependent ore distribution. attemptsPerChunk veins are attempted per
 * chunk, each starting at a Y drawn from a triangular distribution peaking at
 * peakY, so deep ores stay deep.
 */
export const ORES: readonly OreDef[] = [
	{ block: BLOCK.COAL_ORE, minY: 8, maxY: 128, peakY: 52, veinSize: 14, attemptsPerChunk: 20 },
	{ block: BLOCK.IRON_ORE, minY: 6, maxY: 96, peakY: 30, veinSize: 9, attemptsPerChunk: 16 },
	{ block: BLOCK.LAPIS_ORE, minY: 5, maxY: 34, peakY: 18, veinSize: 6, attemptsPerChunk: 4 },
	{ block: BLOCK.GOLD_ORE, minY: 5, maxY: 36, peakY: 15, veinSize: 7, attemptsPerChunk: 5 },
	{ block: BLOCK.REDSTONE_ORE, minY: 5, maxY: 22, peakY: 11, veinSize: 8, attemptsPerChunk: 7 },
	{ block: BLOCK.DIAMOND_ORE, minY: 5, maxY: 18, peakY: 10, veinSize: 5, attemptsPerChunk: 4 },
]

export function isLiquidBlock(id: number): boolean {
	return (
		id === BLOCK.WATER ||
		id === BLOCK.LAVA ||
		id === BLOCK.WATER_FLOWING ||
		id === BLOCK.LAVA_FLOWING
	)
}

export function isPlantBlock(id: number): boolean {
	return (
		id === BLOCK.TALL_GRASS ||
		id === BLOCK.DEAD_BUSH ||
		id === BLOCK.FLOWER_RED ||
		id === BLOCK.FLOWER_YELLOW ||
		id === BLOCK.OAK_SAPLING
	)
}

export function isSolidBlock(id: number): boolean {
	return id !== BLOCK.AIR && !isLiquidBlock(id) && !isPlantBlock(id)
}

/** Terrain a cave is allowed to replace. Bedrock and fluids always stay. */
export function isCarvableBlock(id: number): boolean {
	switch (id) {
		case BLOCK.STONE:
		case BLOCK.DIRT:
		case BLOCK.GRASS_BLOCK:
		case BLOCK.SAND:
		case BLOCK.SANDSTONE:
		case BLOCK.GRAVEL:
		case BLOCK.CLAY:
		case BLOCK.SNOW_BLOCK:
			return true
		default:
			return false
	}
}

export interface WarpResult {
	x: number
	z: number
}

/**
 * Pure noise primitives. Implemented by world-b in `src/noise/**`.
 * Every method must be a pure function of its arguments and the basis seed.
 */
export interface NoiseBasis {
	readonly seed: number
	/** Improved Perlin in [-1, 1]. */
	perlin2(salt: number, x: number, z: number): number
	perlin3(salt: number, x: number, y: number, z: number): number
	fbm2(salt: number, x: number, z: number, opts: FbmOptions): number
	fbm3(salt: number, x: number, y: number, z: number, opts: FbmOptions): number
	/** Ridged multifractal, remapped to [-1, 1]. */
	ridged2(salt: number, x: number, z: number, opts: FbmOptions): number
	/** One domain warp step. */
	warp2(
		saltX: number,
		saltZ: number,
		x: number,
		z: number,
		amount: number,
		frequency: number,
	): WarpResult
	/** Climate fields for a world column, built from NOISE_FIELDS. */
	climateAt(wx: number, wz: number): ClimateSample
}

export type CreateNoiseBasis = (seed: number) => NoiseBasis

/** Terrain surface information. Implemented by world-a in `src/terrain/**`. */
export interface TerrainContext {
	readonly seed: number
	readonly noise: NoiseBasis
	sampleColumn(wx: number, wz: number): ColumnSample
	surfaceYAt(wx: number, wz: number): number
	biomeAt(wx: number, wz: number): BiomeId
	/** Fills CHUNK_AREA surface heights and biome ids, indexed by columnIndex. */
	sampleChunk(cx: number, cz: number, heights: Uint16Array, biomes: Uint8Array): void
}

export interface CaveCarver {
	carveChunk(
		cx: number,
		cz: number,
		blocks: Uint16Array,
		fluids: Uint8Array,
		heights: Uint16Array,
	): void
}

export interface OrePlacer {
	placeChunk(cx: number, cz: number, blocks: Uint16Array, heights: Uint16Array): void
}

export interface Decorator {
	decorate(cx: number, cz: number, view: VoxelEditView): void
}

/** Implemented by world-c in `src/features/**`. */
export interface FeatureSet {
	readonly caves: CaveCarver
	readonly ores: OrePlacer
	readonly decorator: Decorator
}

export type CreateFeatureSet = (terrain: TerrainContext) => FeatureSet
