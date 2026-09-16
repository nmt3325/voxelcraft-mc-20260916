/**
 * apps/game must resolve v2 blocks and items through exactly one table: the
 * registries `@voxelcraft/gameplay` ships. Review rev5 found the running game
 * on an app-local copy that disagreed with the shipped tables on 14 of the 18
 * v2 block ids (B-02) while every gate stayed green (M-02) - the reviewer
 * deleted farmland from the app table and nothing went red.
 *
 * These tests import the module the game imports and compare it field for
 * field, so an app-local table, a missing id or a changed field all fail. The
 * portal and crop assertions are written against the contract literals
 * (`hardness -1`, `itemId 0`), not against the other table, so they still hold
 * if both sides were to drift together.
 */
import { describe, expect, it } from 'vitest'
import { BLOCK_V2, BLOCK_V2_BASE, BLOCK_V2_MAX, ITEM_V2 } from '@voxelcraft/core-types'
import { BLOCKS, ITEMS } from '@voxelcraft/gameplay'
import {
	BLOCKS_V2,
	ITEMS_V2,
	V2_INVENTORY,
	blockDisplayName,
	itemDisplayName,
	v2MaxDurabilityOf,
	v2PlacesBlock,
	v2StackLimitOf,
} from './registries'

/** Every field of a block definition, so nothing can drift unnoticed. */
const BLOCK_FIELDS = [
	'id',
	'name',
	'displayName',
	'layer',
	'solid',
	'fullCube',
	'replaceable',
	'opacity',
	'emission',
	'skyPassThrough',
	'skyFilter',
	'hardness',
	'toolClass',
	'minTier',
	'textures',
	'drops',
	'fluid',
	'blockEntity',
	'gravity',
	'flammable',
	'redstone',
	'soundGroup',
	'itemId',
] as const

/** Every field of an item definition. */
const ITEM_FIELDS = [
	'id',
	'name',
	'displayName',
	'maxStack',
	'texture',
	'toolClass',
	'tier',
	'durability',
	'attackDamage',
	'food',
	'fuelTicks',
	'placesBlock',
] as const

const BLOCK_IDS: readonly number[] = Object.values(BLOCK_V2).sort((a, b) => a - b)
const ITEM_IDS: readonly number[] = Object.values(ITEM_V2).sort((a, b) => a - b)
const CROP_IDS: readonly number[] = [
	BLOCK_V2.WHEAT_CROP,
	BLOCK_V2.CARROT_CROP,
	BLOCK_V2.POTATO_CROP,
]

const show = (value: unknown): string => JSON.stringify(value ?? null)

/** The block definition the app resolves, or a failure naming the id. */
const appBlock = (id: number) => {
	const def = BLOCKS_V2.tryById(id)
	if (def === undefined) throw new Error(`apps/game cannot resolve block ${id}`)
	return def
}

/** The item definition the package ships, or a failure naming the id. */
const shippedItem = (id: number) => {
	const def = ITEMS.tryById(id)
	if (def === undefined) throw new Error(`@voxelcraft/gameplay cannot resolve item ${id}`)
	return def
}

