/**
 * Swept AABB movement against the voxel grid.
 *
 * Contract rules implemented here:
 *  - axis resolution order is fixed: Y, then X, then Z;
 *  - movement is split so no sub step travels more than
 *    `opts.maxSubStepBlocks` (0.45) on any axis, which is the tunnelling guard;
 *  - a blocked horizontal move is retried `opts.stepHeight` (0.6) higher, so a
 *    0.5 ledge is walked over while a 1.0 ledge needs a jump;
 *  - contacts stop `opts.epsilon` (1e-3) short of the surface, which is what
 *    makes a resting entity stop moving instead of oscillating.
 *
 * `velocity` is the displacement requested for this step, in blocks
 * (velocity * dt). The contract signature has no `dt`, so the caller scales.
 */
import { FLUID, PHYSICS, unpackFluid } from '@voxelcraft/core-types'
import type { AABB, MoveEntity, MoveResult, VoxelView } from '@voxelcraft/core-types'
import { offsetAabb } from './aabb'

export interface MoveOptions {
	stepHeight: number
	epsilon: number
	maxSubStepBlocks: number
}

export const DEFAULT_MOVE_OPTIONS: MoveOptions = {
	stepHeight: PHYSICS.stepHeight,
	epsilon: PHYSICS.epsilon,
	maxSubStepBlocks: PHYSICS.maxSubStepBlocks,
}

/** Tolerance used only to decide whether a surface is "already touching". */
const TOUCH = 1e-9

interface AxisSweep {
	moved: number
	hit: boolean
}

const NO_MOVE: AxisSweep = { moved: 0, hit: false }

function spanLo(min: number, epsilon: number): number {
	return Math.floor(min + epsilon)
}

function spanHi(max: number, epsilon: number): number {
	return Math.floor(max - epsilon)
}

/** Never allow a contact to push the entity backwards past its start. */
function clampForward(allowed: number, delta: number): number {
	return Math.min(delta, Math.max(0, allowed))
}

function clampBackward(allowed: number, delta: number): number {
	return Math.max(delta, Math.min(0, allowed))
}

function sweepY(box: AABB, delta: number, view: VoxelView, epsilon: number): AxisSweep {
	if (delta === 0) return NO_MOVE
	const x0 = spanLo(box.minX, epsilon)
	const x1 = spanHi(box.maxX, epsilon)
	const z0 = spanLo(box.minZ, epsilon)
	const z1 = spanHi(box.maxZ, epsilon)
	let limit = delta
	let hit = false
	if (delta > 0) {
		const from = Math.ceil(box.maxY - TOUCH)
		const to = Math.floor(box.maxY + delta)
		for (let y = from; y <= to && !hit; y++) {
			for (let x = x0; x <= x1 && !hit; x++) {
				for (let z = z0; z <= z1 && !hit; z++) {
					if (!view.isSolid(x, y, z)) continue
					limit = clampForward(y - box.maxY - epsilon, delta)
					hit = true
				}
			}
		}
	} else {
		const from = Math.floor(box.minY - 1 + TOUCH)
		const to = Math.floor(box.minY + delta)
		for (let y = from; y >= to && !hit; y--) {
			for (let x = x0; x <= x1 && !hit; x++) {
				for (let z = z0; z <= z1 && !hit; z++) {
					if (!view.isSolid(x, y, z)) continue
					limit = clampBackward(y + 1 - box.minY + epsilon, delta)
					hit = true
				}
			}
		}
	}
	return { moved: hit ? limit : delta, hit }
}

