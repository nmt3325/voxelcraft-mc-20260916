import {
	BLOCK,
	BLOCK_ENTITY,
	FACE,
	type BlockId,
	type DoorData,
} from '@voxelcraft/core-types'
import { BLOCKS } from '../blocks/registry'
import type { BlockEntityWorld } from '../support/world'
import { createDoorData } from './data'

/**
 * Doors occupy two voxels (`DOOR_LOWER` + `DOOR_UPPER`) and keep one
 * `DoorData` per half. Both halves are always written together so the
 * renderer and the redstone engine never observe a half-open door.
 */
export function isDoorBlock(id: BlockId): boolean {
	return id === BLOCK.DOOR_LOWER || id === BLOCK.DOOR_UPPER
}

function isReplaceable(id: BlockId): boolean {
	return BLOCKS.tryById(id)?.replaceable === true
}

/** Y of the lower half for any door voxel, or `null` when there is no door. */
export function findDoorLowerY(
	world: BlockEntityWorld,
	x: number,
	y: number,
	z: number,
): number | null {
	const id = world.getBlock(x, y, z)
	if (id === BLOCK.DOOR_LOWER) return y
	if (id === BLOCK.DOOR_UPPER && world.getBlock(x, y - 1, z) === BLOCK.DOOR_LOWER) return y - 1
	return null
}

function doorDataAt(
	world: BlockEntityWorld,
	x: number,
	y: number,
	z: number,
): DoorData | null {
	const data = world.getBlockEntity(x, y, z)
	return data !== undefined && data.kind === BLOCK_ENTITY.Door ? data : null
}

/** Lower-half state of the door containing this voxel. */
export function getDoorState(
	world: BlockEntityWorld,
	x: number,
	y: number,
	z: number,
): DoorData | null {
	const lowerY = findDoorLowerY(world, x, y, z)
	if (lowerY === null) return null
	return doorDataAt(world, x, lowerY, z)
}

export function isDoorOpen(
	world: BlockEntityWorld,
	x: number,
	y: number,
	z: number,
): boolean {
	return getDoorState(world, x, y, z)?.open === true
}

/** Places a full door with its foot at (x, y, z). */
export function placeDoor(
	world: BlockEntityWorld,
	x: number,
	y: number,
	z: number,
	facing: number = FACE.PosX,
): boolean {
	if (!isReplaceable(world.getBlock(x, y, z))) return false
	if (!isReplaceable(world.getBlock(x, y + 1, z))) return false
	world.setBlock(x, y, z, BLOCK.DOOR_LOWER)
	world.setBlock(x, y + 1, z, BLOCK.DOOR_UPPER)
	world.setBlockEntity(x, y, z, createDoorData({ half: 0, facing }))
	world.setBlockEntity(x, y + 1, z, createDoorData({ half: 1, facing }))
	return true
}

function writeDoorHalves(
	world: BlockEntityWorld,
	x: number,
	lowerY: number,
	z: number,
	mutate: (data: DoorData) => void,
): boolean {
	let changed = false
	for (const [y, half] of [
		[lowerY, 0],
		[lowerY + 1, 1],
	] as const) {
		const current = doorDataAt(world, x, y, z)
		if (current === null) continue
		const next = createDoorData({ ...current, half: half as 0 | 1 })
		mutate(next)
		if (next.open !== current.open || next.powered !== current.powered) changed = true
		world.setBlockEntity(x, y, z, next)
	}
	return changed
}

/** Sets the open state of both halves. Returns true when something changed. */
export function setDoorOpen(
	world: BlockEntityWorld,
	x: number,
	y: number,
	z: number,
	open: boolean,
): boolean {
	const lowerY = findDoorLowerY(world, x, y, z)
	if (lowerY === null) return false
	return writeDoorHalves(world, x, lowerY, z, (data) => {
		data.open = open
	})
}

/** Player interaction. Returns the new open state, or `null` without a door. */
export function toggleDoor(
	world: BlockEntityWorld,
	x: number,
	y: number,
	z: number,
): boolean | null {
	const state = getDoorState(world, x, y, z)
	if (state === null) return null
	const next = !state.open
	setDoorOpen(world, x, y, z, next)
	return next
}

/**
 * Redstone linkage: power forces the door open, losing power closes it.
 * Returns true when the open state changed, so callers can emit an event.
 */
export function setDoorPowered(
	world: BlockEntityWorld,
	x: number,
	y: number,
	z: number,
	powered: boolean,
): boolean {
	const lowerY = findDoorLowerY(world, x, y, z)
	if (lowerY === null) return false
	const before = doorDataAt(world, x, lowerY, z)?.open ?? false
	writeDoorHalves(world, x, lowerY, z, (data) => {
		data.powered = powered
		data.open = powered
	})
	const after = doorDataAt(world, x, lowerY, z)?.open ?? false
	return before !== after
}

/** Removes both halves of the door containing this voxel. */
export function breakDoor(
	world: BlockEntityWorld,
	x: number,
	y: number,
	z: number,
): boolean {
	const lowerY = findDoorLowerY(world, x, y, z)
	if (lowerY === null) return false
	for (const y of [lowerY, lowerY + 1]) {
		world.setBlockEntity(x, y, z, null)
		world.setBlock(x, y, z, BLOCK.AIR)
	}
	return true
}
