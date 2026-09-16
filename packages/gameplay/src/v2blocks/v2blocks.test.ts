/**
 * Regressions for the v2 registry gap (B-01).
 *
 * The v2 block and item ids used to be missing from the registries the app
 * actually builds: `BLOCKS.tryById()` returned undefined for every id of 64 or
 * more, so village and nether voxels could never be broken or placed and the
 * sim block table fell back to its air entry for them. These tests fail again
 * if any of that regresses.
 */
import { describe, expect, it } from 'vitest'
import {
	BLOCK,
	BLOCK_V2,
	CHUNK_X,
	CHUNK_Z,
	DIMENSION,
	FLUID,
	ITEM_V2,
	MAX_LIGHT,
	type BlockId,
	type BlockV2KeyName,
	type ItemV2KeyName,
	type VillagePlan,
} from '@voxelcraft/core-types'
import { simBlockProps } from '@voxelcraft/sim'
import {
	createNoiseBasis,
	createTerrain,
	createVillageBuilder,
	createWorldGenerator,
	generateRegion,
	type ChunkGrid,
} from '@voxelcraft/world'
import { BLOCK_DEF_COUNT } from '../blocks/blockDefs'
import { BLOCKS } from '../blocks/registry'
import { RECIPES } from '../crafting/registry'
import { ITEMS } from '../items/registry'
import { ALL_RECIPE_DEF_COUNT, RECIPE_V2_ID } from '../v2items/recipeDefsV2'
import { createV2RecipeRegistry } from '../v2items/recipesV2'
import {
	ALL_BLOCK_DEFS,
	ALL_BLOCK_DEF_COUNT,
	BLOCK_V2_DEFS,
	BLOCK_V2_DEF_COUNT,
} from './blockDefsV2'

/** The seed the e2e harness boots with. */
const SEED = 1337

const BLOCK_V2_KEYS = Object.keys(BLOCK_V2) as BlockV2KeyName[]
const ITEM_V2_KEYS = Object.keys(ITEM_V2) as ItemV2KeyName[]

/** Blocks only the village builder ever writes. */
const VILLAGE_BLOCKS: readonly BlockId[] = [
	BLOCK_V2.GRAVEL_PATH,
	BLOCK_V2.COBBLESTONE_WALL,
	BLOCK_V2.FENCE,
	BLOCK_V2.HAY_BLOCK,
	BLOCK_V2.FARMLAND,
]

/** Blocks only the nether passes ever write. */
const NETHER_FEATURES: readonly BlockId[] = [
	BLOCK_V2.QUARTZ_ORE,
	BLOCK_V2.SOUL_SAND,
	BLOCK_V2.MAGMA_BLOCK,
]

/** Every distinct block id a generated region holds. */
function idsOf(grid: ChunkGrid): Set<number> {
	const ids = new Set<number>()
	for (const chunk of grid.all()) {
		for (let i = 0; i < chunk.blocks.length; i++) ids.add(chunk.blocks[i])
	}
	return ids
}

/** The first village of the scanned regions, so this test needs no fixture. */
function firstVillage(): VillagePlan {
	const terrain = createTerrain(SEED, createNoiseBasis(SEED))
	const { planner } = createVillageBuilder(terrain)
	for (let rz = -4; rz <= 4; rz++) {
		for (let rx = -4; rx <= 4; rx++) {
			const plan = planner.planRegion(rx, rz)
			if (plan !== null) return plan
		}
	}
	throw new Error('no village was planned in regions [-4, 4]')
}

