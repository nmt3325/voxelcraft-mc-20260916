/**
 * Shared village geometry. Owned by task world-f (village), L2.
 *
 * Every helper here is a pure function of a plan, so the planner and the
 * builder always derive the same footprints, doors and path columns. That is
 * what lets a village straddling a chunk border be written identically from
 * either side, whatever order the chunks are generated in.
 */
import type { StructureKind, StructurePiece, VillagePlan } from '@voxelcraft/core-types'
import { CHUNK_X, CHUNK_Z, STRUCTURE, VILLAGE, hashU32 } from '@voxelcraft/core-types'
import { SALT_V2 } from '../internal'

/**
 * Layout knobs owned by this module. The frozen VILLAGE constants set the
 * budget; these only decide how the pieces are arranged inside it.
 */
export const VILLAGE_LAYOUT = {
	/** Direction slots around the well. Distinct slots keep footprints apart. */
	slotCount: 8,
	/** A building centre sits ringMin .. ringMin + ringSpan - 1 blocks out. */
	ringMin: 11,
	ringSpan: 5,
	/**
	 * Upper bound on how far a piece voxel sits from the centre:
	 * ringMin + ringSpan - 1 + floor(VILLAGE.buildingMaxFootprint / 2) = 19.
	 */
	maxRadius: 20,
	/** Blocks of foundation filled under a flattened ground column. */
	foundationDepth: 3,
	/** Air cleared over a piece, on top of the piece's own height. */
	clearMargin: 4,
	/** Air cleared over a path column. */
	pathClear: 5,
} as const

/** Piece heights in blocks, counting the ground level itself. */
export const PIECE_HEIGHT = {
	well: 5,
	house: 5,
	farm: 2,
	church: 9,
	smithy: 5,
	lamp: 5,
} as const

/** Quarter turns around +y mapped to the direction a piece faces. */
export const FACING: readonly (readonly [number, number])[] = [
	[1, 0],
	[0, 1],
	[-1, 0],
	[0, -1],
]

/** The slots a building can occupy around the well. */
export const SLOT_DIRS: readonly (readonly [number, number])[] = [
	[1, 0],
	[1, 1],
	[0, 1],
	[-1, 1],
	[-1, 0],
	[-1, -1],
	[0, -1],
	[1, -1],
]

/** One world column, as [x, z]. */
export type Column = readonly [number, number]

export interface Bounds {
	readonly minX: number
	readonly maxX: number
	readonly minZ: number
	readonly maxZ: number
}

/** Pieces that count against the VILLAGE.minBuildings..maxBuildings budget. */
export function isBuilding(kind: StructureKind): boolean {
	return (
		kind === STRUCTURE.House ||
		kind === STRUCTURE.Farm ||
		kind === STRUCTURE.Church ||
		kind === STRUCTURE.Smithy
	)
}

/** Wall column that carries the door, on the side facing the well. */
export function doorColumn(piece: StructurePiece): Column {
	const face = FACING[piece.rotation]
	const midX = piece.x + ((piece.sizeX - 1) >> 1)
	const midZ = piece.z + ((piece.sizeZ - 1) >> 1)
	if (face[0] > 0) return [piece.x + piece.sizeX - 1, midZ]
	if (face[0] < 0) return [piece.x, midZ]
	if (face[1] > 0) return [midX, piece.z + piece.sizeZ - 1]
	return [midX, piece.z]
}

/** One step of a path. pathWidth is frozen at 1; wider paths grow sideways. */
function pushPath(out: Column[], x: number, z: number, alongX: boolean): void {
	const half = (VILLAGE.pathWidth - 1) >> 1
	for (let d = -half; d <= half; d++) {
		out.push(alongX ? [x, z + d] : [x + d, z])
	}
}

/**
 * Columns of the paths that connect every building door to the well. Two
 * straight legs, so a path never cuts a diagonal, and which leg runs first is
 * a pure function of the piece position.
 */
export function pathColumns(seed: number, plan: VillagePlan): Column[] {
	const out: Column[] = []
	for (const piece of plan.pieces) {
		if (!isBuilding(piece.kind)) continue
		const face = FACING[piece.rotation]
		const door = doorColumn(piece)
		// Start one block outside the door, which already points at the well.
		let x = door[0] + face[0]
		let z = door[1] + face[1]
		const xFirst = (hashU32(seed, SALT_V2.villagePiece, piece.x, 2, piece.z) & 1) === 1
		pushPath(out, x, z, xFirst)
		for (const alongX of xFirst ? [true, false] : [false, true]) {
			if (alongX) {
				while (x !== plan.centerX) {
					x += Math.sign(plan.centerX - x)
					pushPath(out, x, z, true)
				}
			} else {
				while (z !== plan.centerZ) {
					z += Math.sign(plan.centerZ - z)
					pushPath(out, x, z, false)
				}
			}
		}
	}
	return out
}

/** Every ground column a plan owns: the piece footprints plus the paths. */
export function siteColumns(seed: number, plan: VillagePlan): Column[] {
	const out: Column[] = []
	for (const piece of plan.pieces) {
		for (let dz = 0; dz < piece.sizeZ; dz++) {
			for (let dx = 0; dx < piece.sizeX; dx++) out.push([piece.x + dx, piece.z + dz])
		}
	}
	for (const column of pathColumns(seed, plan)) out.push(column)
	return out
}

export function boundsOf(columns: readonly Column[]): Bounds {
	let minX = Infinity
	let maxX = -Infinity
	let minZ = Infinity
	let maxZ = -Infinity
	for (const [x, z] of columns) {
		if (x < minX) minX = x
		if (x > maxX) maxX = x
		if (z < minZ) minZ = z
		if (z > maxZ) maxZ = z
	}
	return { minX, maxX, minZ, maxZ }
}

export function boundsTouchChunk(bounds: Bounds, cx: number, cz: number): boolean {
	const bx = cx * CHUNK_X
	const bz = cz * CHUNK_Z
	return (
		bounds.maxX >= bx &&
		bounds.minX <= bx + CHUNK_X - 1 &&
		bounds.maxZ >= bz &&
		bounds.minZ <= bz + CHUNK_Z - 1
	)
}
