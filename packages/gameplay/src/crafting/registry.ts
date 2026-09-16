import type {
	ItemId,
	ItemStack,
	Recipe,
	RecipeRegistry,
	ShapedRecipe,
	ShapelessRecipe,
	SmeltingRecipe,
} from '@voxelcraft/core-types'
import { ALL_RECIPE_DEFS } from '../v2items/recipeDefsV2'

/**
 * Recipe registry: shift-invariant shaped matching, order-independent
 * shapeless matching and an input index for furnace smelting.
 *
 * Shaped patterns are normalized to their bounding box when registered, so a
 * pattern may be written with padding and still match anywhere in the grid.
 */
export interface GameplayRecipeRegistry extends RecipeRegistry {
	byId(id: string): Recipe | undefined
	count(): number
	shapedRecipes(): readonly ShapedRecipe[]
	shapelessRecipes(): readonly ShapelessRecipe[]
	smeltingRecipes(): readonly SmeltingRecipe[]
}

interface NormalizedShaped {
	recipe: ShapedRecipe
	width: number
	height: number
	/** Row-major, trimmed to the occupied bounding box. 0 is an empty cell. */
	pattern: readonly ItemId[]
}

interface GridBounds {
	minX: number
	minY: number
	width: number
	height: number
	filled: number
}

function normalizeShaped(recipe: ShapedRecipe): NormalizedShaped {
	if (recipe.pattern.length !== recipe.width * recipe.height) {
		throw new RangeError(
			`shaped recipe '${recipe.id}' has ${String(recipe.pattern.length)} cells, expected ${String(recipe.width * recipe.height)}`,
		)
	}
	let minX: number = recipe.width
	let maxX = -1
	let minY: number = recipe.height
	let maxY = -1
	for (let y = 0; y < recipe.height; y++) {
		for (let x = 0; x < recipe.width; x++) {
			if ((recipe.pattern[y * recipe.width + x] ?? 0) === 0) continue
			if (x < minX) minX = x
			if (x > maxX) maxX = x
			if (y < minY) minY = y
			if (y > maxY) maxY = y
		}
	}
	if (maxX < 0 || maxY < 0) {
		throw new RangeError(`shaped recipe '${recipe.id}' has no ingredients`)
	}
	const pattern: ItemId[] = []
	for (let y = minY; y <= maxY; y++) {
		for (let x = minX; x <= maxX; x++) {
			pattern.push(recipe.pattern[y * recipe.width + x] ?? 0)
		}
	}
	return { recipe, width: maxX - minX + 1, height: maxY - minY + 1, pattern }
}

function gridBounds(grid: readonly (ItemStack | null)[], size: number): GridBounds {
	let minX = size
	let maxX = -1
	let minY = size
	let maxY = -1
	let filled = 0
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const cell = grid[y * size + x] ?? null
			if (cell === null || cell.count <= 0) continue
			filled++
			if (x < minX) minX = x
			if (x > maxX) maxX = x
			if (y < minY) minY = y
			if (y > maxY) maxY = y
		}
	}
	if (filled === 0) return { minX: 0, minY: 0, width: 0, height: 0, filled: 0 }
	return { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1, filled }
}

function matchesPattern(
	grid: readonly (ItemStack | null)[],
	gridSize: number,
	bounds: GridBounds,
	entry: NormalizedShaped,
): boolean {
	for (let y = 0; y < entry.height; y++) {
		for (let x = 0; x < entry.width; x++) {
			const want = entry.pattern[y * entry.width + x] ?? 0
			const cell = grid[(bounds.minY + y) * gridSize + (bounds.minX + x)] ?? null
			const have = cell === null || cell.count <= 0 ? 0 : cell.item
			if (want !== have) return false
		}
	}
	return true
}

function sortedGridItems(grid: readonly (ItemStack | null)[]): ItemId[] {
	const out: ItemId[] = []
	for (const cell of grid) {
		if (cell === null || cell.count <= 0) continue
		out.push(cell.item)
	}
	out.sort((a, b) => a - b)
	return out
}

export function createRecipeRegistry(recipes: readonly Recipe[] = []): GameplayRecipeRegistry {
	const ordered: Recipe[] = []
	const byIdMap = new Map<string, Recipe>()
	const shaped: NormalizedShaped[] = []
	const shapeless: ShapelessRecipe[] = []
	const smelting: SmeltingRecipe[] = []
	const smeltingByInput = new Map<ItemId, SmeltingRecipe>()

	const registry: GameplayRecipeRegistry = {
		register(recipe) {
			if (byIdMap.has(recipe.id)) throw new Error(`duplicate recipe id: ${recipe.id}`)
			if (recipe.result.count <= 0) {
				throw new RangeError(`recipe '${recipe.id}' has a non-positive result count`)
			}
			if (recipe.kind === 'shaped') {
				shaped.push(normalizeShaped(recipe))
			} else if (recipe.kind === 'shapeless') {
				if (recipe.ingredients.length < 1 || recipe.ingredients.length > 9) {
					throw new RangeError(
						`shapeless recipe '${recipe.id}' needs 1..9 ingredients, got ${String(recipe.ingredients.length)}`,
					)
				}
				if (recipe.ingredients.some((item) => item === 0)) {
					throw new RangeError(`shapeless recipe '${recipe.id}' has an empty ingredient`)
				}
				shapeless.push(recipe)
			} else {
				if (recipe.cookTicks <= 0) {
					throw new RangeError(`smelting recipe '${recipe.id}' needs positive cookTicks`)
				}
				if (smeltingByInput.has(recipe.input)) {
					throw new Error(`duplicate smelting input: ${String(recipe.input)}`)
				}
				smelting.push(recipe)
				smeltingByInput.set(recipe.input, recipe)
			}
			byIdMap.set(recipe.id, recipe)
			ordered.push(recipe)
		},

		matchCrafting(grid, gridSize) {
			if (grid.length !== gridSize * gridSize) {
				throw new RangeError(
					`crafting grid has ${String(grid.length)} cells, expected ${String(gridSize * gridSize)}`,
				)
			}
			const bounds = gridBounds(grid, gridSize)
			if (bounds.filled === 0) return null
			for (const entry of shaped) {
				if (entry.width !== bounds.width || entry.height !== bounds.height) continue
				if (matchesPattern(grid, gridSize, bounds, entry)) return entry.recipe
			}
			const items = sortedGridItems(grid)
			for (const recipe of shapeless) {
				if (recipe.ingredients.length !== items.length) continue
				const want = [...recipe.ingredients].sort((a, b) => a - b)
				let ok = true
				for (let i = 0; i < want.length; i++) {
					if (want[i] !== items[i]) {
						ok = false
						break
					}
				}
				if (ok) return recipe
			}
			return null
		},

		matchSmelting(input) {
			if (input.count <= 0) return null
			return smeltingByInput.get(input.item) ?? null
		},

		all() {
			return ordered
		},

		byId(id) {
			return byIdMap.get(id)
		},

		count() {
			return ordered.length
		},

		shapedRecipes() {
			return shaped.map((entry) => entry.recipe)
		},

		shapelessRecipes() {
			return shapeless
		},

		smeltingRecipes() {
			return smelting
		},
	}

	for (const recipe of recipes) registry.register(recipe)
	return registry
}

/** The shipped registry: the v1 recipes plus the additive v2 recipes. */
export function createDefaultRecipeRegistry(): GameplayRecipeRegistry {
	return createRecipeRegistry(ALL_RECIPE_DEFS)
}

/** Shared registry backing the default crafting and furnace helpers. */
export const RECIPES: GameplayRecipeRegistry = createDefaultRecipeRegistry()
