/**
 * Village block placement. Owned by task world-f (village), L2.
 *
 * decorate is clipped to the chunk it is handed, so a village that straddles a
 * border is written by each chunk for its own voxels only: every voxel has
 * exactly one writer and the result never depends on the order chunks are
 * visited in. Nothing is ever read back from the view either - what gets
 * written is a pure function of the plan - so a second pass over a chunk is a
 * no-op instead of a different village.
 *
 * Inside one chunk the order is fixed: flatten every ground column, lay the
 * gravel paths, then raise the pieces, so a path that runs past a building
 * cannot punch through its floor.
 */
import type { StructurePiece, VoxelEditView } from '@voxelcraft/core-types'
import {
	BLOCK,
	BLOCK_V2,
	CHUNK_X,
	CHUNK_Y,
	CHUNK_Z,
	STRUCTURE,
	hashU32,
} from '@voxelcraft/core-types'
import type { TerrainContext, VillageBuilder } from '../internal'
import { SALT_V2 } from '../internal'
import { VILLAGE_LAYOUT, doorColumn, pathColumns } from './layout'
import { createVillagePlanner } from './planner'

/** The one chunk a decorate call may write into. */
interface Clip {
	readonly bx: number
	readonly bz: number
}

function set(view: VoxelEditView, clip: Clip, x: number, y: number, z: number, id: number): void {
	if (y < 1 || y >= CHUNK_Y) return
	if (x < clip.bx || x >= clip.bx + CHUNK_X) return
	if (z < clip.bz || z >= clip.bz + CHUNK_Z) return
	view.setBlock(x, y, z, id)
}

function fill(
	view: VoxelEditView,
	clip: Clip,
	x0: number,
	y0: number,
	z0: number,
	x1: number,
	y1: number,
	z1: number,
	id: number,
): void {
	for (let y = y0; y <= y1; y++) {
		for (let z = z0; z <= z1; z++) {
			for (let x = x0; x <= x1; x++) set(view, clip, x, y, z, id)
		}
	}
}

/** Foundation under one ground column, clear air above it. */
function flatten(
	view: VoxelEditView,
	clip: Clip,
	x: number,
	z: number,
	groundY: number,
	clear: number,
): void {
	const base = groundY - VILLAGE_LAYOUT.foundationDepth
	fill(view, clip, x, base, z, x, groundY, z, BLOCK.COBBLESTONE)
	fill(view, clip, x, groundY + 1, z, x, groundY + clear, z, BLOCK.AIR)
}

function wallRing(
	view: VoxelEditView,
	clip: Clip,
	piece: StructurePiece,
	y0: number,
	y1: number,
	wall: number,
	corner: number,
): void {
	const x1 = piece.x + piece.sizeX - 1
	const z1 = piece.z + piece.sizeZ - 1
	for (let z = piece.z; z <= z1; z++) {
		for (let x = piece.x; x <= x1; x++) {
			const edgeX = x === piece.x || x === x1
			const edgeZ = z === piece.z || z === z1
			if (!edgeX && !edgeZ) continue
			fill(view, clip, x, y0, z, x, y1, z, edgeX && edgeZ ? corner : wall)
		}
	}
}

/** One window in the middle of each wall. */
function windows(
	view: VoxelEditView,
	clip: Clip,
	piece: StructurePiece,
	y: number,
	id: number,
): void {
	const x1 = piece.x + piece.sizeX - 1
	const z1 = piece.z + piece.sizeZ - 1
	const midX = piece.x + ((piece.sizeX - 1) >> 1)
	const midZ = piece.z + ((piece.sizeZ - 1) >> 1)
	set(view, clip, midX, y, piece.z, id)
	set(view, clip, midX, y, z1, id)
	set(view, clip, piece.x, y, midZ, id)
	set(view, clip, x1, y, midZ, id)
}

/** Door in the wall facing the well. */
function door(view: VoxelEditView, clip: Clip, piece: StructurePiece): void {
	const [x, z] = doorColumn(piece)
	set(view, clip, x, piece.y + 1, z, BLOCK.DOOR_LOWER)
	set(view, clip, x, piece.y + 2, z, BLOCK.DOOR_UPPER)
}

