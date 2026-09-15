/**
 * Height field and column sampling. Owned by task world-a.
 *
 * Every value here is a pure function of (seed, wx, wz), which is what makes
 * generateChunk independent of generation order: two chunks that share a border
 * compute the same column from the same inputs.
 */
import type { BiomeId, ClimateSample, ColumnSample } from '@voxelcraft/core-types'
import { CHUNK_X, CHUNK_Z, SEA_LEVEL } from '@voxelcraft/core-types'
import { chooseBiome } from '../biome'
import type { NoiseBasis, TerrainContext } from '../internal'
import { NOISE_FIELDS, SALT, TERRAIN, columnIndex } from '../internal'

function clamp01(v: number): number {
	return v < 0 ? 0 : v > 1 ? 1 : v
}

function clampSurface(y: number): number {
	if (y < TERRAIN.minSurfaceY) return TERRAIN.minSurfaceY
	if (y > TERRAIN.maxSurfaceY) return TERRAIN.maxSurfaceY
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
	let h = TERRAIN.baseHeight + climate.continent * TERRAIN.continentAmplitude
	const ridgeWeight = clamp01(
		(climate.erosion - TERRAIN.ridgeErosionStart) / TERRAIN.ridgeErosionSpan,
	)
	if (ridgeWeight > 0) {
		const ridge = noise.ridged2(SALT.ridge, wx, wz, NOISE_FIELDS.ridge.fbm)
		h += (ridge + 1) * 0.5 * TERRAIN.ridgeAmplitude * ridgeWeight
	}
	h += noise.fbm2(SALT.detail, wx, wz, NOISE_FIELDS.detail.fbm) * TERRAIN.detailAmplitude
	if (h < SEA_LEVEL) h = SEA_LEVEL - (SEA_LEVEL - h) * TERRAIN.oceanDeepenFactor
	return clampSurface(Math.round(h))
}

export function createTerrain(seed: number, noise: NoiseBasis): TerrainContext {
	function sampleColumn(wx: number, wz: number): ColumnSample {
		const climate = noise.climateAt(wx, wz)
		const surfaceY = surfaceHeight(noise, wx, wz, climate)
		return { surfaceY, biome: chooseBiome(surfaceY, climate), climate }
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
