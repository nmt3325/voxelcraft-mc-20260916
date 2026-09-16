import {
	BLOCK,
	BLOCK_ENTITY,
	FLUID,
	ITEM,
	RENDER_LAYER,
	REDSTONE_ROLE,
	SOUND_GROUP,
	TOOL_CLASS,
	TOOL_TIER,
	type BlockDef,
	type BlockDrop,
	type BlockKeyName,
	type ItemId,
	type ToolTier,
} from '@voxelcraft/core-types'

/**
 * Block definition table for VoxelCraft v1.
 *
 * Every id in `BLOCK` gets exactly one `BlockDef`. The override table below is
 * typed as `Record<BlockKeyName, ...>`, so adding an id to the shared contract
 * breaks this file at compile time instead of silently shipping a hole.
 */
export type BlockDefOverrides = Partial<Omit<BlockDef, 'id' | 'name'>>

/** 'grass_block' -> 'Grass Block'. */
export function displayNameOf(registryName: string): string {
	return registryName
		.split('_')
		.filter((part) => part.length > 0)
		.map((part) => part[0].toUpperCase() + part.slice(1))
		.join(' ')
}

export function drop(
	item: ItemId,
	min = 1,
	max = min,
	chance = 1,
	requiresTier: ToolTier = TOOL_TIER.None,
): BlockDrop {
	return { item, min, max, chance, requiresTier }
}

/** Small non-colliding plants: no collider, no light blocking, break instantly. */
const PLANT: BlockDefOverrides = {
	layer: RENDER_LAYER.Cutout,
	solid: false,
	fullCube: false,
	replaceable: true,
	opacity: 0,
	skyPassThrough: true,
	hardness: 0,
	flammable: true,
	soundGroup: SOUND_GROUP.Plant,
}

const LEAVES: BlockDefOverrides = {
	layer: RENDER_LAYER.Cutout,
	fullCube: false,
	opacity: 1,
	skyFilter: 1,
	hardness: 0.2,
	toolClass: TOOL_CLASS.Shears,
	flammable: true,
	soundGroup: SOUND_GROUP.Plant,
	drops: [drop(BLOCK.OAK_SAPLING, 1, 1, 0.05)],
}

const LOG: BlockDefOverrides = {
	hardness: 2,
	toolClass: TOOL_CLASS.Axe,
	flammable: true,
	soundGroup: SOUND_GROUP.Wood,
}

/** Water/lava, both source and flowing. */
const LIQUID: BlockDefOverrides = {
	solid: false,
	fullCube: false,
	replaceable: true,
	opacity: 0,
	hardness: -1,
	soundGroup: SOUND_GROUP.Liquid,
	itemId: 0,
	drops: [],
}

/** Levers, buttons, plates: attachments with no collider. */
const ATTACHMENT: BlockDefOverrides = {
	layer: RENDER_LAYER.Cutout,
	solid: false,
	fullCube: false,
	opacity: 0,
	skyPassThrough: true,
	hardness: 0.5,
	soundGroup: SOUND_GROUP.Wood,
}