function buildWell(view: VoxelEditView, clip: Clip, piece: StructurePiece): void {
	const g = piece.y
	const x1 = piece.x + piece.sizeX - 1
	const z1 = piece.z + piece.sizeZ - 1
	fill(view, clip, piece.x, g, piece.z, x1, g, z1, BLOCK.COBBLESTONE)
	// The shaft is the inner ring of walls, left open at the centre.
	const inner: StructurePiece = {
		...piece,
		x: piece.x + 1,
		z: piece.z + 1,
		sizeX: piece.sizeX - 2,
		sizeZ: piece.sizeZ - 2,
	}
	const ix1 = inner.x + inner.sizeX - 1
	const iz1 = inner.z + inner.sizeZ - 1
	wallRing(view, clip, inner, g + 1, g + 1, BLOCK_V2.COBBLESTONE_WALL, BLOCK_V2.COBBLESTONE_WALL)
	// Four fence posts carry the roof over the shaft.
	fill(view, clip, inner.x, g + 2, inner.z, inner.x, g + 3, inner.z, BLOCK_V2.FENCE)
	fill(view, clip, ix1, g + 2, inner.z, ix1, g + 3, inner.z, BLOCK_V2.FENCE)
	fill(view, clip, inner.x, g + 2, iz1, inner.x, g + 3, iz1, BLOCK_V2.FENCE)
	fill(view, clip, ix1, g + 2, iz1, ix1, g + 3, iz1, BLOCK_V2.FENCE)
	fill(view, clip, inner.x, g + 4, inner.z, ix1, g + 4, iz1, BLOCK.PLANKS)
}

function buildHouse(seed: number, view: VoxelEditView, clip: Clip, piece: StructurePiece): void {
	const g = piece.y
	const x1 = piece.x + piece.sizeX - 1
	const z1 = piece.z + piece.sizeZ - 1
	const top = g + 3
	fill(view, clip, piece.x, g, piece.z, x1, g, z1, BLOCK.PLANKS)
	wallRing(view, clip, piece, g + 1, top, BLOCK.PLANKS, BLOCK.COBBLESTONE)
	windows(view, clip, piece, g + 2, BLOCK.GLASS)
	fill(view, clip, piece.x, top + 1, piece.z, x1, top + 1, z1, BLOCK.BRICKS)
	door(view, clip, piece)
	// Interior detail keys off the piece position, so it survives a border.
	const detail = hashU32(seed, SALT_V2.villagePiece, piece.x, piece.y, piece.z)
	set(
		view,
		clip,
		piece.x + 1,
		g + 1,
		piece.z + 1,
		(detail & 1) === 1 ? BLOCK.CRAFTING_TABLE : BLOCK.CHEST,
	)
	set(view, clip, x1 - 1, g + 1, z1 - 1, BLOCK.TORCH)
}

function buildFarm(view: VoxelEditView, clip: Clip, piece: StructurePiece): void {
	const g = piece.y
	const x1 = piece.x + piece.sizeX - 1
	const z1 = piece.z + piece.sizeZ - 1
	fill(view, clip, piece.x, g, piece.z, x1, g, z1, BLOCK.COBBLESTONE)
	wallRing(view, clip, piece, g + 1, g + 1, BLOCK_V2.FENCE, BLOCK_V2.FENCE)
	const [gateX, gateZ] = doorColumn(piece)
	set(view, clip, gateX, g + 1, gateZ, BLOCK_V2.FENCE_GATE)
	// Crop beds, with every third row kept as an irrigation channel.
	for (let z = piece.z + 1; z < z1; z++) {
		const wet = (z - piece.z) % 3 === 0
		for (let x = piece.x + 1; x < x1; x++) {
			set(view, clip, x, g, z, wet ? BLOCK_V2.FARMLAND_WET : BLOCK_V2.FARMLAND)
			if (!wet) set(view, clip, x, g + 1, z, BLOCK_V2.WHEAT_CROP)
		}
	}
	set(view, clip, piece.x + 1, g + 1, piece.z + 1, BLOCK_V2.HAY_BLOCK)
}

