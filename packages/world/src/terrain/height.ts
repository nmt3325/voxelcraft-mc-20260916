/**
 * Height field and column sampling. Owned by task world-a.
 *
 * Every value here is a pure function of (seed, wx, wz), which is what makes
 * generateChunk independent of generation order: two chunks that share a border
 * compute the same column from the same inputs.
 *
 * H-06 (output is bit-identical): the frozen tuning tables and the two noise
 * field descriptors are read once at module scope instead of once per column,
 * and `chooseBiome` is bound once. `surfaceHeight` runs about 320 times per
 * chunk (256 columns plus the cave halo), and each run used to pay a namespace
 * getter plus a property load for every constant it touches. No arithmetic was
 * reordered.
 */
import type { BiomeId, ClimateSample, ColumnSample } from '@voxelcraft/core-types'
import { CHUNK_X, CHUNK_Z, SEA_LEVEL } from '@voxelcraft/core-types'
import { chooseBiome } from '../biome'
import type { NoiseBasis, TerrainContext } from '../internal'
import { NOISE_FIELDS, SALT, TERRAIN, columnIndex } from '../internal'

/* Same function and the same frozen values, resolved once. */
const pickBiome = chooseBiome
const MIN_SURFACE_Y = TERRAIN.minSurfaceY
const MAX_SURFACE_Y = TERRAIN.maxSurfaceY
const BASE_HEIGHT = TERRAIN.baseHeight
const CONTINENT_AMPLITUDE = TERRAIN.continentAmplitude
const RIDGE_AMPLITUDE = TERRAIN.ridgeAmplitude
const RIDGE_EROSION_START = TERRAIN.ridgeErosionStart
const RIDGE_EROSION_SPAN = TERRAIN.ridgeErosionSpan
const DETAIL_AMPLITUDE = TERRAIN.detailAmplitude
const OCEAN_DEEPEN_FACTOR = TERRAIN.oceanDeepenFactor
const SALT_RIDGE = SALT.ridge
const SALT_DETAIL = SALT.detail
const RIDGE_FBM = NOISE_FIELDS.ridge.fbm
const DETAIL_FBM = NOISE_FIELDS.detail.fbm

function clamp01(v: number): number {
	return v < 0 ? 0 : v > 1 ? 1 : v
}

function clampSurface(y: number): number {
	if (y < MIN_SURFACE_Y) return MIN_SURFACE_Y
	if (y > MAX_SURFACE_Y) return MAX_SURFACE_Y
	return y
}

/**
 * Surface height of a world column.
 *
 * continent sets the base elevation, erosion decides how much of the ridged
 * mountain term is mixed in, and a small high frequency term adds local relief.
 * Anything below sea level is pushed further down so ocean basins are deep
 * enough to read as ocean rather than as a puddle.
 */
export function surfaceHeight(
	noise: NoiseBasis,
	wx: number,
	wz: number,
	climate: ClimateSample,
): number {
	let h = BASE_HEIGHT + climate.continent * CONTINENT_AMPLITUDE
	const ridgeWeight = clamp01((climate.erosion - RIDGE_EROSION_START) / RIDGE_EROSION_SPAN)
	if (ridgeWeight > 0) {
		const ridge = noise.ridged2(SALT_RIDGE, wx, wz, RIDGE_FBM)
		h += (ridge + 1) * 0.5 * RIDGE_AMPLITUDE * ridgeWeight
	}
	h += noise.fbm2(SALT_DETAIL, wx, wz, DETAIL_FBM) * DETAIL_AMPLITUDE
	if (h < SEA_LEVEL) h = SEA_LEVEL - (SEA_LEVEL - h) * OCEAN_DEEPEN_FACTOR
	return clampSurface(Math.round(h))
}

export function createTerrain(seed: number, noise: NoiseBasis): TerrainContext {
	function sampleColumn(wx: number, wz: number): ColumnSample {
		const climate = noise.climateAt(wx, wz)
		const surfaceY = surfaceHeight(noise, wx, wz, climate)
		return { surfaceY, biome: pickBiome(surfaceY, climate), climate }
	}

	return {
		seed,
		noise,
		sampleColumn,
		surfaceYAt(wx: number, wz: number): number {
			return surfaceHeight(noise, wx, wz, noise.climateAt(wx, wz))
		},
		biomeAt(wx: number, wz: number): BiomeId {
			return sampleColumn(wx, wz).biome
		},
		sampleChunk(cx: number, cz: number, heights: Uint16Array, biomes: Uint8Array): void {
			const bx = cx * CHUNK_X
			const bz = cz * CHUNK_Z
			for (let z = 0; z < CHUNK_Z; z++) {
				for (let x = 0; x < CHUNK_X; x++) {
					const sample = sampleColumn(bx + x, bz + z)
					const i = columnIndex(x, z)
					heights[i] = sample.surfaceY
					biomes[i] = sample.biome
				}
			}
		},
	}
}
