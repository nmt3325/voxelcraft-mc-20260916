import { describe, expect, it } from 'vitest'
import {
	BLOCK,
	BLOCK_ENTITY,
	FACE,
	INVENTORY,
	ITEM,
	type BlockEntityData,
	type ChestData,
	type ItemStack,
	type SerializedBlockEntity,
} from '@voxelcraft/core-types'
import { createMemoryWorld } from '../support/memoryWorld'
import {
	blockEntityFromJson,
	blockEntityToJson,
	cloneBlockEntityData,
	createBlockEntityData,
	createChestData,
	createDoorData,
	createFurnaceData,
	deserializeBlockEntities,
	isBlockEntityData,
	serializeBlockEntities,
} from './data'
import {
	countItemInChest,
	drainChest,
	insertIntoChest,
	isChestEmpty,
	takeFromChest,
} from './chest'
import {
	breakDoor,
	getDoorState,
	isDoorOpen,
	placeDoor,
	setDoorPowered,
	toggleDoor,
} from './door'
import {
	breakBed,
	clearRespawnIfBedGone,
	findBedFoot,
	isRespawnValid,
	placeBed,
	respawnPositionFor,
	sleepInBed,
	type RespawnState,
} from './bed'

const COBBLE_ITEM = BLOCK.COBBLESTONE

function stack(item: number, count: number, damage = 0): ItemStack {
	return { item, count, damage }
}

describe('block entity payloads', () => {
	it('creates defaults for every kind', () => {
		const chest = createBlockEntityData(BLOCK_ENTITY.Chest)
		expect(chest.kind).toBe(BLOCK_ENTITY.Chest)
		expect((chest as ChestData).items).toHaveLength(INVENTORY.chestSlots)
		expect((chest as ChestData).items.every((slot) => slot === null)).toBe(true)

		const furnace = createFurnaceData()
		expect(furnace).toEqual({
			kind: BLOCK_ENTITY.Furnace,
			input: null,
			fuel: null,
			output: null,
			cookTicks: 0,
			fuelTicks: 0,
			fuelTicksTotal: 0,
		})

		expect(createBlockEntityData(BLOCK_ENTITY.CraftingTable)).toEqual({
			kind: BLOCK_ENTITY.CraftingTable,
		})
		expect(createBlockEntityData(BLOCK_ENTITY.Door)).toEqual({
			kind: BLOCK_ENTITY.Door,
			open: false,
			half: 0,
			facing: FACE.PosX,
			powered: false,
		})
		expect(createBlockEntityData(BLOCK_ENTITY.Bed)).toEqual({
			kind: BLOCK_ENTITY.Bed,
			head: false,
			facing: FACE.PosX,
		})
	})

	it('clones deeply so stored stacks are never aliased', () => {
		const original = createChestData([stack(COBBLE_ITEM, 3)])
		const copy = cloneBlockEntityData(original) as ChestData
		expect(copy).toEqual(original)
		expect(copy).not.toBe(original)
		const first = copy.items[0]
		expect(first).not.toBeNull()
		if (first !== null) first.count = 99
		expect(original.items[0]?.count).toBe(3)
	})

	it('round trips through the serialized form in index order', () => {
		const entities = new Map<number, BlockEntityData>([
			[512, createFurnaceData({ input: stack(COBBLE_ITEM, 2), cookTicks: 7, fuelTicks: 11, fuelTicksTotal: 1600 })],
			[4, createChestData([null, stack(ITEM.STICK, 12, 0)])],
			[65535, createDoorData({ half: 1, facing: FACE.NegZ, open: true, powered: true })],
			[300, createBlockEntityData(BLOCK_ENTITY.Bed)],
			[7, createBlockEntityData(BLOCK_ENTITY.CraftingTable)],
		])
		const serialized = serializeBlockEntities(entities)
		expect(serialized.map((entry) => entry.index)).toEqual([4, 7, 300, 512, 65535])

		const restored = deserializeBlockEntities(serialized)
		expect(restored.size).toBe(entities.size)
		for (const [index, data] of entities) expect(restored.get(index)).toEqual(data)

		// A second trip must be byte-for-byte identical.
		expect(serializeBlockEntities(restored)).toEqual(serialized)
	})

	it('round trips through JSON and rejects junk', () => {
		const door = createDoorData({ half: 1, facing: FACE.PosZ, open: true, powered: false })
		expect(blockEntityFromJson(blockEntityToJson(door))).toEqual(door)

		expect(isBlockEntityData({ kind: 'chest', items: [null] })).toBe(true)
		expect(isBlockEntityData({ kind: 'chest' })).toBe(false)
		expect(isBlockEntityData({ kind: 'door', open: true, half: 2, facing: 0, powered: false })).toBe(
			false,
		)
		expect(isBlockEntityData({ kind: 'hopper' })).toBe(false)
		expect(isBlockEntityData(null)).toBe(false)
		expect(() => blockEntityFromJson('{"kind":"hopper"}')).toThrow()

		const bad: SerializedBlockEntity[] = [{ index: -1, data: createChestData() }]
		expect(() => deserializeBlockEntities(bad)).toThrow()
	})
})