function sweepX(box: AABB, delta: number, view: VoxelView, epsilon: number): AxisSweep {
	if (delta === 0) return NO_MOVE
	const y0 = spanLo(box.minY, epsilon)
	const y1 = spanHi(box.maxY, epsilon)
	const z0 = spanLo(box.minZ, epsilon)
	const z1 = spanHi(box.maxZ, epsilon)
	let limit = delta
	let hit = false
	if (delta > 0) {
		const from = Math.ceil(box.maxX - TOUCH)
		const to = Math.floor(box.maxX + delta)
		for (let x = from; x <= to && !hit; x++) {
			for (let y = y0; y <= y1 && !hit; y++) {
				for (let z = z0; z <= z1 && !hit; z++) {
					if (!view.isSolid(x, y, z)) continue
					limit = clampForward(x - box.maxX - epsilon, delta)
					hit = true
				}
			}
		}
	} else {
		const from = Math.floor(box.minX - 1 + TOUCH)
		const to = Math.floor(box.minX + delta)
		for (let x = from; x >= to && !hit; x--) {
			for (let y = y0; y <= y1 && !hit; y++) {
				for (let z = z0; z <= z1 && !hit; z++) {
					if (!view.isSolid(x, y, z)) continue
					limit = clampBackward(x + 1 - box.minX + epsilon, delta)
					hit = true
				}
			}
		}
	}
	return { moved: hit ? limit : delta, hit }
}

function sweepZ(box: AABB, delta: number, view: VoxelView, epsilon: number): AxisSweep {
	if (delta === 0) return NO_MOVE
	const x0 = spanLo(box.minX, epsilon)
	const x1 = spanHi(box.maxX, epsilon)
	const y0 = spanLo(box.minY, epsilon)
	const y1 = spanHi(box.maxY, epsilon)
	let limit = delta
	let hit = false
	if (delta > 0) {
		const from = Math.ceil(box.maxZ - TOUCH)
		const to = Math.floor(box.maxZ + delta)
		for (let z = from; z <= to && !hit; z++) {
			for (let x = x0; x <= x1 && !hit; x++) {
				for (let y = y0; y <= y1 && !hit; y++) {
					if (!view.isSolid(x, y, z)) continue
					limit = clampForward(z - box.maxZ - epsilon, delta)
					hit = true
				}
			}
		}
	} else {
		const from = Math.floor(box.minZ - 1 + TOUCH)
		const to = Math.floor(box.minZ + delta)
		for (let z = from; z >= to && !hit; z--) {
			for (let x = x0; x <= x1 && !hit; x++) {
				for (let y = y0; y <= y1 && !hit; y++) {
					if (!view.isSolid(x, y, z)) continue
					limit = clampBackward(z + 1 - box.minZ + epsilon, delta)
					hit = true
				}
			}
		}
	}
	return { moved: hit ? limit : delta, hit }
}

/** True when a solid voxel supports the box within a couple of epsilons. */
export function isOnGround(box: AABB, view: VoxelView, epsilon: number = PHYSICS.epsilon): boolean {
	const probe = box.minY - 2 * epsilon
	const y = Math.floor(probe)
	// The support surface must be at the feet, never above them: a box sunk
	// into a solid block is not standing on it.
	if (y + 1 > box.minY + TOUCH) return false
	const x0 = spanLo(box.minX, epsilon)
	const x1 = spanHi(box.maxX, epsilon)
	const z0 = spanLo(box.minZ, epsilon)
	const z1 = spanHi(box.maxZ, epsilon)
	for (let x = x0; x <= x1; x++) {
		for (let z = z0; z <= z1; z++) {
			if (view.isSolid(x, y, z)) return true
		}
	}
	return false
}

/** Which fluids the box currently overlaps. */
export function probeFluids(
	box: AABB,
	view: VoxelView,
	epsilon: number = PHYSICS.epsilon,
): { water: boolean; lava: boolean } {
	let water = false
	let lava = false
	const x0 = spanLo(box.minX, epsilon)
	const x1 = spanHi(box.maxX, epsilon)
	const y0 = spanLo(box.minY, epsilon)
	const y1 = spanHi(box.maxY, epsilon)
	const z0 = spanLo(box.minZ, epsilon)
	const z1 = spanHi(box.maxZ, epsilon)
	for (let x = x0; x <= x1; x++) {
		for (let y = y0; y <= y1; y++) {
			for (let z = z0; z <= z1; z++) {
				const kind = unpackFluid(view.getFluid(x, y, z)).kind
				if (kind === FLUID.Water) water = true
				else if (kind === FLUID.Lava) lava = true
			}
		}
	}
	return { water, lava }
}

/**
 * Non-penetration invariant used by the tests: no solid voxel may overlap the
 * box once the epsilon skin is removed.
 */
