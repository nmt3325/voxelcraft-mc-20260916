import { describe, expect, it } from 'vitest'
import { BLOCK, GAME_MODE, INVENTORY, ITEM, type ItemStack } from '@voxelcraft/core-types'
import { BLOCKS } from '../blocks/registry'
import { ITEMS } from '../items/registry'
import {
	addStack,
	clearCraftingGrid,
	cloneInventoryState,
	consumeHeld,
	countItem,
	craftingGridSize,
	createInventoryState,
	cycleHotbar,
	damageHeld,
	findItem,
	getSlot,
	hasRoomFor,
	heldStack,
	inventoryContents,
	removeItem,
	resizeCraftingGrid,
	selectHotbar,
	setCraftingSlot,
	setSlot,
	swapCursorWithSlot,
	takeFromSlot,
} from './inventory'
import { damageStack, maxDurabilityOf, remainingDurability, stackLimitOf } from './stacks'
import { breakTimeWith, canHarvestWith, toolProfileOf } from './tools'

function stack(item: number, count: number, damage = 0): ItemStack {
	return { item, count, damage }
}

describe('inventory layout', () => {
	it('has 36 slots, a 9 slot hotbar and a 2x2 crafting grid', () => {
		const state = createInventoryState()
		expect(state.slots).toHaveLength(INVENTORY.totalSlots)
		expect(INVENTORY.totalSlots).toBe(INVENTORY.hotbarSlots + INVENTORY.mainSlots)
		expect(state.slots.every((slot) => slot === null)).toBe(true)
		expect(state.selectedHotbar).toBe(0)
		expect(state.cursor).toBeNull()
		expect(state.crafting).toHaveLength(INVENTORY.craftGrid2)
		expect(craftingGridSize(state)).toBe(2)
	})

	it('rejects out of range slots', () => {
		const state = createInventoryState()
		expect(() => getSlot(state, INVENTORY.totalSlots)).toThrow(RangeError)
		expect(() => selectHotbar(state, INVENTORY.hotbarSlots)).toThrow(RangeError)
	})
})

describe('stack limits', () => {
	it('fills stacks to the registry limit and spills into the next slot', () => {
		const state = createInventoryState()
		expect(stackLimitOf(BLOCK.COBBLESTONE)).toBe(INVENTORY.defaultMaxStack)
		expect(addStack(state, stack(BLOCK.COBBLESTONE, 70))).toBeNull()
		expect(getSlot(state, 0)).toEqual(stack(BLOCK.COBBLESTONE, 64))
		expect(getSlot(state, 1)).toEqual(stack(BLOCK.COBBLESTONE, 6))
		expect(countItem(state, BLOCK.COBBLESTONE)).toBe(70)
	})

	it('keeps tools one per slot', () => {
		const state = createInventoryState()
		expect(ITEMS.maxStackOf(ITEM.IRON_PICKAXE)).toBe(INVENTORY.toolMaxStack)
		expect(addStack(state, stack(ITEM.IRON_PICKAXE, 3))).toBeNull()
		expect(getSlot(state, 0)?.count).toBe(1)
		expect(getSlot(state, 1)?.count).toBe(1)
		expect(getSlot(state, 2)?.count).toBe(1)
		expect(countItem(state, ITEM.IRON_PICKAXE)).toBe(3)
	})

	it('never merges stacks with a different damage value', () => {
		const state = createInventoryState()
		setSlot(state, 0, stack(BLOCK.COBBLESTONE, 1, 1))
		expect(addStack(state, stack(BLOCK.COBBLESTONE, 1, 0))).toBeNull()
		expect(getSlot(state, 0)).toEqual(stack(BLOCK.COBBLESTONE, 1, 1))
		expect(getSlot(state, 1)).toEqual(stack(BLOCK.COBBLESTONE, 1, 0))
	})

	it('reports the part that does not fit', () => {
		const state = createInventoryState()
		for (let i = 0; i < INVENTORY.totalSlots; i++) setSlot(state, i, stack(BLOCK.DIRT, 64))
		expect(hasRoomFor(state, stack(BLOCK.STONE, 1))).toBe(false)
		expect(addStack(state, stack(BLOCK.STONE, 5))).toEqual(stack(BLOCK.STONE, 5))
		expect(addStack(state, stack(BLOCK.DIRT, 3))).toEqual(stack(BLOCK.DIRT, 3))
	})
})

describe('hotbar and cursor', () => {
	it('selects and cycles the hotbar', () => {
		const state = createInventoryState()
		setSlot(state, 3, stack(BLOCK.TORCH, 8))
		expect(selectHotbar(state, 3)).toBe(3)
		expect(heldStack(state)).toEqual(stack(BLOCK.TORCH, 8))
		expect(cycleHotbar(state, 1)).toBe(4)
		expect(cycleHotbar(state, -5)).toBe(8)
		expect(cycleHotbar(state, 1)).toBe(0)
	})

	it('picks up, merges and swaps with the cursor', () => {
		const state = createInventoryState()
		setSlot(state, 0, stack(BLOCK.PLANKS, 10))
		swapCursorWithSlot(state, 0)
		expect(state.cursor).toEqual(stack(BLOCK.PLANKS, 10))
		expect(getSlot(state, 0)).toBeNull()

		setSlot(state, 1, stack(BLOCK.PLANKS, 60))
		swapCursorWithSlot(state, 1)
		expect(getSlot(state, 1)).toEqual(stack(BLOCK.PLANKS, 64))
		expect(state.cursor).toEqual(stack(BLOCK.PLANKS, 6))

		setSlot(state, 2, stack(BLOCK.STONE, 1))
		swapCursorWithSlot(state, 2)
		expect(getSlot(state, 2)).toEqual(stack(BLOCK.PLANKS, 6))
		expect(state.cursor).toEqual(stack(BLOCK.STONE, 1))
	})

	it('takes from a slot and removes items by id', () => {
		const state = createInventoryState()
		setSlot(state, 5, stack(BLOCK.SAND, 20))
		expect(takeFromSlot(state, 5, 5)).toEqual(stack(BLOCK.SAND, 5))
		expect(getSlot(state, 5)).toEqual(stack(BLOCK.SAND, 15))
		expect(removeItem(state, BLOCK.SAND, 100)).toBe(15)
		expect(getSlot(state, 5)).toBeNull()
		expect(findItem(state, BLOCK.SAND)).toBe(-1)
	})
})

