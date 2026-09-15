import {
	BLOCK,
	BLOCK_ENTITY,
	FACE,
	FACE_DIRS,
	type BedData,
	type BlockId,
	type Vec3i,
} from '@voxelcraft/core-types'
import { BLOCKS } from '../blocks/registry'
import type { BlockEntityWorld } from '../support/world'
import { createBedData } from './data'

/** The four horizontal faces a bed may point at, in canonical face order. */
export const HORIZONTAL_FACES: readonly number[] = [FACE.NegX, FACE.PosX, FACE.NegZ, FACE.PosZ]

/** Where the player respawns after dying. `null` means world spawn. */
export interface RespawnState {
	respawn: Vec3i | null
}

export function isBedBlock(id: BlockId): boolean {
	return id === BLOCK.BED_FOOT || id === BLOCK.BED_HEAD
}

function isReplaceable(id: BlockId): boolean {
	return BLOCKS.tryById(id)?.replaceable === true
}

function bedDataAt(world: BlockEntityWorld, x: number, y: number, z: number): BedData | null {
	const data = world.getBlockEntity(x, y, z)
	return data !== undefined && data.kind === BLOCK_ENTITY.Bed ? data : null
}

function offset(pos: Vec3i, facing: number): Vec3i {
	const dir = FACE_DIRS[facing] ?? FACE_DIRS[FACE.PosX]
	return { x: pos.x + dir.x, y: pos.y + dir.y, z: pos.z + dir.z }
}

/** Places a bed with its foot at (x, y, z) and its head towards `facing`. */
export function placeBed(
	world: BlockEntityWorld,
	x: number,
	y: number,
	z: number,
	facing: number = FACE.PosX,
): boolean {
	if (!HORIZONTAL_FACES.includes(facing)) return false
	const foot: Vec3i = { x, y, z }
	const head = offset(foot, facing)
	if (!isReplaceable(world.getBlock(foot.x, foot.y, foot.z))) return false
	if (!isReplaceable(world.getBlock(head.x, head.y, head.z))) return false
	world.setBlock(foot.x, foot.y, foot.z, BLOCK.BED_FOOT)
	world.setBlock(head.x, head.y, head.z, BLOCK.BED_HEAD)
	world.setBlockEntity(foot.x, foot.y, foot.z, createBedData({ head: false, facing }))
	world.setBlockEntity(head.x, head.y, head.z, createBedData({ head: true, facing }))
	return true
}

/** Foot position of the bed containing this voxel, or `null`. */
export function findBedFoot(
	world: BlockEntityWorld,
	x: number,
	y: number,
	z: number,
): Vec3i | null {
	const id = world.getBlock(x, y, z)
	if (id === BLOCK.BED_FOOT) return { x, y, z }
	if (id !== BLOCK.BED_HEAD) return null

	const head = bedDataAt(world, x, y, z)
	if (head !== null) {
		// The head sits one step along `facing` from the foot.
		const dir = FACE_DIRS[head.facing] ?? FACE_DIRS[FACE.PosX]
		const foot: Vec3i = { x: x - dir.x, y: y - dir.y, z: z - dir.z }
		if (world.getBlock(foot.x, foot.y, foot.z) === BLOCK.BED_FOOT) return foot
	}
	for (const face of HORIZONTAL_FACES) {
		const candidate = offset({ x, y, z }, face)
		if (world.getBlock(candidate.x, candidate.y, candidate.z) === BLOCK.BED_FOOT) return candidate
	}
	return null
}

/** Head position of the bed containing this voxel, or `null`. */
export function findBedHead(
	world: BlockEntityWorld,
	x: number,
	y: number,
	z: number,
): Vec3i | null {
	const foot = findBedFoot(world, x, y, z)
	if (foot === null) return null
	const data = bedDataAt(world, foot.x, foot.y, foot.z)
	if (data !== null) {
		const head = offset(foot, data.facing)
		if (world.getBlock(head.x, head.y, head.z) === BLOCK.BED_HEAD) return head
	}
	for (const face of HORIZONTAL_FACES) {
		const candidate = offset(foot, face)
		if (world.getBlock(candidate.x, candidate.y, candidate.z) === BLOCK.BED_HEAD) return candidate
	}
	return null
}

function canStand(world: BlockEntityWorld, pos: Vec3i): boolean {
	return !world.isSolid(pos.x, pos.y, pos.z) && !world.isSolid(pos.x, pos.y + 1, pos.z)
}

/**
 * Using a bed anchors the respawn point to its foot voxel. Returns the stored
 * anchor, or `null` when the voxel is not part of a bed.
 */
export function sleepInBed(
	world: BlockEntityWorld,
	state: RespawnState,
	x: number,
	y: number,
	z: number,
): Vec3i | null {
	const foot = findBedFoot(world, x, y, z)
	if (foot === null) return null
	state.respawn = { x: foot.x, y: foot.y, z: foot.z }
	return { x: foot.x, y: foot.y, z: foot.z }
}

/** True while the stored anchor still points at a bed. */
export function isRespawnValid(world: BlockEntityWorld, state: RespawnState): boolean {
	const anchor = state.respawn
	if (anchor === null) return false
	return isBedBlock(world.getBlock(anchor.x, anchor.y, anchor.z))
}

/** Drops an anchor whose bed was removed. Returns true when it was cleared. */
export function clearRespawnIfBedGone(world: BlockEntityWorld, state: RespawnState): boolean {
	if (state.respawn === null) return false
	if (isRespawnValid(world, state)) return false
	state.respawn = null
	return true
}

/**
 * Resolves the anchor into a position the player can actually stand in:
 * above the bed when free, otherwise the first free horizontal neighbour.
 */
export function respawnPositionFor(
	world: BlockEntityWorld,
	state: RespawnState,
): Vec3i | null {
	const anchor = state.respawn
	if (anchor === null || !isRespawnValid(world, state)) return null
	const above: Vec3i = { x: anchor.x, y: anchor.y + 1, z: anchor.z }
	if (canStand(world, above)) return above
	for (const face of HORIZONTAL_FACES) {
		const candidate = offset(anchor, face)
		if (canStand(world, candidate)) return candidate
	}
	return { x: anchor.x, y: anchor.y, z: anchor.z }
}

/** Removes both halves of the bed containing this voxel. */
export function breakBed(
	world: BlockEntityWorld,
	x: number,
	y: number,
	z: number,
): boolean {
	const foot = findBedFoot(world, x, y, z)
	if (foot === null) return false
	const head = findBedHead(world, foot.x, foot.y, foot.z)
	for (const pos of head === null ? [foot] : [foot, head]) {
		world.setBlockEntity(pos.x, pos.y, pos.z, null)
		world.setBlock(pos.x, pos.y, pos.z, BLOCK.AIR)
	}
	return true
}
