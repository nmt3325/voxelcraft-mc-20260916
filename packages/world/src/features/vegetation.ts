/**
 * Trees and ground plants. Owned by task world-c.
 *
 * decorate is clipped to the chunk it is handed. Candidates are enumerated over
 * that chunk plus one cell of margin on every side, so a tree rooted in a
 * neighbouring chunk still grows the part of its canopy that belongs here,
 * while every voxel of the world has exactly one writer. That is what makes
 * decoration independent of visit order and idempotent: two decorate calls can
 * never race for a voxel, and a second pass over the same area finds its own
 * voxels already filled and changes nothing.
 *
 * Whether a feature exists and what it looks like is a pure function of
 * (seed, wx, wz) and the terrain column, never of the view, so a missing or
 * late neighbour cannot change the outcome. The view is only ever used to
 * refuse a write: an unloaded chunk is dropped through isLoaded, and a voxel
 * that already holds something keeps it, so terrain always beats decoration.
 *
 * Within a chunk the trunks of all candidates go down before any canopy, so a
 * neighbouring canopy can never punch a hole in a trunk, and every trunk stands
 * on the surface of its own column with more leaves above it than logs below.
 *
 * The density roll is evaluated before the terrain column is sampled. Rolling
 * against the highest density of any biome first rejects the large majority of
 * candidates for the price of one hash, and because the per-biome test is
 * stricter it accepts exactly the same set as sampling first would.
 */
import {
	BIOME,
	BLOCK,
	CHUNK_AREA,
	CHUNK_X,
	CHUNK_Y,
	CHUNK_Z,
	SEA_LEVEL,
	hash01,
	hashU32,
} from '@voxelcraft/core-types'
import type { ColumnSample, VoxelEditView } from '@voxelcraft/core-types'
import { BIOMES, biomeDef } from '../biome'
import type { Decorator, TerrainContext } from '../internal'
import { SALT, VEGETATION } from '../internal'

/** Canopy radius per layer, lowest layer first. */
const OAK_CANOPY: readonly number[] = [2, 2, 1, 1]
const BIRCH_CANOPY: readonly number[] = [2, 1, 1]
const SPRUCE_CANOPY: readonly number[] = [2, 1, 2, 1]
/** A cactus is all trunk. */
const NO_CANOPY: readonly number[] = []

/** Highest density of any biome, used to reject candidates before sampling. */
function maxDensity(pick: (def: (typeof BIOMES)[number]) => number): number {
	let max = 0
	for (const def of BIOMES) {
		const value = pick(def)
		if (value > max) max = value
	}
	return max
}

const MAX_TREE_DENSITY = maxDensity((def) => def.treeDensity)
const MAX_PLANT_DENSITY = maxDensity((def) => def.plantDensity)

interface TreeShape {
	readonly height: number
	readonly log: number
	readonly leaf: number
	readonly canopy: readonly number[]
}

interface TreeSite {
	readonly wx: number
	readonly wz: number
	readonly surfaceY: number
	readonly shape: TreeShape
}

/** Species and size of the tree of a column. Pure in (seed, wx, wz, biome). */
function treeShape(seed: number, wx: number, wz: number, biome: number): TreeShape {
	const shape = hashU32(seed, SALT.treeShape, wx, 0, wz)
	if (biome === BIOME.Desert) {
		return {
			height: 2 + (shape % 3),
			log: BLOCK.CACTUS,
			leaf: BLOCK.CACTUS,
			canopy: NO_CANOPY,
		}
	}
	const conifer = biome === BIOME.Snowy || biome === BIOME.Mountains
	const birch = !conifer && (hashU32(seed, SALT.treeKind, wx, 1, wz) & 1) === 1
	const span = VEGETATION.maxTrunk - VEGETATION.minTrunk + 1
	return {
		height: VEGETATION.minTrunk + (shape % span) + (conifer ? 1 : 0),
		log: conifer ? BLOCK.SPRUCE_LOG : birch ? BLOCK.BIRCH_LOG : BLOCK.OAK_LOG,
		leaf: conifer ? BLOCK.SPRUCE_LEAVES : birch ? BLOCK.BIRCH_LEAVES : BLOCK.OAK_LEAVES,
		canopy: conifer ? SPRUCE_CANOPY : birch ? BIRCH_CANOPY : OAK_CANOPY,
	}
}

/**
 * Writes one voxel of a feature. Anything outside the chunk being decorated is
 * dropped, which is what gives every voxel a single writer, and anything that
 * is not air is left alone.
 */
