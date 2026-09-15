import type { BiomeId, BlockId } from './ids'

export const BIOME = {
	Plains: 0,
	Forest: 1,
	Desert: 2,
	Snowy: 3,
	Mountains: 4,
	Ocean: 5,
} as const
export type BiomeKind = (typeof BIOME)[keyof typeof BIOME]

export const SEA_LEVEL = 62
export const BEDROCK_LAYERS = 4
export const WORLD_GEN_VERSION = 1

export interface BiomeDef {
	id: BiomeId
	name: string
	displayName: string
	surface: BlockId
	filler: BlockId
	underwater: BlockId
	/** 0xRRGGBB tint applied by the shader. */
	grassColor: number
	foliageColor: number
	/** Trees per chunk (expected value). */
	treeDensity: number
	plantDensity: number
	temperature: number
	humidity: number
	snow: boolean
}

export interface ClimateSample {
	temperature: number
	humidity: number
	continent: number
	erosion: number
}

export interface ColumnSample {
	surfaceY: number
	biome: BiomeId
	climate: ClimateSample
}

/** Read-only voxel access across chunk boundaries. */
export interface VoxelView {
	getBlock(x: number, y: number, z: number): BlockId
	getFluid(x: number, y: number, z: number): number
	isSolid(x: number, y: number, z: number): boolean
	isLiquid(x: number, y: number, z: number): boolean
	isLoaded(cx: number, cz: number): boolean
}

export interface VoxelEditView extends VoxelView {
	setBlock(x: number, y: number, z: number, id: BlockId): void
	setFluid(x: number, y: number, z: number, packed: number): void
}

/**
 * Deterministic world generator. generateChunk MUST be a pure function of
 * (seed, cx, cz): no global PRNG, no Date, no Math.random, no Math.sin.
 */
export interface WorldGenerator {
	readonly seed: number
	readonly version: number
	sampleColumn(wx: number, wz: number): ColumnSample
	generateChunk(cx: number, cz: number, blocks: Uint16Array, fluids: Uint8Array): void
	/** Trees and plants that may cross a chunk border. Runs after the 3x3 neighbours exist. */
	decorate(cx: number, cz: number, view: VoxelEditView): void
	biomeAt(wx: number, wz: number): BiomeId
}

export type Noise2 = (x: number, z: number) => number
export type Noise3 = (x: number, y: number, z: number) => number

export interface FbmOptions {
	octaves: number
	lacunarity: number
	gain: number
	frequency: number
	rotatePerOctave?: boolean
}

export interface OreDef {
	block: BlockId
	minY: number
	maxY: number
	peakY: number
	veinSize: number
	attemptsPerChunk: number
}
