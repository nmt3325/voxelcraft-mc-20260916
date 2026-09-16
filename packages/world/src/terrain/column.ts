/**
 * Column filling: bedrock, stone body, biome surface and the ocean. Owned by
 * task world-a.
 *
 * Writes go straight into the caller's blocks/fluids buffers, so no
 * intermediate allocation happens per column.
 *
 * H-06. The canonical voxel index is (y << 8) | (z << 4) | x, so one y layer of
 * a chunk is a single contiguous run of 256 entries while one column is 256
 * entries apart. The stone body and the ocean are therefore written layer by
 * layer with TypedArray.fill over runs of neighbouring columns instead of one
 * strided store per voxel, which is both far fewer stores and a sequential
 * walk through the buffer.
 *
 * This is a pure reordering: bedrock, stone, topsoil, the surface block and the
 * water column occupy disjoint voxels of a column (the topsoil band starts
 * above the stone top, the surface sits above the band and the water starts
 * above the surface), so no voxel is written twice and the resulting buffers are
 * identical to the column-at-a-time version, bit for bit.
 */
import {
	BEDROCK_LAYERS,
	BLOCK,
	CHUNK_AREA,
	CHUNK_X,
	CHUNK_Z,
	FLUID,
	SEA_LEVEL,
	hash01,
	packFluid,
} from '@voxelcraft/core-types'
import { biomeDef } from '../biome'
import { SALT, TERRAIN } from '../internal'

const WATER_SOURCE = packFluid({ kind: FLUID.Water, level: 0, falling: false })

/* Frozen constants, read once instead of per voxel. Same values. */
const TOPSOIL_DEPTH = TERRAIN.topsoilDepth
const SALT_BEDROCK = SALT.bedrock
const BEDROCK = BLOCK.BEDROCK
const STONE = BLOCK.STONE
const WATER = BLOCK.WATER
const ICE = BLOCK.ICE

/** (BEDROCK_LAYERS - y) / BEDROCK_LAYERS per layer, exactly as evaluated inline. */
const BEDROCK_CHANCE = ((): Float64Array => {
	const table = new Float64Array(BEDROCK_LAYERS)
	for (let y = 0; y < BEDROCK_LAYERS; y++) table[y] = (BEDROCK_LAYERS - y) / BEDROCK_LAYERS
	return table
})()

/** biomeDef lookups, memoised per biome id on first sight. */
const BIOME_LIMIT = 256
const biomeKnown = new Uint8Array(BIOME_LIMIT)
const biomeFiller = new Int32Array(BIOME_LIMIT)
const biomeSurface = new Int32Array(BIOME_LIMIT)
const biomeUnderwater = new Int32Array(BIOME_LIMIT)
const biomeSnow = new Uint8Array(BIOME_LIMIT)

function cacheBiome(biome: number): void {
	const def = biomeDef(biome)
	biomeFiller[biome] = def.filler
	biomeSurface[biome] = def.surface
	biomeUnderwater[biome] = def.underwater
	biomeSnow[biome] = def.snow ? 1 : 0
	biomeKnown[biome] = 1
}

/* Per-column scratch, reused across chunks so nothing is allocated per call. */
const colSurfaceY = new Int32Array(CHUNK_AREA)
const colStoneTop = new Int32Array(CHUNK_AREA)
const colSnow = new Uint8Array(CHUNK_AREA)

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
	let maxStoneTop = BEDROCK_LAYERS - 1
	let minSurfaceY = 1 << 30

	// Per column work: the hashed bedrock floor, the topsoil band and the
	// surface block. The stone top and the water start are remembered for the
	// two layer passes below.
	for (let z = 0, ci = 0; z < CHUNK_Z; z++) {
		const wz = bz + z
		for (let x = 0; x < CHUNK_X; x++, ci++) {
			const wx = bx + x
			const surfaceY = heights[ci]
			const biome = biomes[ci]
			if (biomeKnown[biome] === 0) cacheBiome(biome)
			const stoneTop = surfaceY - TOPSOIL_DEPTH
			colSurfaceY[ci] = surfaceY
			colStoneTop[ci] = stoneTop
			colSnow[ci] = biomeSnow[biome]
			if (stoneTop > maxStoneTop) maxStoneTop = stoneTop
			if (surfaceY < minSurfaceY) minSurfaceY = surfaceY

			// Rough bedrock floor: y = 0 is always solid, and the three layers
			// above it thin out with height. The pattern is hashed per world
			// column, so it is seamless across chunk borders.
			blocks[ci] = BEDROCK
			for (let y = 1; y < BEDROCK_LAYERS; y++) {
				const solid = hash01(seed, SALT_BEDROCK, wx, y, wz) < BEDROCK_CHANCE[y]
				blocks[(y << 8) | ci] = solid ? BEDROCK : STONE
			}

			const filler = biomeFiller[biome]
			const fillerStart = stoneTop + 1 > BEDROCK_LAYERS ? stoneTop + 1 : BEDROCK_LAYERS
			for (let y = fillerStart; y < surfaceY; y++) blocks[(y << 8) | ci] = filler
			blocks[(surfaceY << 8) | ci] =
				surfaceY < SEA_LEVEL ? biomeUnderwater[biome] : biomeSurface[biome]
		}
	}

	// Stone body, one layer at a time: a layer is a run of columns that still
	// have stone at this height, and terrain is smooth enough that those runs are
	// long.
	for (let y = BEDROCK_LAYERS; y <= maxStoneTop; y++) {
		const base = y << 8
		let runStart = -1
		for (let ci = 0; ci < CHUNK_AREA; ci++) {
			if (y <= colStoneTop[ci]) {
				if (runStart < 0) runStart = ci
				continue
			}
			if (runStart >= 0) {
				blocks.fill(STONE, base + runStart, base + ci)
				runStart = -1
			}
		}
		if (runStart >= 0) blocks.fill(STONE, base + runStart, base + CHUNK_AREA)
	}

	// Ocean, lake and river water always tops out at exactly SEA_LEVEL. Cold
	// biomes freeze the topmost layer instead of leaving open water.
	for (let y = minSurfaceY + 1; y <= SEA_LEVEL; y++) {
		const base = y << 8
		const seaTop = y === SEA_LEVEL
		let runStart = -1
		for (let ci = 0; ci < CHUNK_AREA; ci++) {
			const wet = y > colSurfaceY[ci]
			const frozen = seaTop && colSnow[ci] === 1
			if (wet && !frozen) {
				if (runStart < 0) runStart = ci
				continue
			}
			if (runStart >= 0) {
				blocks.fill(WATER, base + runStart, base + ci)
				fluids.fill(WATER_SOURCE, base + runStart, base + ci)
				runStart = -1
			}
			if (wet && frozen) {
				const i = base + ci
				blocks[i] = ICE
				fluids[i] = 0
			}
		}
		if (runStart >= 0) {
			blocks.fill(WATER, base + runStart, base + CHUNK_AREA)
			fluids.fill(WATER_SOURCE, base + runStart, base + CHUNK_AREA)
		}
	}
}