function place(
	view: VoxelEditView,
	bx: number,
	bz: number,
	wx: number,
	y: number,
	wz: number,
	id: number,
): void {
	if (y < 1 || y >= CHUNK_Y) return
	if (wx < bx || wx >= bx + CHUNK_X || wz < bz || wz >= bz + CHUNK_Z) return
	if (view.getBlock(wx, y, wz) !== BLOCK.AIR) return
	view.setBlock(wx, y, wz, id)
}

function buildTrunk(view: VoxelEditView, bx: number, bz: number, site: TreeSite): void {
	for (let dy = 1; dy <= site.shape.height; dy++) {
		place(view, bx, bz, site.wx, site.surfaceY + dy, site.wz, site.shape.log)
	}
}

function buildCanopy(view: VoxelEditView, bx: number, bz: number, site: TreeSite): void {
	const layers = site.shape.canopy
	if (layers.length === 0) return
	const leaf = site.shape.leaf
	const topY = site.surfaceY + site.shape.height
	for (let layer = 0; layer < layers.length; layer++) {
		const y = topY - (layers.length - 1 - layer)
		const r = layers[layer]
		for (let dz = -r; dz <= r; dz++) {
			for (let dx = -r; dx <= r; dx++) {
				// Trim the corners of the wide layers so the canopy reads as round.
				if (r > 1 && dx * dx + dz * dz > r * r + 1) continue
				place(view, bx, bz, site.wx + dx, y, site.wz + dz, leaf)
			}
		}
	}
	place(view, bx, bz, site.wx, topY + 1, site.wz, leaf)
}

function placePlant(
	seed: number,
	view: VoxelEditView,
	bx: number,
	bz: number,
	wx: number,
	wz: number,
	sample: ColumnSample,
): void {
	if (sample.surfaceY <= SEA_LEVEL) return
	const kind = hashU32(seed, SALT.plantKind, wx, 0, wz) % 8
	let id: number = BLOCK.TALL_GRASS
	if (sample.biome === BIOME.Desert) id = BLOCK.DEAD_BUSH
	else if (kind === 0) id = BLOCK.FLOWER_RED
	else if (kind === 1) id = BLOCK.FLOWER_YELLOW
	else if (kind === 2) id = BLOCK.OAK_SAPLING
	place(view, bx, bz, wx, sample.surfaceY + 1, wz, id)
}

export function createVegetation(terrain: TerrainContext): Decorator {
	const seed = terrain.seed
	const cell = VEGETATION.treeCell
	const cellsX = CHUNK_X / cell
	const cellsZ = CHUNK_Z / cell
	const cellCount = cellsX * cellsZ

	return {
		decorate(cx, cz, view): void {
			// Nothing may be written into a chunk that is not loaded.
			if (!view.isLoaded(cx, cz)) return
			const bx = cx * CHUNK_X
			const bz = cz * CHUNK_Z

			// One cell of margin on each side: a canopy reaches at most two voxels
			// out of its column, so no tree outside this window can touch us.
			const sites: TreeSite[] = []
			for (let iz = -1; iz <= cellsZ; iz++) {
				for (let ix = -1; ix <= cellsX; ix++) {
					const cellX = bx + ix * cell
					const cellZ = bz + iz * cell
					const pick = hashU32(seed, SALT.tree, cellX, 0, cellZ)
					const wx = cellX + (pick % cell)
					const wz = cellZ + ((pick >>> 8) % cell)
					// treeDensity is trees per chunk, spread over the candidate cells.
					const roll = hash01(seed, SALT.tree, wx, 1, wz) * cellCount
					if (roll >= MAX_TREE_DENSITY) continue
					const sample = terrain.sampleColumn(wx, wz)
					if (roll >= biomeDef(sample.biome).treeDensity) continue
					// Dry land only: nothing takes root on a sea floor or in the surf.
					if (sample.surfaceY <= SEA_LEVEL) continue
					const shape = treeShape(seed, wx, wz, sample.biome)
					if (sample.surfaceY + shape.height + 2 >= CHUNK_Y) continue
					sites.push({ wx, wz, surfaceY: sample.surfaceY, shape })
				}
			}
			for (const site of sites) buildTrunk(view, bx, bz, site)
			for (const site of sites) buildCanopy(view, bx, bz, site)

			for (let z = 0; z < CHUNK_Z; z++) {
				for (let x = 0; x < CHUNK_X; x++) {
					const wx = bx + x
					const wz = bz + z
					// plantDensity is plants per chunk, spread over the columns.
					const roll = hash01(seed, SALT.plant, wx, 0, wz) * CHUNK_AREA
					if (roll >= MAX_PLANT_DENSITY) continue
					const sample = terrain.sampleColumn(wx, wz)
					if (roll >= biomeDef(sample.biome).plantDensity) continue
					placePlant(seed, view, bx, bz, wx, wz, sample)
				}
			}
		},
	}
}
