import {
	FURNACE_DEFAULT_COOK_TICKS,
	type FurnaceData,
	type ItemId,
	type ItemStack,
	type RecipeRegistry,
	type SmeltingRecipe,
} from '@voxelcraft/core-types'
import { createFurnaceData } from '../blockEntities/data'
import { ITEMS } from '../items/registry'
import { registryStackLimit, stackLimitOf, type StackLimitResolver } from '../inventory/stacks'
import { RECIPES } from './registry'

/**
 * Furnace smelting. `tickFurnace` is a pure function over `FurnaceData`: the
 * input payload is never mutated and the whole simulation state lives in the
 * returned payload, so ticking in chunks is identical to ticking straight
 * through.
 *
 * Progress is frozen, never decayed, whenever cooking cannot continue (out of
 * fuel, or a full output slot), which is what makes interrupt and resume safe.
 * Removing the input resets progress to zero.
 */
export type FuelTicksResolver = (item: ItemId) => number

/** Burn duration from the item registry (coal 1600, planks 300, ...). */
export const registryFuelTicks: FuelTicksResolver = (item) => ITEMS.tryById(item)?.fuelTicks ?? 0

export interface FurnaceTickOptions {
	registry?: RecipeRegistry
	fuelTicksOf?: FuelTicksResolver
	stackLimitOf?: StackLimitResolver
}

/** Burn duration of a fuel stack, or 0 when it cannot be burned. */
export function fuelTicksOf(
	stack: ItemStack | null,
	fuelTicks: FuelTicksResolver = registryFuelTicks,
): number {
	if (stack === null || stack.count <= 0) return 0
	const ticks = fuelTicks(stack.item)
	if (!Number.isFinite(ticks) || ticks <= 0) return 0
	return Math.floor(ticks)
}

export function isFuel(stack: ItemStack | null, fuelTicks?: FuelTicksResolver): boolean {
	return fuelTicksOf(stack, fuelTicks) > 0
}

export function smeltingRecipeFor(
	stack: ItemStack | null,
	registry: RecipeRegistry = RECIPES,
): SmeltingRecipe | null {
	if (stack === null || stack.count <= 0) return null
	return registry.matchSmelting(stack)
}

export function cookTicksFor(recipe: SmeltingRecipe): number {
	return recipe.cookTicks > 0 ? recipe.cookTicks : FURNACE_DEFAULT_COOK_TICKS
}

/** Whether the result still fits in the output slot. */
export function canAcceptOutput(
	output: ItemStack | null,
	result: ItemStack,
	limitOf: StackLimitResolver = registryStackLimit,
): boolean {
	if (output === null) return true
	if (output.item !== result.item) return false
	return output.count + result.count <= stackLimitOf(output.item, limitOf)
}

export function isFurnaceBurning(data: FurnaceData): boolean {
	return data.fuelTicks > 0
}

/** Cooking progress in 0..1 for the current input. */
export function furnaceProgress(data: FurnaceData, options: FurnaceTickOptions = {}): number {
	const recipe = smeltingRecipeFor(data.input, options.registry ?? RECIPES)
	if (recipe === null) return 0
	const total = cookTicksFor(recipe)
	if (total <= 0) return 0
	return Math.min(1, Math.max(0, data.cookTicks / total))
}

/** Remaining burn time of the lit fuel in 0..1, for the flame icon. */
export function fuelProgress(data: FurnaceData): number {
	if (data.fuelTicksTotal <= 0) return 0
	return Math.min(1, Math.max(0, data.fuelTicks / data.fuelTicksTotal))
}

/**
 * Advances the furnace by `ticks` ticks and returns the new payload. Never
 * mutates `data`.
 */
export function tickFurnace(
	data: FurnaceData,
	ticks = 1,
	options: FurnaceTickOptions = {},
): FurnaceData {
	const registry = options.registry ?? RECIPES
	const fuelTicks = options.fuelTicksOf ?? registryFuelTicks
	const limitOf = options.stackLimitOf ?? registryStackLimit
	const next = createFurnaceData(data)
	if (!Number.isFinite(ticks) || ticks <= 0) return next

	for (let i = 0; i < Math.floor(ticks); i++) {
		const input = next.input
		const recipe = input === null || input.count <= 0 ? null : registry.matchSmelting(input)
		if (input === null || recipe === null) {
			// Nothing smeltable: progress is dropped, but lit fuel keeps burning.
			next.cookTicks = 0
			if (next.fuelTicks > 0) next.fuelTicks -= 1
			continue
		}

		const canCook = canAcceptOutput(next.output, recipe.result, limitOf)
		const fuel = next.fuel
		if (next.fuelTicks <= 0 && canCook && fuel !== null) {
			const burn = fuelTicksOf(fuel, fuelTicks)
			if (burn > 0) {
				next.fuelTicksTotal = burn
				next.fuelTicks = burn
				const left = fuel.count - 1
				next.fuel = left > 0 ? { item: fuel.item, count: left, damage: fuel.damage } : null
			}
		}

		// Out of fuel, or the output is blocked: freeze progress where it is.
		if (next.fuelTicks <= 0) continue
		next.fuelTicks -= 1
		if (!canCook) continue

		next.cookTicks += 1
		if (next.cookTicks < cookTicksFor(recipe)) continue

		next.cookTicks = 0
		const output = next.output
		next.output =
			output === null
				? { item: recipe.result.item, count: recipe.result.count, damage: recipe.result.damage }
				: { item: output.item, count: output.count + recipe.result.count, damage: output.damage }
		const leftInput = input.count - 1
		next.input = leftInput > 0 ? { item: input.item, count: leftInput, damage: input.damage } : null
	}

	return next
}

/** Replaces the input slot; clearing it also clears the cooking progress. */
export function withFurnaceInput(data: FurnaceData, stack: ItemStack | null): FurnaceData {
	const next = createFurnaceData(data)
	if (stack === null || stack.count <= 0) {
		next.input = null
		next.cookTicks = 0
		return next
	}
	next.input = { item: stack.item, count: stack.count, damage: stack.damage }
	return next
}

export function withFurnaceFuel(data: FurnaceData, stack: ItemStack | null): FurnaceData {
	const next = createFurnaceData(data)
	next.fuel =
		stack === null || stack.count <= 0
			? null
			: { item: stack.item, count: stack.count, damage: stack.damage }
	return next
}

/** Empties the output slot, returning the collected stack. */
export function takeFurnaceOutput(data: FurnaceData): {
	data: FurnaceData
	taken: ItemStack | null
} {
	const next = createFurnaceData(data)
	const output = next.output
	next.output = null
	if (output === null || output.count <= 0) return { data: next, taken: null }
	return {
		data: next,
		taken: { item: output.item, count: output.count, damage: output.damage },
	}
}
