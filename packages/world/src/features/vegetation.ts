/**
 * Trees and ground plants. Owned by task world-c.
 *
 * decorate runs after the 3x3 neighbourhood exists, so it writes through the
 * VoxelEditView and may reach into neighbouring chunks. Tree candidates are
 * drawn one per treeCell x treeCell cell, which keeps canopies from stacking on
 * top of each other, and leaves only ever replace air so a canopy never eats
 * terrain or another trunk.
 */
import { BIOME, BLOCK, CHUNK_X, CHUNK_Z, SEA_LEVEL, hash01, hashU32 } from '@voxelcraft/core-types'
import type { BiomeDef, VoxelEditView } from '@voxelcraft/core-types'
import { biomeDef } from '../biome'
import type { Decorator, TerrainContext } from '../internal'
import { SALT, VEGETATION } from '../internal'

/** Canopy radius per layer, lowest layer first. */
const OAK_CANOPY: readonly number[] = [2, 2, 1, 1]
const SPRUCE_CANOPY: readonly number[] = [2, 1, 2, 1]

function setIfAir(view: VoxelEditView, x: number, y: number, z: number, id: number): void {
	if (view.getBlock(x, y, z) === BLOCK.AIR) view.setBlock(x, y, z, id)
}

function buildCanopy(
	view: VoxelEditView,
	wx: number,
	wz: number,
	topY: number,
	layers: readonly number[],
	leaf: number,
): void {
	for (let layer = 0; layer < layers.length; layer++) {
		const y = topY - (layers.length - 1 - layer)
		const r = layers[layer]
		for (let dz = -r; dz <= r; dz++) {
			for (let dx = -r; dx <= r; dx++) {
				// Trim the corners of the wide layers so the canopy is round.
				if (r > 1 && dx * dx + dz * dz > r * r + 1) continue
				setIfAir(view, wx + dx, y, wz + dz, leaf)
			}
		}
	}
	setIfAir(view, wx, topY + 1, wz, leaf)
}

function buildTree(
	seed: number,
	view: VoxelEditView,
	wx: number,
	wz: number,
	surfaceY: number,
	biome: number,
	def: BiomeDef,
): void {
	// Trees need dry, uncarved, biome-typical ground.
	if (surfaceY <= SEA_LEVEL) return
	if (view.getBlock(wx, surfaceY, wz) !== def.surface) return
	if (view.getBlock(wx, surfaceY + 1, wz) !== BLOCK.AIR) return

	const shape = hashU32(seed, SALT.treeShape, wx, 0, wz)
	const span = VEGETATION.maxTrunk - VEGETATION.minTrunk + 1

	if (biome === BIOME.Desert) {
		const height = 2 + (shape % 3)
		for (let dy = 1; dy <= height; dy++) setIfAir(view, wx, surfaceY + dy, wz, BLOCK.CACTUS)
		return
	}

	const conifer = biome === BIOME.Snowy || biome === BIOME.Mountains
	const birch = !conifer && (hashU32(seed, SALT.treeKind, wx, 1, wz) & 1) === 1
	const log = conifer ? BLOCK.SPRUCE_LOG : birch ? BLOCK.BIRCH_LOG : BLOCK.OAK_LOG
	const leaf = conifer ? BLOCK.SPRUCE_LEAVES : birch ? BLOCK.BIRCH_LEAVES : BLOCK.OAK_LEAVES
	const trunk = VEGETATION.minTrunk + (shape % span) + (conifer ? 1 : 0)

	for (let dy = 1; dy <= trunk; dy++) setIfAir(view, wx, surfaceY + dy, wz, log)
	buildCanopy(view, wx, wz, surfaceY + trunk, conifer ? SPRUCE_CANOPY : OAK_CANOPY, leaf)
}

function placePlant(
	seed: number,
	view: VoxelEditView,
	wx: number,
	wz: number,
	surfaceY: number,
	biome: number,
	def: BiomeDef,
): void {
	if (surfaceY <= SEA_LEVEL) return
	if (view.getBlock(wx, surfaceY, wz) !== def.surface) return
	const kind = hashU32(seed, SALT.plantKind, wx, 0, wz) % 8
	let id: number = BLOCK.TALL_GRASS
	if (biome === BIOME.Desert) id = BLOCK.DEAD_BUSH
	else if (kind === 0) id = BLOCK.FLOWER_RED
	else if (kind === 1) id = BLOCK.FLOWER_YELLOW
	else if (kind === 2) id = BLOCK.OAK_SAPLING
	setIfAir(view, wx, surfaceY + 1, wz, id)
}

export function createVegetation(terrain: TerrainContext): Decorator {
	const seed = terrain.seed
	const cell = VEGETATION.treeCell
	const cellsX = CHUNK_X / cell
	const cellsZ = CHUNK_Z / cell
	const cellCount = cellsX * cellsZ

	return {
		decorate(cx, cz, view): void {
			const bx = cx * CHUNK_X
			const bz = cz * CHUNK_Z

			for (let iz = 0; iz < cellsZ; iz++) {
				for (let ix = 0; ix < cellsX; ix++) {
					const cellX = bx + ix * cell
					const cellZ = bz + iz * cell
					const pick = hashU32(seed, SALT.tree, cellX, 0, cellZ)
					const wx = cellX + (pick % cell)
					const wz = cellZ + ((pick >>> 8) % cell)
					const sample = terrain.sampleColumn(wx, wz)
					const def = biomeDef(sample.biome)
					if (def.treeDensity <= 0) continue
					// treeDensity is trees per chunk, spread over the candidate cells.
					if (hash01(seed, SALT.treeKind, wx, 0, wz) * cellCount >= def.treeDensity) continue
					buildTree(seed, view, wx, wz, sample.surfaceY, sample.biome, def)
				}
			}

			for (let z = 0; z < CHUNK_Z; z++) {
				for (let x = 0; x < CHUNK_X; x++) {
					const wx = bx + x
					const wz = bz + z
					const sample = terrain.sampleColumn(wx, wz)
					const def = biomeDef(sample.biome)
					if (def.plantDensity <= 0) continue
					// plantDensity is plants per chunk, spread over the 256 columns.
					if (hash01(seed, SALT.plant, wx, 0, wz) * 256 >= def.plantDensity) continue
					placePlant(seed, view, wx, wz, sample.surfaceY, sample.biome, def)
				}
			}
		},
	}
}
