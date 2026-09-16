/**
 * Feature set factory. Owned by task world-c.
 *
 * createFeatureSet binds the terrain context once and returns the three
 * feature passes that createWorldGenerator runs: caves and ores during
 * generateChunk, vegetation during decorate.
 */
import type { CreateFeatureSet, FeatureSet, TerrainContext } from '../internal'
import { createCaveCarver } from './caves'
import { createOrePlacer } from './ores'
import { createVegetation } from './vegetation'

export const createFeatureSet: CreateFeatureSet = (terrain: TerrainContext): FeatureSet => ({
	caves: createCaveCarver(terrain),
	ores: createOrePlacer(terrain),
	decorator: createVegetation(terrain),
})

export { createCaveCarver, createOrePlacer, createVegetation }
