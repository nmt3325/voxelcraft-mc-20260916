import {
	BLOCK_ENTITY,
	FACE,
	INVENTORY,
	type BedData,
	type BlockEntityData,
	type BlockEntityKind,
	type ChestData,
	type CraftingTableData,
	type DoorData,
	type FurnaceData,
	type ItemStack,
	type SerializedBlockEntity,
} from '@voxelcraft/core-types'

/**
 * Block entity payloads: construction, deep copies, validation and the
 * `SerializedBlockEntity` round trip used by the chunk codec.
 *
 * Everything here is data-only, so the persistence layer can serialize block
 * entities without pulling in world or inventory logic.
 */
export function cloneStack(stack: ItemStack | null): ItemStack | null {
	return stack === null ? null : { item: stack.item, count: stack.count, damage: stack.damage }
}

export function createChestData(items?: readonly (ItemStack | null)[]): ChestData {
	const slots: (ItemStack | null)[] = new Array<ItemStack | null>(INVENTORY.chestSlots).fill(null)
	if (items !== undefined) {
		const copied = Math.min(items.length, slots.length)
		for (let i = 0; i < copied; i++) slots[i] = cloneStack(items[i])
	}
	return { kind: BLOCK_ENTITY.Chest, items: slots }
}

export function createFurnaceData(init: Partial<Omit<FurnaceData, 'kind'>> = {}): FurnaceData {
	return {
		kind: BLOCK_ENTITY.Furnace,
		input: cloneStack(init.input ?? null),
		fuel: cloneStack(init.fuel ?? null),
		output: cloneStack(init.output ?? null),
		cookTicks: init.cookTicks ?? 0,
		fuelTicks: init.fuelTicks ?? 0,
		fuelTicksTotal: init.fuelTicksTotal ?? 0,
	}
}

export function createCraftingTableData(): CraftingTableData {
	return { kind: BLOCK_ENTITY.CraftingTable }
}

export function createDoorData(
	init: { half?: 0 | 1; facing?: number; open?: boolean; powered?: boolean } = {},
): DoorData {
	return {
		kind: BLOCK_ENTITY.Door,
		open: init.open ?? false,
		half: init.half ?? 0,
		facing: init.facing ?? FACE.PosX,
		powered: init.powered ?? false,
	}
}

export function createBedData(init: { head?: boolean; facing?: number } = {}): BedData {
	return {
		kind: BLOCK_ENTITY.Bed,
		head: init.head ?? false,
		facing: init.facing ?? FACE.PosX,
	}
}

/** Default payload for a freshly placed block entity of `kind`. */
export function createBlockEntityData(kind: BlockEntityKind): BlockEntityData {
	switch (kind) {
		case BLOCK_ENTITY.Chest:
			return createChestData()
		case BLOCK_ENTITY.Furnace:
			return createFurnaceData()
		case BLOCK_ENTITY.CraftingTable:
			return createCraftingTableData()
		case BLOCK_ENTITY.Door:
			return createDoorData()
		case BLOCK_ENTITY.Bed:
			return createBedData()
		default: {
			const exhaustive: never = kind
			throw new Error(`unknown block entity kind: ${String(exhaustive)}`)
		}
	}
}

export function cloneBlockEntityData(data: BlockEntityData): BlockEntityData {
	switch (data.kind) {
		case BLOCK_ENTITY.Chest:
			return createChestData(data.items)
		case BLOCK_ENTITY.Furnace:
			return createFurnaceData(data)
		case BLOCK_ENTITY.CraftingTable:
			return createCraftingTableData()
		case BLOCK_ENTITY.Door:
			return createDoorData(data)
		case BLOCK_ENTITY.Bed:
			return createBedData(data)
		default: {
			const exhaustive: never = data
			throw new Error(`unknown block entity data: ${JSON.stringify(exhaustive)}`)
		}
	}
}

function isStackOrNull(value: unknown): value is ItemStack | null {
	if (value === null) return true
	if (typeof value !== 'object') return false
	const stack = value as Record<string, unknown>
	return (
		typeof stack.item === 'number' &&
		typeof stack.count === 'number' &&
		typeof stack.damage === 'number'
	)
}

/** Structural check used before trusting decoded/persisted payloads. */
export function isBlockEntityData(value: unknown): value is BlockEntityData {
	if (value === null || typeof value !== 'object') return false
	const data = value as Record<string, unknown>
	switch (data.kind) {
		case BLOCK_ENTITY.Chest:
			return Array.isArray(data.items) && (data.items as unknown[]).every(isStackOrNull)
		case BLOCK_ENTITY.Furnace:
			return (
				isStackOrNull(data.input) &&
				isStackOrNull(data.fuel) &&
				isStackOrNull(data.output) &&
				typeof data.cookTicks === 'number' &&
				typeof data.fuelTicks === 'number' &&
				typeof data.fuelTicksTotal === 'number'
			)
		case BLOCK_ENTITY.CraftingTable:
			return true
		case BLOCK_ENTITY.Door:
			return (
				typeof data.open === 'boolean' &&
				(data.half === 0 || data.half === 1) &&
				typeof data.facing === 'number' &&
				typeof data.powered === 'boolean'
			)
		case BLOCK_ENTITY.Bed:
			return typeof data.head === 'boolean' && typeof data.facing === 'number'
		default:
			return false
	}
}

/** Chunk-local block entities as a deterministic, index-ordered list. */
export function serializeBlockEntities(
	entities: ReadonlyMap<number, BlockEntityData>,
): SerializedBlockEntity[] {
	const out: SerializedBlockEntity[] = []
	for (const [index, data] of entities) out.push({ index, data: cloneBlockEntityData(data) })
	out.sort((a, b) => a.index - b.index)
	return out
}

export function deserializeBlockEntities(
	entries: readonly SerializedBlockEntity[],
): Map<number, BlockEntityData> {
	const out = new Map<number, BlockEntityData>()
	for (const entry of entries) {
		if (!Number.isInteger(entry.index) || entry.index < 0) {
			throw new RangeError(`invalid block entity index: ${String(entry.index)}`)
		}
		if (!isBlockEntityData(entry.data)) {
			throw new Error(`invalid block entity data at index ${entry.index}`)
		}
		out.set(entry.index, cloneBlockEntityData(entry.data))
	}
	return out
}

/** JSON encoding used by the chunk codec's block entity section. */
export function blockEntityToJson(data: BlockEntityData): string {
	return JSON.stringify(data)
}

export function blockEntityFromJson(json: string): BlockEntityData {
	const parsed: unknown = JSON.parse(json)
	if (!isBlockEntityData(parsed)) throw new Error('invalid block entity JSON')
	return cloneBlockEntityData(parsed)
}