describe('chest storage', () => {
	it('merges into partial stacks before filling empty slots', () => {
		const chest = createChestData()
		expect(insertIntoChest(chest, stack(COBBLE_ITEM, 100))).toBeNull()
		expect(chest.items[0]).toEqual(stack(COBBLE_ITEM, 64))
		expect(chest.items[1]).toEqual(stack(COBBLE_ITEM, 36))

		expect(insertIntoChest(chest, stack(COBBLE_ITEM, 30))).toBeNull()
		expect(chest.items[1]).toEqual(stack(COBBLE_ITEM, 64))
		expect(chest.items[2]).toEqual(stack(COBBLE_ITEM, 2))
		expect(countItemInChest(chest, COBBLE_ITEM)).toBe(130)
	})

	it('keeps unstackable tools in separate slots', () => {
		const chest = createChestData()
		expect(insertIntoChest(chest, stack(ITEM.WOODEN_PICKAXE, 1))).toBeNull()
		expect(insertIntoChest(chest, stack(ITEM.WOODEN_PICKAXE, 1))).toBeNull()
		expect(chest.items[0]).toEqual(stack(ITEM.WOODEN_PICKAXE, 1))
		expect(chest.items[1]).toEqual(stack(ITEM.WOODEN_PICKAXE, 1))
	})

	it('never merges stacks with different damage', () => {
		const chest = createChestData()
		insertIntoChest(chest, stack(ITEM.DIAMOND_SWORD, 1, 0))
		insertIntoChest(chest, stack(ITEM.DIAMOND_SWORD, 1, 5))
		expect(chest.items[0]?.damage).toBe(0)
		expect(chest.items[1]?.damage).toBe(5)
	})

	it('returns the overflow when the chest is full', () => {
		const chest = createChestData()
		const capacity = INVENTORY.chestSlots * INVENTORY.defaultMaxStack
		expect(insertIntoChest(chest, stack(COBBLE_ITEM, capacity))).toBeNull()
		expect(insertIntoChest(chest, stack(COBBLE_ITEM, 10))).toEqual(stack(COBBLE_ITEM, 10))
	})

	it('takes partial and full stacks and drains on break', () => {
		const chest = createChestData([stack(COBBLE_ITEM, 20)])
		expect(takeFromChest(chest, 0, 5)).toEqual(stack(COBBLE_ITEM, 5))
		expect(chest.items[0]).toEqual(stack(COBBLE_ITEM, 15))
		expect(takeFromChest(chest, 0)).toEqual(stack(COBBLE_ITEM, 15))
		expect(chest.items[0]).toBeNull()
		expect(takeFromChest(chest, 0)).toBeNull()
		expect(() => takeFromChest(chest, INVENTORY.chestSlots)).toThrow()

		insertIntoChest(chest, stack(COBBLE_ITEM, 3))
		expect(drainChest(chest)).toEqual([stack(COBBLE_ITEM, 3)])
		expect(isChestEmpty(chest)).toBe(true)
	})
})

