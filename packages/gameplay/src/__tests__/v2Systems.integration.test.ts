/**
 * Package level integration for the v2 systems.
 *
 * XP, enchanting, farming and breeding are driven end to end through the
 * public API of `@voxelcraft/gameplay` only: no `apps/game` and no
 * `packages/client`, which other sessions own. The point is that the shipped
 * registries and the v2 rules work together, so a v2 block or item that is
 * missing from `BLOCKS`, `ITEMS` or `RECIPES` fails here too.
 */
import {
	BLOCK,
	BLOCK_V2,
	BREEDING,
	CROP,
	ENCHANTING,
	FARMING,
	ITEM,
	ITEM_V2,
	MOB,
	TOOL_CLASS,
	XP,
	type ItemStack,
} from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import {
	BLOCKS,
	ITEMS,
	RECIPES,
	XP_SOURCE,
	addAnimal,
	applyOffer,
	canAfford,
	countBookshelves,
	craftFromGrid,
	createCropField,
	createHerd,
	createMemoryWorld,
	createXpState,
	feed,
	grantXpFrom,
	harvestCrop,
	isInLove,
	isMature,
	plantCrop,
	randomTickCrops,
	rollOffers,
	tickHerd,
	tillSoil,
	tryBreed,
	updateFarmland,
	xpForBlockBreak,
} from '../index'

const SEED = 20260916

/** Ticks the growth loop is allowed before the test gives up. */
const MAX_GROW_TICKS = 5000

function stack(item: number, count = 1): ItemStack {
	return { item, count, damage: 0 }
}

describe('farming drives the v2 food chain', () => {
	it('tills, hydrates, grows, harvests and bakes', () => {
		const world = createMemoryWorld()
		const field = createCropField()

		// Soil with water just inside the hydration radius.
		world.setBlock(0, 64, 0, BLOCK.GRASS_BLOCK)
		world.setBlock(FARMING.hydrationRadius, 64, 0, BLOCK.WATER)

		expect(tillSoil(world, 0, 64, 0, stack(FARMING.hoeItem))).toBe(true)
		expect(world.getBlock(0, 64, 0)).toBe(BLOCK_V2.FARMLAND)
		expect(updateFarmland(world, 0, 64, 0)).toBe(true)
		expect(world.getBlock(0, 64, 0)).toBe(BLOCK_V2.FARMLAND_WET)

		expect(plantCrop(field, world, 0, 65, 0, CROP.wheat.seed)).toBe(true)
		expect(world.getBlock(0, 65, 0)).toBe(BLOCK_V2.WHEAT_CROP)

		// Breaking or placing any of this needs the blocks to be registry-defined.
		for (const id of [BLOCK_V2.FARMLAND, BLOCK_V2.FARMLAND_WET, BLOCK_V2.WHEAT_CROP]) {
			expect(BLOCKS.tryById(id), String(id)).toBeDefined()
		}

		let tick = 0
		while (!isMature(field, 0, 65, 0) && tick < MAX_GROW_TICKS) {
			tick += 1
			randomTickCrops(field, world, { seed: SEED, tick })
		}
		expect(isMature(field, 0, 65, 0)).toBe(true)

		const harvest = harvestCrop(field, world, 0, 65, 0)
		expect(harvest?.mature).toBe(true)
		expect(harvest?.product).toBeGreaterThan(0)
		expect(world.getBlock(0, 65, 0)).toBe(BLOCK.AIR)
		for (const drop of harvest?.drops ?? []) {
			expect(ITEMS.tryById(drop.item), String(drop.item)).toBeDefined()
		}

		// Bread only exists if the shipped recipe registry carries the v2 recipes.
		const grid: (ItemStack | null)[] = [
			stack(CROP.wheat.product),
			stack(CROP.wheat.product),
			stack(CROP.wheat.product),
			null,
			null,
			null,
			null,
			null,
			null,
		]
		const crafted = craftFromGrid(grid, RECIPES)
		expect(crafted?.result.item).toBe(ITEM_V2.BREAD)
		expect(ITEMS.tryById(ITEM_V2.BREAD)).toBeDefined()
		// One wheat per occupied cell was consumed.
		expect(grid.slice(0, 3)).toEqual([null, null, null])
	})
})