describe('default block registry covers the v2 ids', () => {
	it('defines one block per BLOCK_V2 id', () => {
		expect(BLOCK_V2_DEF_COUNT).toBe(BLOCK_V2_KEYS.length)
		expect(ALL_BLOCK_DEF_COUNT).toBe(BLOCK_DEF_COUNT + BLOCK_V2_DEF_COUNT)
		expect(ALL_BLOCK_DEFS).toHaveLength(ALL_BLOCK_DEF_COUNT)
		expect(BLOCKS.count()).toBe(ALL_BLOCK_DEF_COUNT)

		for (const key of BLOCK_V2_KEYS) {
			const id = BLOCK_V2[key]
			const def = BLOCKS.tryById(id)
			expect(def, key).toBeDefined()
			expect(def?.id).toBe(id)
			expect(def?.name).toBe(key.toLowerCase())
			expect(def?.displayName.length).toBeGreaterThan(0)
			expect(BLOCKS.byName(key.toLowerCase())?.id).toBe(id)
		}
	})

	it('defines one item per ITEM_V2 id', () => {
		for (const key of ITEM_V2_KEYS) {
			const id = ITEM_V2[key]
			expect(ITEMS.tryById(id), key).toBeDefined()
			expect(ITEMS.has(id)).toBe(true)
		}
	})

	it('keeps every v2 block breakable, placeable and dropping known items', () => {
		for (const def of BLOCK_V2_DEFS) {
			if (def.itemId !== 0) {
				const item = ITEMS.tryById(def.itemId)
				expect(item, def.name).toBeDefined()
				if (def.itemId === def.id) expect(item?.placesBlock).toBe(def.id)
			}
			for (const entry of def.drops) {
				expect(ITEMS.tryById(entry.item), `${def.name} drop`).toBeDefined()
			}
			// Only the portal is indestructible; everything else can be mined.
			if (def.id === BLOCK_V2.NETHER_PORTAL) {
				expect(def.drops).toHaveLength(0)
			} else {
				expect(def.hardness, def.name).toBeGreaterThanOrEqual(0)
				expect(def.drops.length, def.name).toBeGreaterThan(0)
			}
		}
	})
})

describe('default recipe registry covers the v2 recipes', () => {
	it('ships as many recipes as the v2 registry', () => {
		const v2 = createV2RecipeRegistry()
		expect(RECIPES.count()).toBe(v2.count())
		expect(RECIPES.count()).toBe(ALL_RECIPE_DEF_COUNT)
		for (const id of Object.values(RECIPE_V2_ID)) {
			expect(RECIPES.byId(id), id).toBeDefined()
		}
	})
})

describe('sim block table agrees with the v2 block definitions', () => {
	it('mirrors every optical, collision and fluid fact', () => {
		for (const def of BLOCK_V2_DEFS) {
			const props = simBlockProps(def.id)
			expect(props.solid, def.name).toBe(def.solid)
			expect(props.fullCube, def.name).toBe(def.fullCube)
			expect(props.opacity, def.name).toBe(def.opacity)
			expect(props.emission, def.name).toBe(def.emission)
			expect(props.skyPassThrough, def.name).toBe(def.skyPassThrough)
			expect(props.skyFilter, def.name).toBe(def.skyFilter)
			expect(props.replaceable, def.name).toBe(def.replaceable)
			expect(props.fluid, def.name).toBe(FLUID.None)
		}
	})

	it('never measures a solid v2 block like air', () => {
		const air = simBlockProps(BLOCK.AIR)
		for (const def of BLOCK_V2_DEFS) {
			if (!def.solid) continue
			const props = simBlockProps(def.id)
			expect(props, def.name).not.toEqual(air)
			expect(props.solid, def.name).toBe(true)
			expect(props.replaceable, def.name).toBe(false)
			if (!def.fullCube) continue
			expect(props.opacity, def.name).toBe(MAX_LIGHT)
			expect(props.skyPassThrough, def.name).toBe(false)
		}
	})
})

describe('world generation only emits registry-defined ids', () => {
	it('covers the overworld around the first village', () => {
		const plan = firstVillage()
		const generator = createWorldGenerator(SEED)
		const cx = Math.floor(plan.centerX / CHUNK_X)
		const cz = Math.floor(plan.centerZ / CHUNK_Z)
		const grid = generateRegion(generator, cx - 2, cz - 2, 5)
		for (const chunk of grid.all()) generator.decorate(chunk.cx, chunk.cz, grid)

		const ids = idsOf(grid)
		// The village is what makes this reachable in a normal game.
		expect(VILLAGE_BLOCKS.some((id) => ids.has(id))).toBe(true)
		for (const id of ids) {
			if (id === BLOCK.AIR) continue
			expect(BLOCKS.tryById(id), `overworld block id ${String(id)}`).toBeDefined()
		}
	})

	it('covers the nether', () => {
		const generator = createWorldGenerator(SEED, DIMENSION.Nether)
		const grid = generateRegion(generator, 0, 0, 3)
		for (const chunk of grid.all()) generator.decorate(chunk.cx, chunk.cz, grid)

		const ids = idsOf(grid)
		expect(ids.has(BLOCK_V2.NETHERRACK)).toBe(true)
		expect(NETHER_FEATURES.some((id) => ids.has(id))).toBe(true)
		for (const id of ids) {
			if (id === BLOCK.AIR) continue
			expect(BLOCKS.tryById(id), `nether block id ${String(id)}`).toBeDefined()
		}
	})
})