export function isBoxClearOfSolids(
	box: AABB,
	view: VoxelView,
	epsilon: number = PHYSICS.epsilon,
): boolean {
	const x0 = spanLo(box.minX, epsilon)
	const x1 = spanHi(box.maxX, epsilon)
	const y0 = spanLo(box.minY, epsilon)
	const y1 = spanHi(box.maxY, epsilon)
	const z0 = spanLo(box.minZ, epsilon)
	const z1 = spanHi(box.maxZ, epsilon)
	for (let x = x0; x <= x1; x++) {
		for (let y = y0; y <= y1; y++) {
			for (let z = z0; z <= z1; z++) {
				if (view.isSolid(x, y, z)) return false
			}
		}
	}
	return true
}

/**
 * Sub step count. The per sub step distance bound is the invariant that keeps
 * fast movers from tunnelling, so it is never traded away: at terminal
 * velocity a 50 ms step needs 9 sub steps, one more than `PHYSICS.maxSubSteps`,
 * and honouring the cap instead of the bound would let an entity pass through
 * a floor.
 */
export function subStepCount(
	dx: number,
	dy: number,
	dz: number,
	maxSubStepBlocks: number,
): number {
	const longest = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz))
	const bound = maxSubStepBlocks > 0 ? maxSubStepBlocks : PHYSICS.maxSubStepBlocks
	return Math.max(1, Math.ceil(longest / bound))
}

export const moveEntity: MoveEntity = (box, velocity, view, opts): MoveResult => {
	const epsilon = opts.epsilon
	const stepHeight = opts.stepHeight
	const steps = subStepCount(velocity.x, velocity.y, velocity.z, opts.maxSubStepBlocks)
	const sx = velocity.x / steps
	const sy = velocity.y / steps
	const sz = velocity.z / steps
	let current: AABB = { ...box }
	let dx = 0
	let dy = 0
	let dz = 0
	let hitX = false
	let hitY = false
	let hitZ = false
	let steppedUp = false

	for (let step = 0; step < steps; step++) {
		const yr = sweepY(current, sy, view, epsilon)
		current = offsetAabb(current, 0, yr.moved, 0)
		dy += yr.moved
		hitY = hitY || yr.hit

		const grounded = isOnGround(current, view, epsilon)
		const beforeHorizontal = current

		const xr = sweepX(current, sx, view, epsilon)
		const afterX = offsetAabb(current, xr.moved, 0, 0)
		const zr = sweepZ(afterX, sz, view, epsilon)
		let resolved = offsetAabb(afterX, 0, 0, zr.moved)
		let movedX = xr.moved
		let movedZ = zr.moved
		let blockedX = xr.hit
		let blockedZ = zr.hit

		if ((blockedX || blockedZ) && grounded && stepHeight > 0) {
			const up = sweepY(beforeHorizontal, stepHeight, view, epsilon)
			if (up.moved > epsilon) {
				const raised = offsetAabb(beforeHorizontal, 0, up.moved, 0)
				const rx = sweepX(raised, sx, view, epsilon)
				const raisedX = offsetAabb(raised, rx.moved, 0, 0)
				const rz = sweepZ(raisedX, sz, view, epsilon)
				const raisedZ = offsetAabb(raisedX, 0, 0, rz.moved)
				const stepped = Math.abs(rx.moved) + Math.abs(rz.moved)
				const plain = Math.abs(movedX) + Math.abs(movedZ)
				if (stepped > plain + epsilon) {
					const down = sweepY(raisedZ, -up.moved, view, epsilon)
					if (down.hit) {
						resolved = offsetAabb(raisedZ, 0, down.moved, 0)
						dy += up.moved + down.moved
						movedX = rx.moved
						movedZ = rz.moved
						blockedX = rx.hit
						blockedZ = rz.hit
						steppedUp = true
					}
				}
			}
		}

		current = resolved
		dx += movedX
		dz += movedZ
		hitX = hitX || blockedX
		hitZ = hitZ || blockedZ
	}

	const fluids = probeFluids(current, view, epsilon)
	return {
		box: current,
		dx,
		dy,
		dz,
		onGround: isOnGround(current, view, epsilon),
		hitX,
		hitY,
		hitZ,
		steppedUp,
		inWater: fluids.water,
		inLava: fluids.lava,
	}
}