describe('experience pays for an enchantment at a real table', () => {
	it('counts bookshelves, rolls offers and spends levels', () => {
		const world = createMemoryWorld()
		world.setBlock(0, 64, 0, BLOCK_V2.ENCHANTING_TABLE)
		for (let dx = -ENCHANTING.bookshelfRadius; dx <= ENCHANTING.bookshelfRadius; dx++) {
			for (let dz = -ENCHANTING.bookshelfRadius; dz <= ENCHANTING.bookshelfRadius; dz++) {
				if (dx === 0 && dz === 0) continue
				world.setBlock(dx, 64, dz, BLOCK_V2.BOOKSHELF)
			}
		}

		expect(BLOCKS.tryById(ENCHANTING.tableBlock)?.id).toBe(BLOCK_V2.ENCHANTING_TABLE)
		expect(BLOCKS.tryById(ENCHANTING.bookshelfBlock)?.id).toBe(BLOCK_V2.BOOKSHELF)

		const shelves = countBookshelves(world, 0, 64, 0)
		expect(shelves).toBe(ENCHANTING.maxBookshelves)

		const offers = rollOffers({ seed: SEED, bookshelves: shelves, toolClass: TOOL_CLASS.Pickaxe })
		expect(offers).toHaveLength(ENCHANTING.offerSlots)
		const offer = offers.find((entry) => entry.enchantments.length > 0)
		expect(offer, 'no offer rolled an enchantment').toBeDefined()
		if (offer === undefined) return

		// Quartz ore is a v2 block and still drops experience when broken.
		expect(xpForBlockBreak(BLOCK_V2.QUARTZ_ORE)).toBe(XP.oreDrop)
		const xp = createXpState()
		let ores = 0
		while (!canAfford(xp, offer.levelCost) && ores < 1000) {
			ores += 1
			grantXpFrom(xp, XP_SOURCE.OreBreak)
		}
		expect(canAfford(xp, offer.levelCost)).toBe(true)

		const before = xp.total
		const applied = applyOffer(xp, stack(ITEM.IRON_PICKAXE), offer, { lapis: offer.lapisCost })
		expect(applied.ok).toBe(true)
		expect(applied.set.length).toBeGreaterThan(0)
		expect(xp.total).toBeLessThan(before)
	})
})

describe('breeding turns v2 food into a new animal', () => {
	it('feeds a pair, breeds it, grants experience and grows the baby', () => {
		const xp = createXpState()
		const herd = createHerd()
		const cowA = addAnimal(herd, { id: 1, mob: MOB.Cow, x: 0, y: 64, z: 0 })
		const cowB = addAnimal(herd, { id: 2, mob: MOB.Cow, x: 1, y: 64, z: 0 })

		// Wheat is the cow's breeding food and only exists as a v2 item.
		expect(ITEMS.tryById(ITEM_V2.WHEAT)).toBeDefined()
		expect(feed(herd, cowA.id, ITEM_V2.WHEAT)).toBe(true)
		expect(feed(herd, cowB.id, ITEM_V2.WHEAT)).toBe(true)
		expect(isInLove(cowA)).toBe(true)
		expect(isInLove(cowB)).toBe(true)

		const bred = tryBreed(herd, { seed: SEED, xpState: xp })
		expect(bred).not.toBeNull()
		if (bred === null) return
		expect(bred.baby.baby).toBe(true)
		expect(bred.baby.mob).toBe(MOB.Cow)
		expect(bred.xpGained).toBe(BREEDING.xpOnBreed)
		expect(xp.total).toBe(BREEDING.xpOnBreed)
		expect(cowA.cooldownTicks).toBe(BREEDING.cooldownTicks)

		const grown = tickHerd(herd, BREEDING.babyGrowTicks)
		expect(grown.map((animal) => animal.id)).toContain(bred.baby.id)
		expect(bred.baby.baby).toBe(false)
	})
})