const OVERRIDES: Record<BlockKeyName, BlockDefOverrides> = {
	AIR: {
		solid: false,
		fullCube: false,
		replaceable: true,
		opacity: 0,
		skyPassThrough: true,
		hardness: 0,
		textures: {},
		itemId: 0,
		drops: [],
	},
	STONE: {
		hardness: 1.5,
		toolClass: TOOL_CLASS.Pickaxe,
		minTier: TOOL_TIER.Wood,
		drops: [drop(BLOCK.COBBLESTONE, 1, 1, 1, TOOL_TIER.Wood)],
	},
	COBBLESTONE: { hardness: 2, toolClass: TOOL_CLASS.Pickaxe, minTier: TOOL_TIER.Wood },
	DIRT: { hardness: 0.5, toolClass: TOOL_CLASS.Shovel, soundGroup: SOUND_GROUP.Dirt },
	GRASS_BLOCK: {
		hardness: 0.6,
		toolClass: TOOL_CLASS.Shovel,
		soundGroup: SOUND_GROUP.Grass,
		textures: { top: 'grass_block_top', side: 'grass_block_side', bottom: 'dirt' },
		drops: [drop(BLOCK.DIRT)],
	},
	SAND: {
		hardness: 0.5,
		toolClass: TOOL_CLASS.Shovel,
		gravity: true,
		soundGroup: SOUND_GROUP.Sand,
	},
	SANDSTONE: {
		hardness: 0.8,
		toolClass: TOOL_CLASS.Pickaxe,
		minTier: TOOL_TIER.Wood,
		textures: { top: 'sandstone_top', side: 'sandstone', bottom: 'sandstone_bottom' },
	},
	GRAVEL: {
		hardness: 0.6,
		toolClass: TOOL_CLASS.Shovel,
		gravity: true,
		soundGroup: SOUND_GROUP.Dirt,
	},
	SNOW_BLOCK: { hardness: 0.2, toolClass: TOOL_CLASS.Shovel, soundGroup: SOUND_GROUP.Snow },
	ICE: {
		layer: RENDER_LAYER.Translucent,
		opacity: 3,
		hardness: 0.5,
		toolClass: TOOL_CLASS.Pickaxe,
		soundGroup: SOUND_GROUP.Glass,
		drops: [],
	},
	WATER: {
		...LIQUID,
		layer: RENDER_LAYER.Translucent,
		fluid: FLUID.Water,
		opacity: 1,
		skyFilter: 1,
	},
	LAVA: { ...LIQUID, fluid: FLUID.Lava, emission: 15 },
	BEDROCK: { hardness: -1, toolClass: TOOL_CLASS.Pickaxe, drops: [] },
	CLAY: {
		hardness: 0.6,
		toolClass: TOOL_CLASS.Shovel,
		soundGroup: SOUND_GROUP.Dirt,
		drops: [drop(ITEM.CLAY_BALL, 4, 4)],
	},
	OAK_LOG: { ...LOG, textures: { top: 'oak_log_top', side: 'oak_log' } },
	OAK_LEAVES: { ...LEAVES },
	BIRCH_LOG: { ...LOG, textures: { top: 'birch_log_top', side: 'birch_log' } },
	BIRCH_LEAVES: { ...LEAVES },
	SPRUCE_LOG: { ...LOG, textures: { top: 'spruce_log_top', side: 'spruce_log' } },
	SPRUCE_LEAVES: { ...LEAVES },
	CACTUS: {
		layer: RENDER_LAYER.Cutout,
		fullCube: false,
		opacity: 0,
		hardness: 0.4,
		soundGroup: SOUND_GROUP.Plant,
		textures: { top: 'cactus_top', side: 'cactus_side' },
	},
	TALL_GRASS: { ...PLANT, toolClass: TOOL_CLASS.Shears, drops: [] },
	DEAD_BUSH: { ...PLANT, drops: [drop(ITEM.STICK, 1, 2, 0.5)] },
	FLOWER_RED: { ...PLANT },
	FLOWER_YELLOW: { ...PLANT },
	OAK_SAPLING: { ...PLANT },
	COAL_ORE: {
		hardness: 3,
		toolClass: TOOL_CLASS.Pickaxe,
		minTier: TOOL_TIER.Wood,
		drops: [drop(ITEM.COAL, 1, 1, 1, TOOL_TIER.Wood)],
	},
	IRON_ORE: { hardness: 3, toolClass: TOOL_CLASS.Pickaxe, minTier: TOOL_TIER.Stone },
	GOLD_ORE: { hardness: 3, toolClass: TOOL_CLASS.Pickaxe, minTier: TOOL_TIER.Iron },
	DIAMOND_ORE: {
		hardness: 3,
		toolClass: TOOL_CLASS.Pickaxe,
		minTier: TOOL_TIER.Iron,
		drops: [drop(ITEM.DIAMOND, 1, 1, 1, TOOL_TIER.Iron)],
	},
	REDSTONE_ORE: {
		hardness: 3,
		toolClass: TOOL_CLASS.Pickaxe,
		minTier: TOOL_TIER.Iron,
		drops: [drop(ITEM.REDSTONE_DUST, 4, 5, 1, TOOL_TIER.Iron)],
	},
	LAPIS_ORE: {
		hardness: 3,
		toolClass: TOOL_CLASS.Pickaxe,
		minTier: TOOL_TIER.Stone,
		drops: [drop(ITEM.LAPIS, 4, 8, 1, TOOL_TIER.Stone)],
	},
	PLANKS: {
		hardness: 2,
		toolClass: TOOL_CLASS.Axe,
		flammable: true,
		soundGroup: SOUND_GROUP.Wood,
	},
	GLASS: {
		layer: RENDER_LAYER.Cutout,
		opacity: 0,
		hardness: 0.3,
		soundGroup: SOUND_GROUP.Glass,
		drops: [],
	},
	CRAFTING_TABLE: {
		hardness: 2.5,
		toolClass: TOOL_CLASS.Axe,
		flammable: true,
		soundGroup: SOUND_GROUP.Wood,
		blockEntity: BLOCK_ENTITY.CraftingTable,
		textures: { top: 'crafting_table_top', side: 'crafting_table_side', bottom: 'planks' },
	},
	FURNACE: {
		hardness: 3.5,
		toolClass: TOOL_CLASS.Pickaxe,
		minTier: TOOL_TIER.Wood,
		blockEntity: BLOCK_ENTITY.Furnace,
		textures: { top: 'furnace_top', side: 'furnace_side', bottom: 'furnace_top' },
	},
	FURNACE_LIT: {
		hardness: 3.5,
		toolClass: TOOL_CLASS.Pickaxe,
		minTier: TOOL_TIER.Wood,
		emission: 13,
		blockEntity: BLOCK_ENTITY.Furnace,
		textures: { top: 'furnace_top', side: 'furnace_front_lit', bottom: 'furnace_top' },
		itemId: BLOCK.FURNACE,
		drops: [drop(BLOCK.FURNACE, 1, 1, 1, TOOL_TIER.Wood)],
	},
	CHEST: {
		fullCube: false,
		opacity: 0,
		hardness: 2.5,
		toolClass: TOOL_CLASS.Axe,
		flammable: true,
		soundGroup: SOUND_GROUP.Wood,
		blockEntity: BLOCK_ENTITY.Chest,
	},
	TORCH: {
		layer: RENDER_LAYER.Cutout,
		solid: false,
		fullCube: false,
		opacity: 0,
		skyPassThrough: true,
		emission: 14,
		hardness: 0,
		redstone: REDSTONE_ROLE.Torch,
		soundGroup: SOUND_GROUP.Wood,
	},
	GLOWSTONE: {
		emission: 15,
		hardness: 0.3,
		toolClass: TOOL_CLASS.Pickaxe,
		soundGroup: SOUND_GROUP.Glass,
	},
	DOOR_LOWER: {
		layer: RENDER_LAYER.Cutout,
		fullCube: false,
		opacity: 0,
		hardness: 3,
		toolClass: TOOL_CLASS.Axe,
		flammable: true,
		soundGroup: SOUND_GROUP.Wood,
		blockEntity: BLOCK_ENTITY.Door,
		redstone: REDSTONE_ROLE.Door,
		textures: { all: 'door_lower' },
	},
	DOOR_UPPER: {
		layer: RENDER_LAYER.Cutout,
		fullCube: false,
		opacity: 0,
		hardness: 3,
		toolClass: TOOL_CLASS.Axe,
		flammable: true,
		soundGroup: SOUND_GROUP.Wood,
		blockEntity: BLOCK_ENTITY.Door,
		redstone: REDSTONE_ROLE.Door,
		textures: { all: 'door_upper' },
		itemId: BLOCK.DOOR_LOWER,
		drops: [],
	},
	BED_FOOT: {
		fullCube: false,
		opacity: 0,
		hardness: 0.2,
		soundGroup: SOUND_GROUP.Wool,
		flammable: true,
		blockEntity: BLOCK_ENTITY.Bed,
		textures: { top: 'bed_foot_top', side: 'bed_foot_side', bottom: 'planks' },
	},
	BED_HEAD: {
		fullCube: false,
		opacity: 0,
		hardness: 0.2,
		soundGroup: SOUND_GROUP.Wool,
		flammable: true,
		blockEntity: BLOCK_ENTITY.Bed,
		textures: { top: 'bed_head_top', side: 'bed_head_side', bottom: 'planks' },
		itemId: BLOCK.BED_FOOT,
		drops: [],
	},
	REDSTONE_WIRE: {
		layer: RENDER_LAYER.Cutout,
		solid: false,
		fullCube: false,
		opacity: 0,
		skyPassThrough: true,
		hardness: 0,
		redstone: REDSTONE_ROLE.Wire,
		soundGroup: SOUND_GROUP.Stone,
		itemId: ITEM.REDSTONE_DUST,
		drops: [drop(ITEM.REDSTONE_DUST)],
	},
	LEVER: { ...ATTACHMENT, redstone: REDSTONE_ROLE.Lever },
	BUTTON: { ...ATTACHMENT, redstone: REDSTONE_ROLE.Button },
	PRESSURE_PLATE: { ...ATTACHMENT, redstone: REDSTONE_ROLE.PressurePlate },
	REDSTONE_LAMP: {
		hardness: 0.3,
		redstone: REDSTONE_ROLE.Lamp,
		soundGroup: SOUND_GROUP.Glass,
	},
	REDSTONE_LAMP_LIT: {
		emission: 15,
		hardness: 0.3,
		redstone: REDSTONE_ROLE.Lamp,
		soundGroup: SOUND_GROUP.Glass,
		itemId: BLOCK.REDSTONE_LAMP,
		drops: [drop(BLOCK.REDSTONE_LAMP)],
	},
	PISTON: {
		hardness: 1.5,
		redstone: REDSTONE_ROLE.Piston,
		textures: { top: 'piston_top', side: 'piston_side', bottom: 'piston_bottom' },
	},
	PISTON_HEAD: {
		fullCube: false,
		opacity: 0,
		hardness: 1.5,
		redstone: REDSTONE_ROLE.Piston,
		itemId: 0,
		drops: [],
	},
	STONE_BRICKS: { hardness: 1.5, toolClass: TOOL_CLASS.Pickaxe, minTier: TOOL_TIER.Wood },
	BRICKS: { hardness: 2, toolClass: TOOL_CLASS.Pickaxe, minTier: TOOL_TIER.Wood },
	OBSIDIAN: {
		hardness: 50,
		toolClass: TOOL_CLASS.Pickaxe,
		minTier: TOOL_TIER.Diamond,
	},
	SNOW_LAYER: {
		solid: false,
		fullCube: false,
		replaceable: true,
		opacity: 0,
		hardness: 0.1,
		toolClass: TOOL_CLASS.Shovel,
		soundGroup: SOUND_GROUP.Snow,
	},
	IRON_BLOCK: {
		hardness: 5,
		toolClass: TOOL_CLASS.Pickaxe,
		minTier: TOOL_TIER.Stone,
		soundGroup: SOUND_GROUP.Metal,
	},
	GOLD_BLOCK: {
		hardness: 3,
		toolClass: TOOL_CLASS.Pickaxe,
		minTier: TOOL_TIER.Iron,
		soundGroup: SOUND_GROUP.Metal,
	},
	DIAMOND_BLOCK: {
		hardness: 5,
		toolClass: TOOL_CLASS.Pickaxe,
		minTier: TOOL_TIER.Iron,
		soundGroup: SOUND_GROUP.Metal,
	},
	COAL_BLOCK: { hardness: 5, toolClass: TOOL_CLASS.Pickaxe, minTier: TOOL_TIER.Wood },
	WOOL: {
		hardness: 0.8,
		toolClass: TOOL_CLASS.Shears,
		flammable: true,
		soundGroup: SOUND_GROUP.Wool,
	},
	LADDER: {
		layer: RENDER_LAYER.Cutout,
		solid: false,
		fullCube: false,
		opacity: 0,
		skyPassThrough: true,
		hardness: 0.4,
		toolClass: TOOL_CLASS.Axe,
		flammable: true,
		soundGroup: SOUND_GROUP.Wood,
	},
	WATER_FLOWING: {
		...LIQUID,
		layer: RENDER_LAYER.Translucent,
		fluid: FLUID.Water,
		opacity: 1,
		skyFilter: 1,
	},
	LAVA_FLOWING: { ...LIQUID, fluid: FLUID.Lava, emission: 15 },
}