describe('durability', () => {
	it('wears a tool down and destroys it once the durability is spent', () => {
		const durability = maxDurabilityOf(ITEM.WOODEN_PICKAXE)
		expect(durability).toBe(59)
		let held: ItemStack | null = stack(ITEM.WOODEN_PICKAXE, 1)
		for (let i = 1; i < durability; i++) held = damageStack(held, 1)
		expect(held).toEqual(stack(ITEM.WOODEN_PICKAXE, 1, durability - 1))
		expect(remainingDurability(held)).toBe(1)
		expect(damageStack(held, 1)).toBeNull()
	})

	it('damages tools in survival but never in creative', () => {
		const state = createInventoryState()
		setSlot(state, 0, stack(ITEM.WOODEN_PICKAXE, 1, 58))
		expect(damageHeld(state, 1, GAME_MODE.Creative)).toBe(false)
		expect(getSlot(state, 0)).toEqual(stack(ITEM.WOODEN_PICKAXE, 1, 58))
		expect(damageHeld(state, 1, GAME_MODE.Survival)).toBe(true)
		expect(getSlot(state, 0)).toBeNull()
	})

	it('does not consume held items in creative', () => {
		const state = createInventoryState()
		setSlot(state, 0, stack(BLOCK.PLANKS, 1))
		expect(consumeHeld(state, 1, GAME_MODE.Creative)).toBe(true)
		expect(getSlot(state, 0)).toEqual(stack(BLOCK.PLANKS, 1))
		expect(consumeHeld(state, 1, GAME_MODE.Survival)).toBe(true)
		expect(getSlot(state, 0)).toBeNull()
		expect(consumeHeld(state, 1, GAME_MODE.Survival)).toBe(false)
	})
})

describe('tool tiers', () => {
	const obsidian = BLOCKS.byId(BLOCK.OBSIDIAN)
	const dirt = BLOCKS.byId(BLOCK.DIRT)

	it('needs a diamond pickaxe to harvest obsidian', () => {
		expect(canHarvestWith(stack(ITEM.IRON_PICKAXE, 1), obsidian)).toBe(false)
		expect(canHarvestWith(stack(ITEM.DIAMOND_PICKAXE, 1), obsidian)).toBe(true)
		expect(canHarvestWith(null, obsidian)).toBe(false)
		expect(canHarvestWith(null, dirt)).toBe(true)
	})

	it('breaks faster with a better tool', () => {
		const bare = breakTimeWith(null, obsidian)
		const iron = breakTimeWith(stack(ITEM.IRON_PICKAXE, 1), obsidian)
		const diamond = breakTimeWith(stack(ITEM.DIAMOND_PICKAXE, 1), obsidian)
		expect(diamond).toBeCloseTo(9.375, 3)
		expect(bare).toBeCloseTo(250, 3)
		expect(diamond).toBeLessThan(iron)
		expect(iron).toBeLessThan(bare)
		expect(toolProfileOf(null)).toEqual({ toolClass: 0, tier: 0 })
	})
})

describe('crafting grid', () => {
	it('resizes between 2x2 and 3x3 keeping cell positions', () => {
		const state = createInventoryState()
		setCraftingSlot(state, 0, stack(BLOCK.PLANKS, 1))
		setCraftingSlot(state, 3, stack(BLOCK.STONE, 1))
		expect(resizeCraftingGrid(state, 3)).toEqual([])
		expect(craftingGridSize(state)).toBe(3)
		expect(state.crafting[0]).toEqual(stack(BLOCK.PLANKS, 1))
		expect(state.crafting[4]).toEqual(stack(BLOCK.STONE, 1))

		setCraftingSlot(state, 8, stack(BLOCK.SAND, 2))
		expect(resizeCraftingGrid(state, 2)).toEqual([stack(BLOCK.SAND, 2)])
		expect(state.crafting).toHaveLength(INVENTORY.craftGrid2)
		expect(state.crafting[3]).toEqual(stack(BLOCK.STONE, 1))
	})

	it('clears the grid and clones independently', () => {
		const state = createInventoryState()
		setSlot(state, 0, stack(BLOCK.DIRT, 4))
		setCraftingSlot(state, 1, stack(BLOCK.DIRT, 1))
		const copy = cloneInventoryState(state)
		expect(clearCraftingGrid(state)).toEqual([stack(BLOCK.DIRT, 1)])
		expect(state.crafting.every((cell) => cell === null)).toBe(true)
		expect(copy.crafting[1]).toEqual(stack(BLOCK.DIRT, 1))
		expect(inventoryContents(copy)).toEqual([stack(BLOCK.DIRT, 4)])
	})
})
