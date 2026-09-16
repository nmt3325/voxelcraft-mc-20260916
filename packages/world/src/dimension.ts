/**
 * Dimension registry. Owned by task v2-world (L1-F).
 *
 * `createWorldGenerator(seed)` keeps its v1 meaning exactly: the overworld
 * generator, byte for byte, which is what the frozen goldens pin down. A
 * dimension aware caller passes DIMENSION.Nether and gets a nether generator
 * built from the same seed, so one world seed drives both dimensions.
 *
 * The nether chunk pipeline is the shell followed by its features:
 * terrain.fillChunk lays the bedrock floor and roof, the netherrack body, the
 * caverns and the lava sea, then decoration.placeChunk adds the column local
 * features - quartz veins, soul sand and magma patches - to that same buffer.
 * Glowstone clusters hang in the open and may cross a chunk border, so they
 * run later from decorate through the VoxelEditView, the same way overworld
 * vegetation does.
 *
 * DIMENSION_PARAMS, NETHER_GEN and BIOME are frozen in core-types; nothing
 * here redefines or shadows them.
 */
import type {
	BiomeId,
	ColumnSample,
	DimensionId,
	DimensionParams,
	VoxelEditView,
	WorldGenerator,
} from '@voxelcraft/core-types'
import { BIOME, DIMENSION_PARAMS, WORLD_GEN_VERSION } from '@voxelcraft/core-types'
import { createNetherDecoration, createNetherTerrain } from './nether'
import { createNoiseBasis } from './noise'

/**
 * The frozen BIOME map has no nether entry and BIOME belongs to core-types, so
 * every nether column reports Plains. Callers that need to tell the dimensions
 * apart read DIMENSION_PARAMS, not the biome id.
 */
export const NETHER_BIOME: BiomeId = BIOME.Plains

/** Frozen parameters of one dimension: ceiling, sea level, sky light, scale. */
export function dimensionParams(dimension: DimensionId): DimensionParams {
	return DIMENSION_PARAMS[dimension]
}

/**
 * Nether generator: rough bedrock floor, netherrack shell, noise caverns, a
 * bedrock roof that seals the dimension, the lava sea at the frozen level, and
 * the ores, patches and glowstone clusters on top of all of it.
 */
export function createNetherGenerator(seed: number): WorldGenerator {
	const s = seed >>> 0
	const noise = createNoiseBasis(s)
	const terrain = createNetherTerrain(s, noise)
	const decoration = createNetherDecoration(s, noise, terrain)

	return {
		seed: s,
		version: WORLD_GEN_VERSION,

		sampleColumn(wx: number, wz: number): ColumnSample {
			// A nether column has no sky, so "surface" means the lowest standable
			// spot above the lava sea: what a spawn or a portal landing needs.
			return {
				surfaceY: terrain.floorYAt(wx, wz),
				biome: NETHER_BIOME,
				climate: noise.climateAt(wx, wz),
			}
		},

		biomeAt(): BiomeId {
			return NETHER_BIOME
		},

		generateChunk(cx: number, cz: number, blocks: Uint16Array, fluids: Uint8Array): void {
			blocks.fill(0)
			fluids.fill(0)
			terrain.fillChunk(cx, cz, blocks, fluids)
			decoration.placeChunk(cx, cz, blocks, fluids)
		},

		decorate(cx: number, cz: number, view: VoxelEditView): void {
			decoration.decorate(cx, cz, view)
		},
	}
}
