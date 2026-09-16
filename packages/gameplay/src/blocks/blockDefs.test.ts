import { describe, expect, it } from 'vitest'
import {
	BLOCK,
	BLOCK_ID_MAX,
	FLUID,
	RENDER_LAYER,
	TOOL_CLASS,
	TOOL_TIER,
} from '@voxelcraft/core-types'
import { BLOCK_DEF_COUNT, BLOCK_DEFS } from './blockDefs'
import { BLOCKS, createBlockRegistry, createDefaultBlockRegistry } from './registry'
import { ITEMS } from '../items/registry'

const BLOCK_KEYS = Object.keys(BLOCK) as Array<keyof typeof BLOCK>

describe('BLOCK_DEFS', () => {
	it('defines exactly one block per contract id', () => {
		expect(BLOCK_DEF_COUNT).toBe(BLOCK_KEYS.length)
		expect(new Set(BLOCK_DEFS.map((def) => def.id))).toEqual(new Set(Object.values(BLOCK)))
	})

	it('has no duplicate ids or names', () => {
		expect(new Set(BLOCK_DEFS.map((def) => def.id)).size).toBe(BLOCK_DEF_COUNT)
		expect(new Set(BLOCK_DEFS.map((def) => def.name)).size).toBe(BLOCK_DEF_COUNT)
	})

	it('keeps registry names aligned with the contract keys', () => {
		for (const key of BLOCK_KEYS) {
			const def = BLOCKS.byId(BLOCK[key])
			expect(def.name.toUpperCase()).toBe(key.toUpperCase())
			expect(def.displayName.length).toBeGreaterThan(0)
		}
	})

	it('keeps every id inside the reserved range', () => {
		for (const def of BLOCK_DEFS) {
			expect(Number.isInteger(def.id)).toBe(true)
			expect(def.id).toBeGreaterThanOrEqual(0)
			expect(def.id).toBeLessThanOrEqual(BLOCK_ID_MAX)
		}
	})

	it('uses light, layer and tool values inside their contract ranges', () => {
		const layers: number[] = [RENDER_LAYER.Opaque, RENDER_LAYER.Cutout, RENDER_LAYER.Translucent]
		const toolClasses: number[] = Object.values(TOOL_CLASS)
		const tiers: number[] = Object.values(TOOL_TIER)
		for (const def of BLOCK_DEFS) {
			expect(layers).toContain(def.layer)
			expect(toolClasses).toContain(def.toolClass)
			expect(tiers).toContain(def.minTier)
			expect(def.opacity).toBeGreaterThanOrEqual(0)
			expect(def.opacity).toBeLessThanOrEqual(15)
			expect(def.emission).toBeGreaterThanOrEqual(0)
			expect(def.emission).toBeLessThanOrEqual(15)
			expect(def.skyFilter === 0 || def.skyFilter === 1).toBe(true)
			expect(def.hardness === -1 || def.hardness >= 0).toBe(true)
		}
	})

	it('references only items that exist', () => {
		for (const def of BLOCK_DEFS) {
			// itemId 0 means the block has no item form (flowing fluids, lit variants).
			if (def.itemId !== BLOCK.AIR) expect(ITEMS.tryById(def.itemId)).toBeDefined()
			for (const entry of def.drops) {
				expect(ITEMS.tryById(entry.item)).toBeDefined()
				expect(entry.min).toBeGreaterThanOrEqual(0)
				expect(entry.max).toBeGreaterThanOrEqual(entry.min)
				expect(entry.chance).toBeGreaterThan(0)
				expect(entry.chance).toBeLessThanOrEqual(1)
			}
		}
	})

	it('models the well known blocks', () => {
		const air = BLOCKS.byId(BLOCK.AIR)
		expect(air.solid).toBe(false)
		expect(air.replaceable).toBe(true)
		expect(air.opacity).toBe(0)
		expect(air.drops).toHaveLength(0)

		const stone = BLOCKS.byId(BLOCK.STONE)
		expect(stone.solid).toBe(true)
		expect(stone.fullCube).toBe(true)
		expect(stone.toolClass).toBe(TOOL_CLASS.Pickaxe)
		expect(stone.drops.map((entry) => entry.item)).toContain(BLOCK.COBBLESTONE)

		const bedrock = BLOCKS.byId(BLOCK.BEDROCK)
		expect(bedrock.hardness).toBe(-1)
		expect(bedrock.drops).toHaveLength(0)

		expect(BLOCKS.byId(BLOCK.WATER).fluid).toBe(FLUID.Water)
		expect(BLOCKS.byId(BLOCK.LAVA).fluid).toBe(FLUID.Lava)
		expect(BLOCKS.byId(BLOCK.GLOWSTONE).emission).toBe(15)
		expect(BLOCKS.byId(BLOCK.TORCH).emission).toBeGreaterThan(0)
		expect(BLOCKS.byId(BLOCK.OBSIDIAN).minTier).toBe(TOOL_TIER.Diamond)
	})

	it('declares block entities for the interactive blocks', () => {
		for (const id of [
			BLOCK.CHEST,
			BLOCK.FURNACE,
			BLOCK.FURNACE_LIT,
			BLOCK.CRAFTING_TABLE,
			BLOCK.DOOR_LOWER,
			BLOCK.DOOR_UPPER,
			BLOCK.BED_FOOT,
			BLOCK.BED_HEAD,
		]) {
			expect(BLOCKS.byId(id).blockEntity).not.toBeNull()
		}
		expect(BLOCKS.byId(BLOCK.STONE).blockEntity).toBeNull()
	})
})

describe('block registry', () => {
	it('round trips by id and by name', () => {
		expect(BLOCKS.count()).toBe(BLOCK_DEF_COUNT)
		expect(BLOCKS.all()).toHaveLength(BLOCK_DEF_COUNT)
		for (const def of BLOCK_DEFS) {
			expect(BLOCKS.byId(def.id)).toBe(def)
			expect(BLOCKS.byName(def.name)).toBe(def)
		}
	})

	it('mirrors definition flags through the helper accessors', () => {
		for (const def of BLOCK_DEFS) {
			expect(BLOCKS.isSolid(def.id)).toBe(def.solid)
			expect(BLOCKS.isFullCube(def.id)).toBe(def.fullCube)
			expect(BLOCKS.layerOf(def.id)).toBe(def.layer)
			expect(BLOCKS.lightPropsOf(def.id)).toEqual({
				opacity: def.opacity,
				emission: def.emission,
				skyPassThrough: def.skyPassThrough,
				skyFilter: def.skyFilter,
			})
		}
	})

	it('treats unknown ids as absent instead of guessing', () => {
		expect(BLOCKS.tryById(199)).toBeUndefined()
		expect(() => BLOCKS.byId(199)).toThrow()
		expect(BLOCKS.isSolid(199)).toBe(false)
	})

	it('builds independent registries', () => {
		const fresh = createDefaultBlockRegistry()
		expect(fresh.count()).toBe(BLOCK_DEF_COUNT)
		expect(fresh).not.toBe(BLOCKS)

		const empty = createBlockRegistry()
		expect(empty.count()).toBe(0)
		empty.define(BLOCKS.byId(BLOCK.STONE))
		expect(empty.count()).toBe(1)
		expect(empty.byId(BLOCK.STONE).name).toBe(BLOCKS.byId(BLOCK.STONE).name)
	})
})