describe('apps/game v2 registry parity', () => {
	it('covers the whole contract band', () => {
		expect(BLOCK_IDS).toHaveLength(18)
		expect(ITEM_IDS).toHaveLength(18)
		// 64..81 and 305..322: contiguous, and inside the bands the contract reserves.
		expect(BLOCK_IDS).toEqual(BLOCK_IDS.map((_, i) => BLOCK_V2_BASE + i))
		expect(BLOCK_IDS[BLOCK_IDS.length - 1]).toBeLessThanOrEqual(BLOCK_V2_MAX)
		expect(ITEM_IDS).toEqual(ITEM_IDS.map((_, i) => ITEM_IDS[0] + i))
	})

	it('matches the shipped block table field for field', () => {
		const mismatches: string[] = []
		for (const id of BLOCK_IDS) {
			const shipped = BLOCKS.tryById(id)
			const app = BLOCKS_V2.tryById(id)
			if (shipped === undefined) {
				mismatches.push(`block ${id}: missing from @voxelcraft/gameplay`)
				continue
			}
			if (app === undefined) {
				mismatches.push(`block ${id} ${shipped.name}: missing from apps/game`)
				continue
			}
			for (const field of BLOCK_FIELDS) {
				const a = show(app[field])
				const b = show(shipped[field])
				if (a !== b) mismatches.push(`block ${id} ${shipped.name} ${field}: app=${a} gameplay=${b}`)
			}
		}
		expect(mismatches).toEqual([])
	})

	it('matches the shipped item table field for field', () => {
		const mismatches: string[] = []
		for (const id of ITEM_IDS) {
			const shipped = ITEMS.tryById(id)
			const app = ITEMS_V2.tryById(id)
			if (shipped === undefined) {
				mismatches.push(`item ${id}: missing from @voxelcraft/gameplay`)
				continue
			}
			if (app === undefined) {
				mismatches.push(`item ${id} ${shipped.name}: missing from apps/game`)
				continue
			}
			for (const field of ITEM_FIELDS) {
				const a = show(app[field])
				const b = show(shipped[field])
				if (a !== b) mismatches.push(`item ${id} ${shipped.name} ${field}: app=${a} gameplay=${b}`)
			}
		}
		expect(mismatches).toEqual([])
	})
})

describe('the player visible invariants the drift broke', () => {
	it('keeps the Nether portal unbreakable and item-less', () => {
		const portal = appBlock(BLOCK_V2.NETHER_PORTAL)
		// `breakAt` in main.ts returns early on a negative hardness.
		expect(portal.hardness).toBe(-1)
		expect(portal.itemId).toBe(0)
		expect(portal.drops).toEqual([])
		expect(ITEMS_V2.tryById(BLOCK_V2.NETHER_PORTAL)).toBeUndefined()
		expect(v2PlacesBlock(BLOCK_V2.NETHER_PORTAL)).toBeNull()
	})

	it('leaves the portal as the only unbreakable v2 block', () => {
		for (const id of BLOCK_IDS) {
			const def = appBlock(id)
			expect(def.hardness < 0, def.name).toBe(id === BLOCK_V2.NETHER_PORTAL)
		}
	})

	it('keeps a mature crop out of the inventory', () => {
		for (const id of CROP_IDS) {
			const crop = appBlock(id)
			expect(crop.itemId, crop.name).toBe(0)
			expect(ITEMS_V2.tryById(id), crop.name).toBeUndefined()
			expect(v2PlacesBlock(id), crop.name).toBeNull()
			// The yield comes from the harvest path, never from pocketing the plant.
			expect(crop.drops.length, crop.name).toBeGreaterThan(0)
		}
	})

	it('never pockets an item id no registry resolves', () => {
		for (const id of BLOCK_IDS) {
			const def = appBlock(id)
			// main.ts pockets `itemId` only when it is above zero.
			if (def.itemId > 0) expect(ITEMS_V2.tryById(def.itemId), def.name).toBeDefined()
			for (const entry of def.drops) expect(ITEMS_V2.tryById(entry.item), def.name).toBeDefined()
		}
	})
})

describe('the app helpers read those same registries', () => {
	it('names, stacks and places every v2 item through them', () => {
		for (const id of ITEM_IDS) {
			const def = shippedItem(id)
			expect(itemDisplayName(id), def.name).toBe(def.displayName)
			expect(v2StackLimitOf(id), def.name).toBe(def.maxStack)
			expect(V2_INVENTORY.stackLimitOf(id), def.name).toBe(def.maxStack)
			expect(v2MaxDurabilityOf(id), def.name).toBe(def.durability)
			expect(v2PlacesBlock(id), def.name).toBe(def.placesBlock)
		}
	})

	it('names every v2 block through them', () => {
		for (const id of BLOCK_IDS) expect(blockDisplayName(id)).toBe(appBlock(id).displayName)
	})

	it('falls back for ids nothing defines', () => {
		// Item 65 is what the old app table inserted when the portal was broken.
		expect(itemDisplayName(BLOCK_V2.NETHER_PORTAL)).toBe('Item 65')
		expect(blockDisplayName(BLOCK_V2_MAX + 1)).toBe(`Block ${BLOCK_V2_MAX + 1}`)
		expect(v2MaxDurabilityOf(BLOCK_V2.NETHER_PORTAL)).toBe(0)
	})
})
