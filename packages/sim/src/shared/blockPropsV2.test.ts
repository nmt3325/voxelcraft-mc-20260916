/**
 * The v2 band of the block property table (B-01).
 *
 * Every id of 64 or more used to fall back to the air entry, so village and
 * nether voxels measured identical to `BLOCK.AIR` for lighting, fluids and
 * collision. `packages/gameplay` owns the test that compares this table with
 * the block definitions id by id; this one guards the table on its own.
 */
import { BLOCK, BLOCK_V2, FLUID, MAX_LIGHT, PORTAL, type BlockId } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import {
	emissionOf,
	isFullCubeBlock,
	isReplaceableBlock,
	isSolidBlock,
	opacityOf,
	simBlockProps,
} from './blockProps'

const AIR = simBlockProps(BLOCK.AIR)

/** v2 blocks that fill a voxel and block the sky. */
const OPAQUE_V2: readonly BlockId[] = [
	BLOCK_V2.NETHERRACK,
	BLOCK_V2.SOUL_SAND,
	BLOCK_V2.QUARTZ_ORE,
	BLOCK_V2.NETHER_BRICKS,
	BLOCK_V2.MAGMA_BLOCK,
	BLOCK_V2.FARMLAND,
	BLOCK_V2.FARMLAND_WET,
	BLOCK_V2.ENCHANTING_TABLE,
	BLOCK_V2.BOOKSHELF,
	BLOCK_V2.GRAVEL_PATH,
	BLOCK_V2.HAY_BLOCK,
]

/** Thin colliders that light still crosses. */
const PARTIAL_V2: readonly BlockId[] = [
	BLOCK_V2.COBBLESTONE_WALL,
	BLOCK_V2.FENCE,
	BLOCK_V2.FENCE_GATE,
]

/** Crops and the portal plane: passable and replaceable. */
const NON_SOLID_V2: readonly BlockId[] = [
	BLOCK_V2.WHEAT_CROP,
	BLOCK_V2.CARROT_CROP,
	BLOCK_V2.POTATO_CROP,
	BLOCK_V2.NETHER_PORTAL,
]

describe('v2 block properties', () => {
	it('makes every full cube v2 block opaque and solid', () => {
		for (const id of OPAQUE_V2) {
			const props = simBlockProps(id)
			expect(props, String(id)).not.toEqual(AIR)
			expect(isSolidBlock(id), String(id)).toBe(true)
			expect(isFullCubeBlock(id), String(id)).toBe(true)
			expect(opacityOf(id), String(id)).toBe(MAX_LIGHT)
			expect(props.skyPassThrough, String(id)).toBe(false)
			expect(isReplaceableBlock(id), String(id)).toBe(false)
			expect(props.fluid, String(id)).toBe(FLUID.None)
		}
	})

	it('keeps walls, fences and gates solid without blocking light', () => {
		for (const id of PARTIAL_V2) {
			expect(isSolidBlock(id), String(id)).toBe(true)
			expect(isFullCubeBlock(id), String(id)).toBe(false)
			expect(opacityOf(id), String(id)).toBe(0)
			expect(simBlockProps(id).skyPassThrough, String(id)).toBe(false)
			expect(isReplaceableBlock(id), String(id)).toBe(false)
		}
	})

	it('leaves crops and the portal passable', () => {
		for (const id of NON_SOLID_V2) {
			expect(isSolidBlock(id), String(id)).toBe(false)
			expect(isFullCubeBlock(id), String(id)).toBe(false)
			expect(simBlockProps(id).skyPassThrough, String(id)).toBe(true)
			expect(isReplaceableBlock(id), String(id)).toBe(true)
		}
	})

	it('lights magma blocks and the portal plane', () => {
		// 3 is the emission the gameplay block table and the client mesher use.
		expect(emissionOf(BLOCK_V2.MAGMA_BLOCK)).toBe(3)
		expect(emissionOf(BLOCK_V2.NETHER_PORTAL)).toBe(PORTAL.lightLevel)
	})

	it('covers every BLOCK_V2 id, so none falls back to air', () => {
		const covered = [...OPAQUE_V2, ...PARTIAL_V2, ...NON_SOLID_V2]
		for (const id of Object.values(BLOCK_V2)) {
			expect(covered, String(id)).toContain(id)
		}
	})
})
