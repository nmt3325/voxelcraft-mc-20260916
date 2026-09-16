/**
 * The movement model of the navigation graph.
 *
 * `pathExpand` is the single source of truth for "which cells can I reach from
 * here and what does it cost". Both the A* planner and the uniform-cost
 * reference search in `astar.ts` call it, which is what makes the
 * "A* cost === Dijkstra cost" test meaningful instead of comparing two
 * different graphs.
 *
 * Rules taken from the contract, never re-derived here:
 *  - every base cost is a `MOVE_COST` entry,
 *  - an unloaded chunk is passable but costs `PATHFIND.unloadedPenalty` extra;
 *    it is never treated as a wall (`pathfind.ts` / `voxelWorld.ts` note),
 *  - diagonal moves may not cut corners: both orthogonal cells must be clear,
 *  - the agent envelope comes from `AgentShape`, and the default jump / safe
 *    fall values are derived from the frozen `PHYSICS` numbers.
 */
import {
	CHUNK_Y,
	FLUID,
	MOVE_COST,
	MOVE_KIND,
	PATHFIND,
	PHYSICS,
	unpackFluid,
	worldToChunk,
} from '@voxelcraft/core-types'
import type { AgentShape, MoveKind, Vec3i, VoxelView } from '@voxelcraft/core-types'

/** One expanded neighbour: where it lands, how it got there, what it costs. */
export interface PathStep {
	x: number
	y: number
	z: number
	kind: MoveKind
	cost: number
}

export interface PathDir {
	dx: number
	dz: number
	diagonal: boolean
}

/** Fixed expansion order. Determinism of the planner depends on it. */
export const PATH_DIRS: readonly PathDir[] = [
	{ dx: 1, dz: 0, diagonal: false },
	{ dx: -1, dz: 0, diagonal: false },
	{ dx: 0, dz: 1, diagonal: false },
	{ dx: 0, dz: -1, diagonal: false },
	{ dx: 1, dz: 1, diagonal: true },
	{ dx: 1, dz: -1, diagonal: true },
	{ dx: -1, dz: 1, diagonal: true },
	{ dx: -1, dz: -1, diagonal: true },
]

/** Apex of a jump: v^2 / 2g, floored to whole blocks. */
export const PATH_JUMP_BLOCKS = Math.floor(
	(PHYSICS.jumpVelocity * PHYSICS.jumpVelocity) / (2 * PHYSICS.gravity),
)

/** Mobs plan drops they can survive without damage. */
export const PATH_SAFE_FALL_BLOCKS = PHYSICS.fallDamageFreeBlocks

export function pathShape(width: number, height: number, canSwim = true): AgentShape {
	return {
		width,
		height,
		jumpHeight: PATH_JUMP_BLOCKS,
		maxFallDist: PATH_SAFE_FALL_BLOCKS,
		canSwim,
	}
}

export function pathCellLoaded(view: VoxelView, x: number, z: number): boolean {
	return view.isLoaded(worldToChunk(x), worldToChunk(z))
}

/** 0 inside loaded chunks, `PATHFIND.unloadedPenalty` outside them. */
export function pathCellPenalty(view: VoxelView, x: number, z: number): number {
	return pathCellLoaded(view, x, z) ? 0 : PATHFIND.unloadedPenalty
}

export function pathIsWater(view: VoxelView, x: number, y: number, z: number): boolean {
	return unpackFluid(view.getFluid(x, y, z)).kind === FLUID.Water
}

/** Whole cells the body occupies (a 1.95 high mob needs 2). */
export function pathBodyCells(shape: AgentShape): number {
	return Math.max(1, Math.ceil(shape.height))
}

/** The body fits at this cell (nothing solid in the column it occupies). */
export function pathClearance(
	view: VoxelView,
	x: number,
	y: number,
	z: number,
	shape: AgentShape,
): boolean {
	if (y < 0 || y >= CHUNK_Y) return false
	// Unknown terrain is assumed passable; the penalty, not a wall, discourages it.
	if (!pathCellLoaded(view, x, z)) return true
	const cells = pathBodyCells(shape)
	for (let i = 0; i < cells; i++) {
		if (view.isSolid(x, y + i, z)) return false
	}
	return true
}

/** The body fits here and something holds it up (ground, or water when it swims). */
export function pathIsStandable(
	view: VoxelView,
	x: number,
	y: number,
	z: number,
	shape: AgentShape,
): boolean {
	if (y < 0 || y >= CHUNK_Y) return false
	if (!pathCellLoaded(view, x, z)) return true
	if (!pathClearance(view, x, y, z, shape)) return false
	if (view.isSolid(x, y - 1, z)) return true
	return shape.canSwim && pathIsWater(view, x, y, z)
}