describe('doors', () => {
	it('places both halves with linked state', () => {
		const world = createMemoryWorld()
		expect(placeDoor(world, 2, 64, 3, FACE.PosZ)).toBe(true)
		expect(world.getBlock(2, 64, 3)).toBe(BLOCK.DOOR_LOWER)
		expect(world.getBlock(2, 65, 3)).toBe(BLOCK.DOOR_UPPER)
		expect(getDoorState(world, 2, 64, 3)?.half).toBe(0)
		expect(world.getBlockEntity(2, 65, 3)).toEqual(
			createDoorData({ half: 1, facing: FACE.PosZ }),
		)
		expect(placeDoor(world, 2, 64, 3)).toBe(false)
	})

	it('toggles both halves together', () => {
		const world = createMemoryWorld()
		placeDoor(world, 0, 64, 0)
		expect(isDoorOpen(world, 0, 64, 0)).toBe(false)
		expect(toggleDoor(world, 0, 65, 0)).toBe(true)
		expect(isDoorOpen(world, 0, 64, 0)).toBe(true)
		expect(world.getBlockEntity(0, 65, 0)).toMatchObject({ open: true, half: 1 })
		expect(toggleDoor(world, 0, 64, 0)).toBe(false)
		expect(isDoorOpen(world, 0, 65, 0)).toBe(false)
		expect(toggleDoor(world, 9, 9, 9)).toBeNull()
	})

	it('follows redstone power', () => {
		const world = createMemoryWorld()
		placeDoor(world, 5, 64, 5)
		expect(setDoorPowered(world, 5, 64, 5, true)).toBe(true)
		expect(isDoorOpen(world, 5, 64, 5)).toBe(true)
		expect(getDoorState(world, 5, 64, 5)?.powered).toBe(true)
		expect(setDoorPowered(world, 5, 65, 5, true)).toBe(false)
		expect(setDoorPowered(world, 5, 65, 5, false)).toBe(true)
		expect(isDoorOpen(world, 5, 64, 5)).toBe(false)
		expect(getDoorState(world, 5, 64, 5)?.powered).toBe(false)
		expect(setDoorPowered(world, 9, 9, 9, true)).toBe(false)
	})

	it('removes both halves when broken', () => {
		const world = createMemoryWorld()
		placeDoor(world, 1, 64, 1)
		expect(breakDoor(world, 1, 65, 1)).toBe(true)
		expect(world.getBlock(1, 64, 1)).toBe(BLOCK.AIR)
		expect(world.getBlock(1, 65, 1)).toBe(BLOCK.AIR)
		expect(world.blockEntityEntries()).toHaveLength(0)
		expect(breakDoor(world, 1, 64, 1)).toBe(false)
	})
})

