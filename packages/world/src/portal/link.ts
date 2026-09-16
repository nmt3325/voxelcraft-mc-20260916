/**
 * Portal linking: where a frame comes out, and which frame a traveller arrives
 * in. Owned by task v2-world-portal (an L2 of task v2-world).
 *
 * Horizontal scale is the frozen DIMENSION_PARAMS.coordinateScale ratio, so
 * overworld -> nether divides x and z by 8 and nether -> overworld multiplies
 * them by 8. The division floors, which keeps negative coordinates inside the
 * block they belong to and makes the two directions exact partners at the 8
 * block grain: floor(x / 8) * 8 always returns to the same nether column. The
 * destination y is clamped into the destination dimension's [0, ceilingY].
 *
 * Both searches walk cubic shells of growing radius around the query and keep
 * the nearest hit by squared euclidean distance, breaking ties with a hash of
 * the frozen SALT_V2 salts and, as a last resort, lexicographically. The
 * answer therefore never depends on the order voxels were visited or frames
 * were built. A shell walk may stop as soon as the best hit is no further than
 * the shell radius, because every voxel outside that shell is strictly further
 * away than the shell radius.
 *
 * Everything here is a pure function of (seed, dimension, coordinates): no
 * wall clock, no global PRNG.
 */
import { DIMENSION_PARAMS, PORTAL, hash01, worldToChunk } from '@voxelcraft/core-types'
import type { DimensionId, VoxelEditView, VoxelView } from '@voxelcraft/core-types'
import type { CreatePortalLinker, PortalFrame, PortalLinker } from '../internal'
import { SALT_V2 } from '../internal'
import type { PortalAxis } from './frame'
import {
	FRAME_BLOCK,
	isLavaBlock,
	isPortalInterior,
	makeFrame,
	planeGet,
	planeOpen,
	planeSolid,
	validateFrameAt,
	writeFrame,
} from './frame'

/** A generated landing is the smallest opening the frozen contract allows. */
const LANDING_WIDTH = PORTAL.minInnerWidth
const LANDING_HEIGHT = PORTAL.minInnerHeight

/**
 * How far a *new* landing may sit from the arrival column. Reusing an existing
 * frame uses the frozen PORTAL.linkSearchRadius; carving a new one stays close
 * so a traveller never appears a chunk away from where the link pointed.
 */
export const LANDING_SEARCH_RADIUS = 16

interface Hit {
	readonly frame: PortalFrame
	readonly dist2: number
	readonly tie: number
}

/** Nearest wins; ties go to the frozen hash, then to the lowest coordinates. */
function isBetter(next: Hit, best: Hit | null): boolean {
	if (best === null) return true
	if (next.dist2 !== best.dist2) return next.dist2 < best.dist2
	if (next.tie !== best.tie) return next.tie < best.tie
	if (next.frame.y !== best.frame.y) return next.frame.y < best.frame.y
	if (next.frame.z !== best.frame.z) return next.frame.z < best.frame.z
	if (next.frame.x !== best.frame.x) return next.frame.x < best.frame.x
	return next.frame.axis < best.frame.axis
}

/** Surface of the cube at Chebyshev distance `radius`, in a fixed order. */
function forEachShell(radius: number, visit: (dx: number, dy: number, dz: number) => void): void {
	if (radius === 0) {
		visit(0, 0, 0)
		return
	}
	for (let dy = -radius; dy <= radius; dy++) {
		const cap = dy === -radius || dy === radius
		for (let dz = -radius; dz <= radius; dz++) {
			if (cap || dz === -radius || dz === radius) {
				for (let dx = -radius; dx <= radius; dx++) visit(dx, dy, dz)
				continue
			}
			visit(-radius, dy, dz)
			visit(radius, dy, dz)
		}
	}
}

/**
 * Nearest frame whose opening reaches into the search radius, or null.
 *
 * Every frame has a bottom inner row, so testing only voxels that sit directly
 * on a frame block finds each frame at least once while skipping almost every
 * voxel of solid terrain.
 */
function searchFrame(
	view: VoxelView,
	seed: number,
	ceilingY: number,
	x: number,
	y: number,
	z: number,
): PortalFrame | null {
	// A holder, because the shell walk assigns from inside a callback.
	const state: { best: Hit | null } = { best: null }
	for (let radius = 0; radius <= PORTAL.linkSearchRadius; radius++) {
		forEachShell(radius, (dx, dy, dz) => {
			const cy = y + dy
			if (cy < 1 || cy > ceilingY) return
			const cx = x + dx
			const cz = z + dz
			if (view.getBlock(cx, cy - 1, cz) !== FRAME_BLOCK) return
			if (!isPortalInterior(view.getBlock(cx, cy, cz))) return
			const frame = validateFrameAt(view, cx, cy, cz)
			if (frame === null) return
			const hit: Hit = {
				frame,
				dist2: dx * dx + dy * dy + dz * dz,
				tie: hash01(seed, SALT_V2.portalLink, frame.x, frame.y, frame.z),
			}
			if (isBetter(hit, state.best)) state.best = hit
		})
		const best = state.best
		if (best !== null && best.dist2 <= radius * radius) break
	}
	const best = state.best
	return best === null ? null : best.frame
}

