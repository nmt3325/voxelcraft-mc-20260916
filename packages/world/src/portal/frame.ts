/**
 * Obsidian portal frame geometry. Owned by task v2-world-portal (an L2 of
 * task v2-world), living entirely inside `src/portal/**`.
 *
 * A frame is one voxel thick: its opening lies in a single plane running along
 * the x or the z axis, and the third coordinate is that plane. Every border
 * voxel is PORTAL.frameBlock (obsidian) and every interior voxel is air or an
 * already lit BLOCK_V2.NETHER_PORTAL, so a lit portal and an empty frame are
 * validated by the same code path.
 *
 * CORNER BLOCKS ARE NOT REQUIRED. The four diagonal voxels just outside the
 * opening are never read, so a frame built without corners and one built with
 * them validate identically; world-f.portal.test.ts pins both directions of
 * that choice. `writeFrame` does fill the corners, because a generated landing
 * reads better as a closed box and validation ignores them either way.
 *
 * Every function here is a pure function of the view contents and the given
 * coordinates: no wall clock, no global PRNG, no dependency on call order.
 */
import { BLOCK, BLOCK_V2, PORTAL } from '@voxelcraft/core-types'
import type { BlockId, VoxelEditView, VoxelView } from '@voxelcraft/core-types'
import type { PortalFrame } from '../internal'

/** The axis an opening runs along. Frozen shape, taken from the seam. */
export type PortalAxis = PortalFrame['axis']

/** Frozen frame material and frozen interior block. Never redefined here. */
export const FRAME_BLOCK: BlockId = PORTAL.frameBlock
export const PORTAL_BLOCK: BlockId = BLOCK_V2.NETHER_PORTAL

/**
 * Probe order when a voxel could belong to either plane. Fixed, so two callers
 * asking about the same voxel can never disagree about which frame it is in.
 */
export const PORTAL_AXES: readonly PortalAxis[] = ['x', 'z']

/** A voxel an opening is allowed to contain. */
export function isPortalInterior(id: number): boolean {
	return id === BLOCK.AIR || id === PORTAL_BLOCK
}

export function isLavaBlock(id: number): boolean {
	return id === BLOCK.LAVA || id === BLOCK.LAVA_FLOWING
}

/*
 * Plane coordinates used everywhere below: `a` runs along the opening and `b`
 * is the fixed side of the plane, so one implementation covers both axes and
 * the x and the z case cannot drift apart.
 */
export function planeGet(
	view: VoxelView,
	axis: PortalAxis,
	a: number,
	y: number,
	b: number,
): BlockId {
	return axis === 'x' ? view.getBlock(a, y, b) : view.getBlock(b, y, a)
}

export function planeSolid(
	view: VoxelView,
	axis: PortalAxis,
	a: number,
	y: number,
	b: number,
): boolean {
	return axis === 'x' ? view.isSolid(a, y, b) : view.isSolid(b, y, a)
}

/** Free space a body can occupy: neither solid nor a fluid. */
export function planeOpen(
	view: VoxelView,
	axis: PortalAxis,
	a: number,
	y: number,
	b: number,
): boolean {
	return axis === 'x'
		? !view.isSolid(a, y, b) && !view.isLiquid(a, y, b)
		: !view.isSolid(b, y, a) && !view.isLiquid(b, y, a)
}

function planeSet(
	view: VoxelEditView,
	axis: PortalAxis,
	a: number,
	y: number,
	b: number,
	id: BlockId,
): void {
	const x = axis === 'x' ? a : b
	const z = axis === 'x' ? b : a
	view.setBlock(x, y, z, id)
	// A frame never keeps the fluid that used to be in its voxels, or a portal
	// carved into the lava sea would arrive flooded.
	view.setFluid(x, y, z, 0)
}

/**
 * Interior voxels between the origin and the border in one direction, or null
 * when there is no border within the frozen maximum. Returning null for that
 * case is what rejects both an oversized opening and a border with a gap: a
 * gap lets the scan run past where the border should have been.
 */
function reach(read: (d: number) => number, step: number, limit: number): number | null {
	for (let i = 1; i <= limit; i++) {
		const id = read(i * step)
		if (id === FRAME_BLOCK) return i - 1
		if (!isPortalInterior(id)) return null
	}
	return null
}

