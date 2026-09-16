/**
 * @voxelcraft/world - deterministic, infinite terrain generation.
 *
 * Pipeline for one chunk:
 *   1. sampleChunk    surface height and biome for all 256 columns
 *   2. fillChunkColumns bedrock, stone, biome surface, ocean up to SEA_LEVEL
 *   3. caves.carveChunk 3D noise caves under a protected surface crust
 *   4. ores.placeChunk  depth weighted veins from the 3x3 neighbourhood
 * decorate() then adds trees and plants through a VoxelEditView, because those
 * features may cross a chunk border.
 *
 * Every step is a pure function of (seed, cx, cz), so generating a region
 * forwards, backwards or in parallel quarters produces byte identical chunks.
 */
import type { BiomeId, ColumnSample, VoxelEditView, WorldGenerator } from '@voxelcraft/core-types'
import { CHUNK_AREA, WORLD_GEN_VERSION } from '@voxelcraft/core-types'
import { createFeatureSet } from './features'
import { createNoiseBasis } from './noise'
import { fillChunkColumns } from './terrain/column'
import { createTerrain } from './terrain/height'

export const PACKAGE_NAME = '@voxelcraft/world'

export function createWorldGenerator(seed: number): WorldGenerator {
	const s = seed >>> 0
	const noise = createNoiseBasis(s)
	const terrain = createTerrain(s, noise)
	const features = createFeatureSet(terrain)
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
		},
	}
}

export * from './internal'
export { BIOMES, biomeDef, chooseBiome } from './biome'
export { createNoiseBasis } from './noise'
export { createFeatureSet } from './features'
export { createTerrain, surfaceHeight } from './terrain/height'
export { fillChunkColumns } from './terrain/column'
export { ChunkGrid, chunkCoords, generateRegion } from './testing/chunk-grid'
export type { GeneratedChunk, GenerationOrder } from './testing/chunk-grid'