describe('beds and respawn', () => {
	it('places a two block bed and finds its foot from either half', () => {
		const world = createMemoryWorld()
		expect(placeBed(world, 10, 64, 10, FACE.PosZ)).toBe(true)
		expect(world.getBlock(10, 64, 10)).toBe(BLOCK.BED_FOOT)
		expect(world.getBlock(10, 64, 11)).toBe(BLOCK.BED_HEAD)
		expect(findBedFoot(world, 10, 64, 11)).toEqual({ x: 10, y: 64, z: 10 })
		expect(findBedFoot(world, 10, 64, 10)).toEqual({ x: 10, y: 64, z: 10 })
		expect(findBedFoot(world, 0, 64, 0)).toBeNull()
	})

	it('refuses to place when the head space is blocked', () => {
		const world = createMemoryWorld()
		world.setBlock(0, 64, 1, BLOCK.STONE)
		expect(placeBed(world, 0, 64, 0, FACE.PosZ)).toBe(false)
		expect(placeBed(world, 0, 64, 0, FACE.PosY)).toBe(false)
		expect(world.getBlock(0, 64, 0)).toBe(BLOCK.AIR)
	})

	it('sets the respawn anchor when slept in', () => {
		const world = createMemoryWorld()
		const state: RespawnState = { respawn: null }
		placeBed(world, 3, 64, 3, FACE.PosX)
		expect(sleepInBed(world, state, 4, 64, 3)).toEqual({ x: 3, y: 64, z: 3 })
		expect(state.respawn).toEqual({ x: 3, y: 64, z: 3 })
		expect(isRespawnValid(world, state)).toBe(true)
		expect(respawnPositionFor(world, state)).toEqual({ x: 3, y: 65, z: 3 })
		expect(sleepInBed(world, state, 20, 64, 20)).toBeNull()
	})

	it('falls back to a free neighbour when the bed is covered', () => {
		const world = createMemoryWorld()
		const state: RespawnState = { respawn: null }
		placeBed(world, 0, 64, 0, FACE.PosX)
		sleepInBed(world, state, 0, 64, 0)
		world.setBlock(0, 65, 0, BLOCK.STONE)
		expect(respawnPositionFor(world, state)).toEqual({ x: -1, y: 64, z: 0 })
	})

	it('clears the anchor once the bed is gone', () => {
		const world = createMemoryWorld()
		const state: RespawnState = { respawn: null }
		placeBed(world, 7, 64, 7, FACE.NegX)
		sleepInBed(world, state, 7, 64, 7)
		expect(breakBed(world, 6, 64, 7)).toBe(true)
		expect(world.getBlock(7, 64, 7)).toBe(BLOCK.AIR)
		expect(world.getBlock(6, 64, 7)).toBe(BLOCK.AIR)
		expect(world.blockEntityEntries()).toHaveLength(0)
		expect(clearRespawnIfBedGone(world, state)).toBe(true)
		expect(state.respawn).toBeNull()
		expect(clearRespawnIfBedGone(world, state)).toBe(false)
		expect(respawnPositionFor(world, state)).toBeNull()
	})
})

describe('memory world block entity lifecycle', () => {
	it('creates and clears payloads as blocks change', () => {
		const world = createMemoryWorld()
		world.setBlock(0, 64, 0, BLOCK.CHEST)
		const chest = world.getBlockEntity(0, 64, 0)
		expect(chest?.kind).toBe(BLOCK_ENTITY.Chest)

		// Re-placing the same block keeps the existing contents.
		if (chest?.kind === BLOCK_ENTITY.Chest) insertIntoChest(chest, stack(COBBLE_ITEM, 1))
		world.setBlock(0, 64, 0, BLOCK.CHEST)
		expect(countItemInChest(world.getBlockEntity(0, 64, 0) as ChestData, COBBLE_ITEM)).toBe(1)

		world.setBlock(0, 64, 0, BLOCK.FURNACE)
		expect(world.getBlockEntity(0, 64, 0)?.kind).toBe(BLOCK_ENTITY.Furnace)

		world.setBlock(0, 64, 0, BLOCK.AIR)
		expect(world.getBlockEntity(0, 64, 0)).toBeUndefined()
		expect(world.blockEntityEntries()).toHaveLength(0)
	})

	it('reports solidity and fluids from the registry', () => {
		const world = createMemoryWorld()
		expect(world.isSolid(0, 0, 0)).toBe(false)
		expect(world.isLoaded(0, 0)).toBe(true)
		world.setBlock(0, 0, 0, BLOCK.STONE)
		expect(world.isSolid(0, 0, 0)).toBe(true)
		world.setBlock(1, 0, 0, BLOCK.WATER)
		expect(world.isLiquid(1, 0, 0)).toBe(true)
		expect(world.isLiquid(0, 0, 0)).toBe(false)
	})
})