function buildChurch(view: VoxelEditView, clip: Clip, piece: StructurePiece): void {
	const g = piece.y
	const x1 = piece.x + piece.sizeX - 1
	const z1 = piece.z + piece.sizeZ - 1
	const top = g + 5
	fill(view, clip, piece.x, g, piece.z, x1, g, z1, BLOCK.STONE_BRICKS)
	wallRing(view, clip, piece, g + 1, top, BLOCK.STONE_BRICKS, BLOCK.COBBLESTONE)
	windows(view, clip, piece, g + 3, BLOCK.GLASS)
	fill(view, clip, piece.x, top + 1, piece.z, x1, top + 1, z1, BLOCK.STONE_BRICKS)
	door(view, clip, piece)
	// Spire over the nave, lit at the top.
	const midX = piece.x + ((piece.sizeX - 1) >> 1)
	const midZ = piece.z + ((piece.sizeZ - 1) >> 1)
	fill(view, clip, midX, top + 2, midZ, midX, top + 2, midZ, BLOCK.BRICKS)
	set(view, clip, midX, top + 3, midZ, BLOCK.TORCH)
	set(view, clip, piece.x + 1, g + 1, piece.z + 1, BLOCK.CHEST)
	set(view, clip, x1 - 1, g + 1, z1 - 1, BLOCK.TORCH)
}

function buildSmithy(view: VoxelEditView, clip: Clip, piece: StructurePiece): void {
	const g = piece.y
	const x1 = piece.x + piece.sizeX - 1
	const z1 = piece.z + piece.sizeZ - 1
	const top = g + 3
	fill(view, clip, piece.x, g, piece.z, x1, g, z1, BLOCK.COBBLESTONE)
	wallRing(view, clip, piece, g + 1, top, BLOCK.COBBLESTONE, BLOCK.STONE_BRICKS)
	windows(view, clip, piece, g + 2, BLOCK.GLASS)
	fill(view, clip, piece.x, top + 1, piece.z, x1, top + 1, z1, BLOCK.PLANKS)
	door(view, clip, piece)
	set(view, clip, piece.x + 1, g + 1, piece.z + 1, BLOCK.FURNACE)
	set(view, clip, x1 - 1, g + 1, piece.z + 1, BLOCK.CRAFTING_TABLE)
	set(view, clip, piece.x + 1, g + 1, z1 - 1, BLOCK.CHEST)
	set(view, clip, x1 - 1, g + 1, z1 - 1, BLOCK.TORCH)
}

function buildLamp(view: VoxelEditView, clip: Clip, piece: StructurePiece): void {
	const g = piece.y
	set(view, clip, piece.x, g, piece.z, BLOCK.COBBLESTONE)
	fill(view, clip, piece.x, g + 1, piece.z, piece.x, g + 3, piece.z, BLOCK_V2.FENCE)
	set(view, clip, piece.x, g + 4, piece.z, BLOCK.TORCH)
}

function buildPiece(seed: number, view: VoxelEditView, clip: Clip, piece: StructurePiece): void {
	switch (piece.kind) {
		case STRUCTURE.Well:
			buildWell(view, clip, piece)
			return
		case STRUCTURE.Farm:
			buildFarm(view, clip, piece)
			return
		case STRUCTURE.Church:
			buildChurch(view, clip, piece)
			return
		case STRUCTURE.Smithy:
			buildSmithy(view, clip, piece)
			return
		case STRUCTURE.Lamp:
			buildLamp(view, clip, piece)
			return
		default:
			buildHouse(seed, view, clip, piece)
	}
}

export function createVillageBuilder(terrain: TerrainContext): VillageBuilder {
	const seed = terrain.seed
	const planner = createVillagePlanner(terrain)
	return {
		planner,
		decorate(cx: number, cz: number, view: VoxelEditView): void {
			if (!view.isLoaded(cx, cz)) return
			const clip: Clip = { bx: cx * CHUNK_X, bz: cz * CHUNK_Z }
			for (const plan of planner.plansForChunk(cx, cz)) {
				if (plan.pieces.length === 0) continue
				// The well leads the list and every piece shares the flattened
				// ground level of the site.
				const groundY = plan.pieces[0].y
				for (const piece of plan.pieces) {
					const clear = piece.sizeY + VILLAGE_LAYOUT.clearMargin
					for (let dz = 0; dz < piece.sizeZ; dz++) {
						for (let dx = 0; dx < piece.sizeX; dx++) {
							flatten(view, clip, piece.x + dx, piece.z + dz, piece.y, clear)
						}
					}
				}
				for (const [x, z] of pathColumns(seed, plan)) {
					flatten(view, clip, x, z, groundY, VILLAGE_LAYOUT.pathClear)
					set(view, clip, x, groundY, z, BLOCK_V2.GRAVEL_PATH)
				}
				for (const piece of plan.pieces) buildPiece(seed, view, clip, piece)
			}
		},
	}
}
