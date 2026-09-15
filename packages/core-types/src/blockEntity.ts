import type { ItemStack } from './items'

export const BLOCK_ENTITY = {
	Chest: 'chest',
	Furnace: 'furnace',
	CraftingTable: 'craftingTable',
	Door: 'door',
	Bed: 'bed',
} as const
export type BlockEntityKind = (typeof BLOCK_ENTITY)[keyof typeof BLOCK_ENTITY]

export interface ChestData {
	kind: 'chest'
	items: (ItemStack | null)[]
}

export interface FurnaceData {
	kind: 'furnace'
	input: ItemStack | null
	fuel: ItemStack | null
	output: ItemStack | null
	cookTicks: number
	fuelTicks: number
	fuelTicksTotal: number
}

export interface CraftingTableData {
	kind: 'craftingTable'
}

export interface DoorData {
	kind: 'door'
	open: boolean
	/** 0 = lower half, 1 = upper half. */
	half: 0 | 1
	facing: number
	powered: boolean
}

export interface BedData {
	kind: 'bed'
	head: boolean
	facing: number
}

export type BlockEntityData =
	| ChestData
	| FurnaceData
	| CraftingTableData
	| DoorData
	| BedData

export interface SerializedBlockEntity {
	/** Voxel index inside the chunk (see chunk.ts blockIndex). */
	index: number
	data: BlockEntityData
}