/**
 * Expands the neighbours of `from` into `out` (reused between calls).
 *
 * Move kinds: same level walk / diagonal / swim, `Ascend` for a one block step
 * up (bounded by `shape.jumpHeight`), `Descend` for a single block down and
 * `Fall` for a longer drop within `shape.maxFallDist`. Diagonals stay on the
 * same level: a diagonal jump or drop would clip a block corner.
 */
export function pathExpand(
	view: VoxelView,
	from: Vec3i,
	shape: AgentShape,
	out: PathStep[] = [],
): PathStep[] {
	out.length = 0
	const { x, y, z } = from
	for (const dir of PATH_DIRS) {
		const nx = x + dir.dx
		const nz = z + dir.dz
		if (dir.diagonal) {
			// No corner cutting: both orthogonal cells must be free to walk through.
			if (!pathClearance(view, x + dir.dx, y, z, shape)) continue
			if (!pathClearance(view, x, y, z + dir.dz, shape)) continue
		}
		const penalty = pathCellPenalty(view, nx, nz)
		if (pathIsStandable(view, nx, y, nz, shape)) {
			const swimming = shape.canSwim && pathIsWater(view, nx, y, nz)
			const kind = swimming
				? MOVE_KIND.Swim
				: dir.diagonal
					? MOVE_KIND.Diagonal
					: MOVE_KIND.Traverse
			const base = swimming
				? MOVE_COST.swim
				: dir.diagonal
					? MOVE_COST.diagonal
					: MOVE_COST.traverse
			out.push({ x: nx, y, z: nz, kind, cost: base + penalty })
			continue
		}
		if (dir.diagonal) continue
		// Step up: needs head room above the current cell and a landing above.
		const maxUp = Math.floor(shape.jumpHeight)
		let ascended = false
		for (let up = 1; up <= maxUp; up++) {
			if (!pathClearance(view, x, y + up, z, shape)) break
			if (pathIsStandable(view, nx, y + up, nz, shape)) {
				out.push({
					x: nx,
					y: y + up,
					z: nz,
					kind: MOVE_KIND.Ascend,
					cost: MOVE_COST.ascend + penalty,
				})
				ascended = true
				break
			}
		}
		if (ascended) continue
		// Walk off the edge and drop to the first landing within the safe distance.
		if (!pathClearance(view, nx, y, nz, shape)) continue
		const maxDrop = Math.max(0, Math.floor(shape.maxFallDist))
		for (let drop = 1; drop <= maxDrop; drop++) {
			const ny = y - drop
			if (ny < 0) break
			if (pathIsStandable(view, nx, ny, nz, shape)) {
				out.push({
					x: nx,
					y: ny,
					z: nz,
					kind: drop === 1 ? MOVE_KIND.Descend : MOVE_KIND.Fall,
					cost: MOVE_COST.descend + MOVE_COST.fallPerBlock * (drop - 1) + penalty,
				})
				break
			}
			if (view.isSolid(nx, ny, nz)) break
		}
	}
	// Vertical swimming: only available while already in water.
	if (shape.canSwim && pathIsWater(view, x, y, z)) {
		for (const dy of [1, -1]) {
			const ny = y + dy
			if (!pathClearance(view, x, ny, z, shape)) continue
			if (!pathIsWater(view, x, ny, z) && !pathIsStandable(view, x, ny, z, shape)) continue
			out.push({
				x,
				y: ny,
				z,
				kind: MOVE_KIND.Swim,
				cost: MOVE_COST.swim + pathCellPenalty(view, x, z),
			})
		}
	}
	return out
}

/**
 * Octile distance in the horizontal plane, scaled by the cheapest moves.
 *
 * Admissible and consistent: every move that changes `y` also pays at least one
 * horizontal move, and a pure fall costs more than the 0 this returns for it.
 */
export function pathOctile(ax: number, az: number, bx: number, bz: number): number {
	const dx = Math.abs(ax - bx)
	const dz = Math.abs(az - bz)
	const diagonals = Math.min(dx, dz)
	return (
		MOVE_COST.traverse * (dx + dz) +
		(MOVE_COST.diagonal - 2 * MOVE_COST.traverse) * diagonals
	)
}

export function pathDistance(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
	const dx = ax - bx
	const dy = ay - by
	const dz = az - bz
	return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