function defaultDrops(def: BlockDef): readonly BlockDrop[] {
	if (def.id === BLOCK.AIR) return []
	if (def.itemId === 0) return []
	if (def.hardness < 0) return []
	if (def.fluid !== FLUID.None) return []
	return [drop(def.itemId, 1, 1, 1, def.minTier)]
}

function buildBlockDefs(): readonly BlockDef[] {
	const defs: BlockDef[] = []
	for (const key of Object.keys(BLOCK) as BlockKeyName[]) {
		const id = BLOCK[key]
		const name = key.toLowerCase()
		const overrides = OVERRIDES[key]
		const base: BlockDef = {
			id,
			name,
			displayName: displayNameOf(name),
			layer: RENDER_LAYER.Opaque,
			solid: true,
			fullCube: true,
			replaceable: false,
			opacity: 15,
			emission: 0,
			skyPassThrough: false,
			skyFilter: 0,
			hardness: 1,
			toolClass: TOOL_CLASS.None,
			minTier: TOOL_TIER.None,
			textures: { all: name },
			drops: [],
			fluid: FLUID.None,
			blockEntity: null,
			gravity: false,
			flammable: false,
			redstone: null,
			soundGroup: SOUND_GROUP.Stone,
			itemId: id,
		}
		const merged: BlockDef = { ...base, ...overrides, id, name }
		if (overrides.drops === undefined) merged.drops = defaultDrops(merged)
		defs.push(merged)
	}
	defs.sort((a, b) => a.id - b.id)
	return Object.freeze(defs)
}

/** Every block of the frozen v1 contract, ascending by id. */
export const BLOCK_DEFS: readonly BlockDef[] = buildBlockDefs()
export const BLOCK_DEF_COUNT = BLOCK_DEFS.length
