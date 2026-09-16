/**
 * Server side terrain. Deliberately a tiny local generator: apps/server does
 * not depend on @voxelcraft/world, so a terrain change in another subtree can
 * never turn the network gates red.
 *
 * Every sample comes from the shared coordinate hash, so a column is a pure
 * function of (seed, cx, cz) and the order columns are touched in cannot
 * matter -- which is what lets a client and the server agree without sending
 * terrain twice.
 */
import {
	BLOCK,
	CHUNK_VOLUME,
	CHUNK_X,
	CHUNK_Z,
	FLUID,
	FLUID_EMPTY,
	blockIndex,
	hash01,
	packFluid,
} from '@voxelcraft/core-types'

/** Bump when terrain output changes: determinism goldens key off this. */
export const SERVER_GEN_VERSION = 1

/** Mirrors DIMENSION_PARAMS[Overworld].seaLevel, kept local on purpose. */
const SEA_LEVEL = 62
/**
 * The surface stays well away from both ends of the column, so y 0 is always
 * bedrock and the top of the column is always air.
 */
const MIN_SURFACE = 50
const MAX_SURFACE = 84
/** Stone stops this far below the surface; dirt fills the rest. */
const DIRT_DEPTH = 4

/** Octaves must differ by salt, not by seed: one seed, one world. */
const SALT_CONTINENT = 0x101
const SALT_HILLS = 0x102
const SALT_DETAIL = 0x103

/** A still water source cell. */
const WATER_CELL = packFluid({ kind: FLUID.Water, level: 0, falling: false })

function smoothstep(t: number): number {
	return t * t * (3 - 2 * t)
}

/**
 * Bilinear value noise on a `cell` wide lattice, in [0, 1). Interpolating
 * between lattice hashes is what makes chunk borders line up: two neighbouring
 * columns read the same corner hashes.
 */
function valueNoise(seed: number, salt: number, x: number, z: number, cell: number): number {
	const gx = Math.floor(x / cell)
	const gz = Math.floor(z / cell)
	const tx = smoothstep(x / cell - gx)
	const tz = smoothstep(z / cell - gz)
	const n00 = hash01(seed, salt, gx, 0, gz)
	const n10 = hash01(seed, salt, gx + 1, 0, gz)
	const n01 = hash01(seed, salt, gx, 0, gz + 1)
	const n11 = hash01(seed, salt, gx + 1, 0, gz + 1)
	const lowZ = n00 + (n10 - n00) * tx
	const highZ = n01 + (n11 - n01) * tx
	return lowZ + (highZ - lowZ) * tz
}

/** Integer surface y of one world column, always inside the column. */
function surfaceHeight(seed: number, wx: number, wz: number): number {
	const continent = valueNoise(seed, SALT_CONTINENT, wx, wz, 64)
	const hills = valueNoise(seed, SALT_HILLS, wx, wz, 16)
	const detail = valueNoise(seed, SALT_DETAIL, wx, wz, 4)
	const y = Math.round(SEA_LEVEL + (continent - 0.5) * 26 + (hills - 0.5) * 9 + (detail - 0.5) * 3)
	if (y < MIN_SURFACE) return MIN_SURFACE
	if (y > MAX_SURFACE) return MAX_SURFACE
	return y
}

/**
 * Fills one chunk column. Writes only frozen block ids, so a generated column
 * can never be rejected by the same validator that guards client edits.
 */
export function generateColumn(
	seed: number,
	cx: number,
	cz: number,
	blocks: Uint16Array,
	fluids: Uint8Array,
): void {
	if (blocks.length !== CHUNK_VOLUME || fluids.length !== CHUNK_VOLUME) {
		throw new Error(
			`world: generateColumn wants CHUNK_VOLUME arrays, got ${blocks.length}/${fluids.length}`,
		)
	}
	// A caller may hand back a recycled buffer, so clear rather than assume zeros.
	blocks.fill(BLOCK.AIR)
	fluids.fill(FLUID_EMPTY)
	const originX = cx * CHUNK_X
	const originZ = cz * CHUNK_Z
	for (let lz = 0; lz < CHUNK_Z; lz++) {
		for (let lx = 0; lx < CHUNK_X; lx++) {
			const top = surfaceHeight(seed, originX + lx, originZ + lz)
			const stoneTop = top - DIRT_DEPTH
			blocks[blockIndex(lx, 0, lz)] = BLOCK.BEDROCK
			for (let y = 1; y <= stoneTop; y++) blocks[blockIndex(lx, y, lz)] = BLOCK.STONE
			for (let y = stoneTop + 1; y < top; y++) blocks[blockIndex(lx, y, lz)] = BLOCK.DIRT
			blocks[blockIndex(lx, top, lz)] = BLOCK.GRASS_BLOCK
			for (let y = top + 1; y <= SEA_LEVEL; y++) {
				const i = blockIndex(lx, y, lz)
				blocks[i] = BLOCK.WATER
				fluids[i] = WATER_CELL
			}
		}
	}
}