/**
 * Can a minimum size frame stand here, with `a0`/`gy` the lowest inner corner?
 *
 * Requires solid ground under the whole opening, two open voxels above it (the
 * body height the contract cares about; the third inner row is carved out by
 * writeFrame), and no lava anywhere in the footprint nor directly under the
 * sill, so a landing is never inside the lava sea and never a lid over it.
 */
function canLand(
	view: VoxelEditView,
	axis: PortalAxis,
	a0: number,
	gy: number,
	b: number,
	ceilingY: number,
): boolean {
	if (gy - 1 < 1 || gy + LANDING_HEIGHT + 1 > ceilingY) return false
	for (let i = -1; i <= LANDING_WIDTH; i++) {
		const wx = axis === 'x' ? a0 + i : b
		const wz = axis === 'x' ? b : a0 + i
		// Writes into an unloaded chunk go nowhere, so never promise a frame there.
		if (!view.isLoaded(worldToChunk(wx), worldToChunk(wz))) return false
	}
	for (let i = 0; i < LANDING_WIDTH; i++) {
		if (!planeSolid(view, axis, a0 + i, gy - 1, b)) return false
		if (!planeOpen(view, axis, a0 + i, gy, b)) return false
		if (!planeOpen(view, axis, a0 + i, gy + 1, b)) return false
	}
	for (let j = -2; j <= LANDING_HEIGHT; j++) {
		for (let i = -1; i <= LANDING_WIDTH; i++) {
			if (isLavaBlock(planeGet(view, axis, a0 + i, gy + j, b))) return false
		}
	}
	return true
}

/** Scaled horizontal coordinate, exact one way and floored the other. */
function scaleHorizontal(value: number, fromScale: number, toScale: number): number {
	if (fromScale === toScale) return value
	if (fromScale > toScale) return value * (fromScale / toScale)
	return Math.floor(value / (toScale / fromScale))
}

export function createPortalLinker(seed: number, dimension: DimensionId): PortalLinker {
	const homeCeilingY = DIMENSION_PARAMS[dimension].ceilingY

	return {
		validateFrame(view: VoxelView, x: number, y: number, z: number): PortalFrame | null {
			return validateFrameAt(view, x, y, z)
		},

		linkedPosition(from: DimensionId, to: DimensionId, x: number, y: number, z: number) {
			const fromScale = DIMENSION_PARAMS[from].coordinateScale
			const toScale = DIMENSION_PARAMS[to].coordinateScale
			return {
				x: scaleHorizontal(x, fromScale, toScale),
				y: Math.max(0, Math.min(DIMENSION_PARAMS[to].ceilingY, Math.floor(y))),
				z: scaleHorizontal(z, fromScale, toScale),
			}
		},

		findLinkTarget(view: VoxelView, x: number, y: number, z: number): PortalFrame | null {
			return searchFrame(view, seed, homeCeilingY, x, y, z)
		},

		ensureLanding(view: VoxelEditView, to: DimensionId, x: number, y: number, z: number) {
			const ceilingY = DIMENSION_PARAMS[to].ceilingY
			const existing = searchFrame(view, seed, ceilingY, x, y, z)
			if (existing !== null) return { frame: existing, created: false }

			// Orientation of a generated landing: a pure hash of the arrival
			// column, so every caller builds the same frame there.
			const axis: PortalAxis = hash01(seed, SALT_V2.portalLanding, x, y, z) < 0.5 ? 'x' : 'z'
			const state: { best: Hit | null } = { best: null }
			for (let radius = 0; radius <= LANDING_SEARCH_RADIUS; radius++) {
				forEachShell(radius, (dx, dy, dz) => {
					const cx = x + dx
					const cy = y + dy
					const cz = z + dz
					const a0 = axis === 'x' ? cx : cz
					const b = axis === 'x' ? cz : cx
					if (!canLand(view, axis, a0, cy, b, ceilingY)) return
					const frame = makeFrame(axis, a0, cy, b, LANDING_WIDTH, LANDING_HEIGHT)
					const hit: Hit = {
						frame,
						dist2: dx * dx + dy * dy + dz * dz,
						tie: hash01(seed, SALT_V2.portalLanding, frame.x, frame.y, frame.z),
					}
					if (isBetter(hit, state.best)) state.best = hit
				})
				const best = state.best
				if (best !== null && best.dist2 <= radius * radius) break
			}
			const best = state.best
			if (best === null) return null
			writeFrame(view, best.frame)
			return { frame: best.frame, created: true }
		},
	}
}

/** Compile time proof that the factory still matches the seam. */
const _seamCheck: CreatePortalLinker = createPortalLinker
void _seamCheck
