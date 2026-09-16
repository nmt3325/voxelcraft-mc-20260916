/**
 * The small slice of terrain generation the dimension subtree depends on.
 *
 * World generation lives in a subtree this code must not touch, so instead of
 * importing it, portal travel asks for exactly two things: make sure the
 * destination column exists, and say where an entity may stand in it. A real
 * generator and a deterministic test double satisfy this equally well.
 */
import type { DimensionId } from '@voxelcraft/core-types'

/** Terrain queries a dimension transition needs on the destination side. */
export interface DimTerrainAccess {
	/**
	 * Ensures the chunk holding the column `(x, z)` of `dimension` is loaded and
	 * generated. Portal travel calls this once per transition and ignores the
	 * result, so implementations must be idempotent.
	 */
	ensureColumn(dimension: DimensionId, x: number, z: number): void
	/**
	 * First `y` in the column `(x, z)` of `dimension` an entity can be placed at,
	 * searching outwards from `preferredY`. Returns `null` when the column offers
	 * no safe spot; the caller then keeps the scaled `y`.
	 */
	safeLandingY(dimension: DimensionId, x: number, z: number, preferredY: number): number | null
}