/** Builds the seam's PortalFrame from plane coordinates. */
export function makeFrame(
	axis: PortalAxis,
	a0: number,
	y0: number,
	b: number,
	innerWidth: number,
	innerHeight: number,
): PortalFrame {
	return axis === 'x'
		? { axis, x: a0, y: y0, z: b, innerWidth, innerHeight }
		: { axis, x: b, y: y0, z: a0, innerWidth, innerHeight }
}

/** Along-axis coordinate of a frame's opening. */
export function frameAlong(frame: PortalFrame): number {
	return frame.axis === 'x' ? frame.x : frame.z
}

/** Fixed side coordinate of a frame's plane. */
export function frameSide(frame: PortalFrame): number {
	return frame.axis === 'x' ? frame.z : frame.x
}

function validateOnAxis(
	view: VoxelView,
	axis: PortalAxis,
	x: number,
	y: number,
	z: number,
): PortalFrame | null {
	const a = axis === 'x' ? x : z
	const b = axis === 'x' ? z : x
	if (!isPortalInterior(planeGet(view, axis, a, y, b))) return null

	const left = reach((d) => planeGet(view, axis, a + d, y, b), -1, PORTAL.maxInnerWidth)
	if (left === null) return null
	const right = reach((d) => planeGet(view, axis, a + d, y, b), 1, PORTAL.maxInnerWidth)
	if (right === null) return null
	const down = reach((d) => planeGet(view, axis, a, y + d, b), -1, PORTAL.maxInnerHeight)
	if (down === null) return null
	const up = reach((d) => planeGet(view, axis, a, y + d, b), 1, PORTAL.maxInnerHeight)
	if (up === null) return null

	const innerWidth = left + right + 1
	const innerHeight = down + up + 1
	if (innerWidth < PORTAL.minInnerWidth || innerWidth > PORTAL.maxInnerWidth) return null
	if (innerHeight < PORTAL.minInnerHeight || innerHeight > PORTAL.maxInnerHeight) return null

	const a0 = a - left
	const y0 = y - down
	// The scan above only crossed the row and the column through the origin, so
	// the rest of the opening is still unchecked.
	for (let j = 0; j < innerHeight; j++) {
		for (let i = 0; i < innerWidth; i++) {
			if (!isPortalInterior(planeGet(view, axis, a0 + i, y0 + j, b))) return null
		}
	}
	// Sill and lintel, then the two jambs. The corners are deliberately skipped.
	for (let i = 0; i < innerWidth; i++) {
		if (planeGet(view, axis, a0 + i, y0 - 1, b) !== FRAME_BLOCK) return null
		if (planeGet(view, axis, a0 + i, y0 + innerHeight, b) !== FRAME_BLOCK) return null
	}
	for (let j = 0; j < innerHeight; j++) {
		if (planeGet(view, axis, a0 - 1, y0 + j, b) !== FRAME_BLOCK) return null
		if (planeGet(view, axis, a0 + innerWidth, y0 + j, b) !== FRAME_BLOCK) return null
	}
	return makeFrame(axis, a0, y0, b, innerWidth, innerHeight)
}

/** The frame around this inner voxel, or null when it is not inside one. */
export function validateFrameAt(
	view: VoxelView,
	x: number,
	y: number,
	z: number,
): PortalFrame | null {
	for (const axis of PORTAL_AXES) {
		const frame = validateOnAxis(view, axis, x, y, z)
		if (frame !== null) return frame
	}
	return null
}

/**
 * Writes a frame into the view: obsidian border including its corners, and a
 * lit opening. Idempotent, so building the same landing twice is a no-op.
 */
export function writeFrame(view: VoxelEditView, frame: PortalFrame): void {
	const a0 = frameAlong(frame)
	const b = frameSide(frame)
	for (let j = -1; j <= frame.innerHeight; j++) {
		for (let i = -1; i <= frame.innerWidth; i++) {
			const inner = i >= 0 && i < frame.innerWidth && j >= 0 && j < frame.innerHeight
			planeSet(view, frame.axis, a0 + i, frame.y + j, b, inner ? PORTAL_BLOCK : FRAME_BLOCK)
		}
	}
}
