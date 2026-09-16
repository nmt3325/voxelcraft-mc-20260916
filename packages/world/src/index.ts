/**
 * @voxelcraft/world - deterministic, infinite terrain generation.
 *
 * Pipeline for one overworld chunk:
 *   1. sampleChunk    surface height and biome for all 256 columns
 *   2. fillChunkColumns bedrock, stone, biome surface, ocean up to SEA_LEVEL
 *   3. caves.carveChunk 3D noise caves under a protected surface crust
 *   4. ores.placeChunk  depth weighted veins from the 3x3 neighbourhood
 * decorate() then adds trees and plants and finally villages, all through a
 * VoxelEditView, because those features may cross a chunk border. Nothing in
 * decorate() touches generateChunk output, so the frozen goldens still hold.
 *
 * The nether runs its own pipeline in `src/nether/`, selected through the
 * dimension argument of createWorldGenerator. The default stays the overworld,
 * so every v1 caller and every frozen golden keeps its exact behaviour.
 *
 * Portals are driven by the caller rather than by chunk generation, so
 * `src/portal/` is exported as a factory instead of hanging off the frozen
 * WorldGenerator shape.
 *
 * Every step is a pure function of (seed, cx, cz), so generating a region
 * forwards, backwards or in parallel quarters produces byte identical chunks.
 */
import type {
	BiomeId,
	ColumnSample,
	DimensionId,
	VoxelEditView,
	WorldGenerator,
} from '@voxelcraft/core-types'
import { CHUNK_AREA, DIMENSION, WORLD_GEN_VERSION } from '@voxelcraft/core-types'
import { createNetherGenerator } from './dimension'
import { createFeatureSet } from './features'
import { createNoiseBasis } from './noise'
import { fillChunkColumns } from './terrain/column'
import { createTerrain } from './terrain/height'
import { createVillageBuilder } from './village'

export const PACKAGE_NAME = '@voxelcraft/world'

/** Overworld generator. This is what the frozen goldens describe. */
export function createOverworldGenerator(seed: number): WorldGenerator {
	const s = seed >>> 0
	const noise = createNoiseBasis(s)
	const terrain = createTerrain(s, noise)
	const features = createFeatureSet(terrain)
	// Villages are planned per 32x32 chunk region and those plans are cached, so
	// the builder belongs to the generator rather than to a single chunk.
	const villages = createVillageBuilder(terrain)
	// Reused scratch buffers: both are fully rewritten at the start of every
	// generateChunk call, so they never leak state between chunks.
	const heights = new Uint16Array(CHUNK_AREA)
	const biomes = new Uint8Array(CHUNK_AREA)

	return {
		seed: s,
		version: WORLD_GEN_VERSION,

		sampleColumn(wx: number, wz: number): ColumnSample {
			return terrain.sampleColumn(wx, wz)
		},

		biomeAt(wx: number, wz: number): BiomeId {
			return terrain.biomeAt(wx, wz)
		},

		generateChunk(cx: number, cz: number, blocks: Uint16Array, fluids: Uint8Array): void {
			blocks.fill(0)
			fluids.fill(0)
			terrain.sampleChunk(cx, cz, heights, biomes)
			fillChunkColumns(s, cx, cz, blocks, fluids, heights, biomes)
			features.caves.carveChunk(cx, cz, blocks, fluids, heights)
			features.ores.placeChunk(cx, cz, blocks, heights)
		},

		decorate(cx: number, cz: number, view: VoxelEditView): void {
			features.decorator.decorate(cx, cz, view)
			villages.decorate(cx, cz, view)
		},
	}
}

/**
 * Generator for one dimension of one seed. The dimension argument is optional
 * and defaults to the overworld, so `createWorldGenerator(seed)` means exactly
 * what it meant in v1.
 */
export function createWorldGenerator(
	seed: number,
	dimension: DimensionId = DIMENSION.Overworld,
): WorldGenerator {
	return dimension === DIMENSION.Nether
		? createNetherGenerator(seed)
		: createOverworldGenerator(seed)
}

export * from './internal'
export { BIOMES, biomeDef, chooseBiome } from './biome'
export { NETHER_BIOME, createNetherGenerator, dimensionParams } from './dimension'
export { createNetherTerrain } from './nether'
export { createNoiseBasis } from './noise'
export { createFeatureSet } from './features'
export { createTerrain, surfaceHeight } from './terrain/height'
export { fillChunkColumns } from './terrain/column'
export { createVillageBuilder, createVillagePlanner } from './village'
export {
	LANDING_SEARCH_RADIUS,
	createPortalLinker,
	makeFrame,
	validateFrameAt,
	writeFrame,
} from './portal'
export { ChunkGrid, chunkCoords, generateRegion } from './testing/chunk-grid'
export type { GeneratedChunk, GenerationOrder } from './testing/chunk-grid'
