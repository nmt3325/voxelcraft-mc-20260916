/**
 * The six v1 biomes. Owned by task world-a.
 *
 * BIOMES is indexed by BiomeId, so the array order must stay identical to the
 * BIOME map in core-types.
 */
import type { BiomeDef, BiomeId, ClimateSample } from '@voxelcraft/core-types'
import { BIOME, BLOCK } from '@voxelcraft/core-types'
import { BIOME_RULES } from '../internal'

export const BIOMES: readonly BiomeDef[] = [
	{
		id: BIOME.Plains,
		name: 'plains',
		displayName: 'Plains',
		surface: BLOCK.GRASS_BLOCK,
		filler: BLOCK.DIRT,
		underwater: BLOCK.SAND,
		grassColor: 0x91bd59,
		foliageColor: 0x77ab2f,
		treeDensity: 1,
		plantDensity: 10,
		temperature: 0.4,
		humidity: 0.2,
		snow: false,
	},
	{
		id: BIOME.Forest,
		name: 'forest',
		displayName: 'Forest',
		surface: BLOCK.GRASS_BLOCK,
		filler: BLOCK.DIRT,
		underwater: BLOCK.SAND,
		grassColor: 0x79c05a,
		foliageColor: 0x59ae30,
		treeDensity: 8,
		plantDensity: 6,
		temperature: 0.3,
		humidity: 0.6,
		snow: false,
	},
	{
		id: BIOME.Desert,
		name: 'desert',
		displayName: 'Desert',
		surface: BLOCK.SAND,
		filler: BLOCK.SANDSTONE,
		underwater: BLOCK.SAND,
		grassColor: 0xbfb755,
		foliageColor: 0xaea42a,
		treeDensity: 0.5,
		plantDensity: 2,
		temperature: 0.95,
		humidity: -0.4,
		snow: false,
	},
	{
		id: BIOME.Snowy,
		name: 'snowy_plains',
		displayName: 'Snowy Plains',
		surface: BLOCK.SNOW_BLOCK,
		filler: BLOCK.DIRT,
		underwater: BLOCK.GRAVEL,
		grassColor: 0x80b497,
		foliageColor: 0x60a17b,
		treeDensity: 2,
		plantDensity: 1,
		temperature: -0.6,
		humidity: 0.3,
		snow: true,
	},
	{
		id: BIOME.Mountains,
		name: 'mountains',
		displayName: 'Mountains',
		surface: BLOCK.STONE,
		filler: BLOCK.STONE,
		underwater: BLOCK.GRAVEL,
		grassColor: 0x8ab689,
		foliageColor: 0x6da36b,
		treeDensity: 1,
		plantDensity: 2,
		temperature: 0.05,
		humidity: 0.3,
		snow: false,
	},
	{
		id: BIOME.Ocean,
		name: 'ocean',
		displayName: 'Ocean',
		surface: BLOCK.SAND,
		filler: BLOCK.CLAY,
		underwater: BLOCK.SAND,
		grassColor: 0x8eb971,
		foliageColor: 0x71a74d,
		treeDensity: 0,
		plantDensity: 0,
		temperature: 0.5,
		humidity: 0.5,
		snow: false,
	},
]

export function biomeDef(id: BiomeId): BiomeDef {
	const def = BIOMES[id]
	return def === undefined ? BIOMES[BIOME.Plains] : def
}

/**
 * Biome from the surface height and the climate sample. Pure, and independent
 * of generation order because both inputs are pure functions of the column.
 */
export function chooseBiome(surfaceY: number, climate: ClimateSample): BiomeId {
	if (surfaceY <= BIOME_RULES.oceanSurfaceY) return BIOME.Ocean
	if (surfaceY >= BIOME_RULES.mountainSurfaceY) return BIOME.Mountains
	if (climate.temperature <= BIOME_RULES.snowyTemperature) return BIOME.Snowy
	if (
		climate.temperature >= BIOME_RULES.desertTemperature &&
		climate.humidity <= BIOME_RULES.desertHumidity
	) {
		return BIOME.Desert
	}
	if (climate.humidity >= BIOME_RULES.forestHumidity) return BIOME.Forest
	return BIOME.Plains
}
