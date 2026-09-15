import { describe, expect, it } from 'vitest'
import {
	BLOCK,
	FURNACE_DEFAULT_COOK_TICKS,
	ITEM,
	type FurnaceData,
	type ItemStack,
} from '@voxelcraft/core-types'
import { createFurnaceData } from '../blockEntities/data'
import {
	canAcceptOutput,
	fuelProgress,
	fuelTicksOf,
	furnaceProgress,
	isFuel,
	isFurnaceBurning,
	takeFurnaceOutput,
	tickFurnace,
	withFurnaceFuel,
	withFurnaceInput,
} from './furnace'

const COAL_TICKS = 1600
const STICK_TICKS = 100

function stack(item: number, count = 1, damage = 0): ItemStack {
	return { item, count, damage }
}

function furnace(
	input: ItemStack | null,
	fuel: ItemStack | null,
	output: ItemStack | null = null,
): FurnaceData {
	return createFurnaceData({ input, fuel, output })
}

describe('fuel', () => {
	it('reads burn durations from the item registry', () => {
		expect(fuelTicksOf(stack(ITEM.COAL))).toBe(COAL_TICKS)
		expect(fuelTicksOf(stack(ITEM.STICK))).toBe(STICK_TICKS)
		expect(fuelTicksOf(null)).toBe(0)
		expect(isFuel(stack(ITEM.COAL))).toBe(true)
		expect(isFuel(stack(BLOCK.DIRT))).toBe(false)
	})
})

describe('furnace smelting', () => {
	it('cooks one item over the default cook time', () => {
		const data = furnace(stack(BLOCK.IRON_ORE, 1), stack(ITEM.COAL, 1))

		const partial = tickFurnace(data, FURNACE_DEFAULT_COOK_TICKS - 1)
		expect(partial.cookTicks).toBe(FURNACE_DEFAULT_COOK_TICKS - 1)
		expect(partial.output).toBeNull()
		expect(partial.fuel).toBeNull()
		expect(partial.fuelTicksTotal).toBe(COAL_TICKS)
		expect(partial.fuelTicks).toBe(COAL_TICKS - (FURNACE_DEFAULT_COOK_TICKS - 1))
		expect(isFurnaceBurning(partial)).toBe(true)
		expect(furnaceProgress(partial)).toBeCloseTo(0.995, 5)

		const done = tickFurnace(data, FURNACE_DEFAULT_COOK_TICKS)
		expect(done.output).toEqual(stack(ITEM.IRON_INGOT, 1))
		expect(done.input).toBeNull()
		expect(done.cookTicks).toBe(0)
		expect(furnaceProgress(done)).toBe(0)
	})

	it('never mutates the payload it is given', () => {
		const data = furnace(stack(BLOCK.IRON_ORE, 2), stack(ITEM.COAL, 1))
		const before = structuredClone(data)
		tickFurnace(data, 500)
		expect(data).toEqual(before)
	})

	it('freezes progress when the fuel runs out and resumes after refuelling', () => {
		const data = furnace(stack(BLOCK.IRON_ORE, 1), stack(ITEM.STICK, 1))
		const stalled = tickFurnace(data, 150)
		expect(stalled.cookTicks).toBe(STICK_TICKS)
		expect(stalled.fuelTicks).toBe(0)
		expect(stalled.output).toBeNull()
		expect(isFurnaceBurning(stalled)).toBe(false)

		const refuelled = tickFurnace(
			withFurnaceFuel(stalled, stack(ITEM.COAL, 1)),
			FURNACE_DEFAULT_COOK_TICKS - STICK_TICKS,
		)
		expect(refuelled.output).toEqual(stack(ITEM.IRON_INGOT, 1))
		expect(refuelled.input).toBeNull()
		expect(refuelled.cookTicks).toBe(0)
	})

	it('produces the same state ticked in one go or in pieces', () => {
		const data = furnace(stack(BLOCK.IRON_ORE, 2), stack(ITEM.COAL, 1))
		const once = tickFurnace(data, 200)
		const split = tickFurnace(tickFurnace(data, 73), 127)
		expect(split).toEqual(once)

		const longRun = tickFurnace(data, 400)
		expect(longRun.output).toEqual(stack(ITEM.IRON_INGOT, 2))
		expect(longRun.input).toBeNull()
	})

	it('does not light fuel while the output is full', () => {
		const data = furnace(stack(BLOCK.IRON_ORE, 1), stack(ITEM.COAL, 1), stack(ITEM.IRON_INGOT, 64))
		expect(canAcceptOutput(stack(ITEM.IRON_INGOT, 64), stack(ITEM.IRON_INGOT, 1))).toBe(false)
		const ticked = tickFurnace(data, 50)
		expect(ticked.cookTicks).toBe(0)
		expect(ticked.fuelTicks).toBe(0)
		expect(ticked.fuel).toEqual(stack(ITEM.COAL, 1))
		expect(ticked.output).toEqual(stack(ITEM.IRON_INGOT, 64))
	})

	it('clears progress when the input is removed but keeps burning', () => {
		const cooking = tickFurnace(furnace(stack(BLOCK.IRON_ORE, 1), stack(ITEM.COAL, 1)), 100)
		expect(cooking.cookTicks).toBe(100)

		const emptied = withFurnaceInput(cooking, null)
		expect(emptied.cookTicks).toBe(0)

		const idle = tickFurnace(emptied, 10)
		expect(idle.cookTicks).toBe(0)
		expect(idle.fuelTicks).toBe(cooking.fuelTicks - 10)
	})

	it('ignores items without a smelting recipe', () => {
		const ticked = tickFurnace(furnace(stack(BLOCK.DIRT, 1), stack(ITEM.COAL, 1)), 100)
		expect(ticked.cookTicks).toBe(0)
		expect(ticked.fuelTicks).toBe(0)
		expect(ticked.fuel).toEqual(stack(ITEM.COAL, 1))
		expect(ticked.output).toBeNull()
	})

	it('accumulates the output and hands it over', () => {
		const data = furnace(stack(BLOCK.SAND, 3), stack(ITEM.COAL, 1))
		const ticked = tickFurnace(data, FURNACE_DEFAULT_COOK_TICKS * 2)
		expect(ticked.output).toEqual(stack(BLOCK.GLASS, 2))
		expect(ticked.input).toEqual(stack(BLOCK.SAND, 1))
		expect(fuelProgress(ticked)).toBeCloseTo((COAL_TICKS - 400) / COAL_TICKS, 5)

		const collected = takeFurnaceOutput(ticked)
		expect(collected.taken).toEqual(stack(BLOCK.GLASS, 2))
		expect(collected.data.output).toBeNull()
	})
})
