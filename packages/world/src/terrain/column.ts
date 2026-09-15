/**
 * Column filling: bedrock, stone body, biome surface and the ocean. Owned by
 * task world-a.
 *
 * Writes go straight into the caller's blocks/fluids buffers using blockIndex,
 * so no intermediate allocation happens per column.
 */
import {
	BEDROCK_LAYERS,
	BLOCK,
	CHUNK_X,
	CHUNK_Z,
	FLUID,
	SEA_LEVEL,
	blockIndex,
	hash01,
	packFluid,
} from '@voxelcraft/core-types'
import { biomeDef } from '../biome'
import { SALT, TERRAIN, columnIndex } from '../internal'

const WATER_SOURCE = packFluid({ kind: FLUID.Water, level: 0, falling: false })

/**
 * Rough bedrock floor: y = 0 is always solid, and the three layers above it
 * thin out with height. The pattern is hashed per world column, so it is
 * seamless across chunk borders.
 */
function fillBedrock(
	seed: number,
	wx: number,
	wz: number,
	x: number,
	z: number,
	blocks: Uint16Array,
): void {
	for (let y = 0; y < BEDROCK_LAYERS; y++) {
		const solid =
			y === 0 ||
			hash01(seed, SALT.bedrock, wx, y, wz) < (BEDROCK_LAYERS - y) / BEDROCK_LAYERS
		blocks[blockIndex(x, y, z)] = solid ? BLOCK.BEDROCK : BLOCK.STONE
	}
}

function fillColumn(
	seed: number,
	wx: number,
	wz: number,
	x: number,
	z: number,
	surfaceY: number,
	biome: number,
	blocks: Uint16Array,
	fluids: Uint8Array,
): void {
	const def = biomeDef(biome)
	const submerged = surfaceY < SEA_LEVEL
	const surfaceBlock = submerged ? def.underwater : def.surface

	fillBedrock(seed, wx, wz, x, z, blocks)

	const stoneTop = surfaceY - TERRAIN.topsoilDepth
	for (let y = BEDROCK_LAYERS; y <= stoneTop; y++) {
		blocks[blockIndex(x, y, z)] = BLOCK.STONE
	}
	const fillerStart = stoneTop + 1 > BEDROCK_LAYERS ? stoneTop + 1 : BEDROCK_LAYERS
	for (let y = fillerStart; y < surfaceY; y++) {
		blocks[blockIndex(x, y, z)] = def.filler
	}
	blocks[blockIndex(x, surfaceY, z)] = surfaceBlock

	// Ocean, lake and river water always tops out at exactly SEA_LEVEL. Cold
	// biomes freeze the topmost layer instead of leaving open water.
	for (let y = surfaceY + 1; y <= SEA_LEVEL; y++) {
		const i = blockIndex(x, y, z)
		if (def.snow && y === SEA_LEVEL) {
			blocks[i] = BLOCK.ICE
			fluids[i] = 0
		} else {
			blocks[i] = BLOCK.WATER
			fluids[i] = WATER_SOURCE
		}
	}
}

export function fillChunkColumns(
	seed: number,
	cx: number,
	cz: number,
	blocks: Uint16Array,
	fluids: Uint8Array,
	heights: Uint16Array,
	biomes: Uint8Array,
): void {
	const bx = cx * CHUNK_X
	const bz = cz * CHUNK_Z
	for (let z = 0; z < CHUNK_Z; z++) {
		for (let x = 0; x < CHUNK_X; x++) {
			const ci = columnIndex(x, z)
			fillColumn(seed, bx + x, bz + z, x, z, heights[ci], biomes[ci], blocks, fluids)
		}
	}
}
