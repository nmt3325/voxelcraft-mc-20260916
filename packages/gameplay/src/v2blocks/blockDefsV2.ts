import {
	BLOCK,
	BLOCK_V2,
	BLOCK_V2_BASE,
	BLOCK_V2_MAX,
	FLUID,
	ITEM_V2,
	PORTAL,
	RENDER_LAYER,
	SOUND_GROUP,
	TOOL_CLASS,
	TOOL_TIER,
	type BlockDef,
	type BlockDrop,
	type BlockV2KeyName,
} from '@voxelcraft/core-types'
import { BLOCK_DEFS, displayNameOf, drop, type BlockDefOverrides } from '../blocks/blockDefs'

/**
 * Block definition table for the additive v2 ids (`BLOCK_V2` 64..81).
 *
 * World generation already emits these ids (villages, the nether) and the
 * gameplay systems already name them (farmland, crops, the enchanting table),
 * so the shipped registry has to define them: an undefined id makes
 * `BLOCKS.tryById()` return undefined, which means the block can never be
 * broken or placed and measures exactly like air for lighting and fluids.
 *
 * The override table is typed `Record<BlockV2KeyName, ...>`, so a new contract
 * id breaks this file at compile time instead of silently shipping a hole.
 * Optical values (render layer, opacity, emission) match the client appearance
 * table and `packages/sim`'s block property table, so the mesher, the light
 * engine and the block registry agree on every id.
 */

/** Magma blocks glow faintly; the same value the client appearance table uses. */
export const MAGMA_EMISSION = 3

/** Crops: cross geometry, no collider, no light blocking, break instantly. */
const CROP: BlockDefOverrides = {
	layer: RENDER_LAYER.Cutout,
	solid: false,
	fullCube: false,
	replaceable: true,
	opacity: 0,
	skyPassThrough: true,
	hardness: 0,
	flammable: true,
	soundGroup: SOUND_GROUP.Plant,
	// A crop's item form is its seed, so the block itself has none.
	itemId: 0,
}

/** Walls, fences and gates: a collider that light still passes through. */
const THIN: BlockDefOverrides = {
	layer: RENDER_LAYER.Cutout,
	fullCube: false,
	opacity: 0,
}

const BLOCK_V2_OVERRIDES: Record<BlockV2KeyName, BlockDefOverrides> = {
	NETHERRACK: {
		hardness: 0.4,
		toolClass: TOOL_CLASS.Pickaxe,
		minTier: TOOL_TIER.Wood,
	},
	NETHER_PORTAL: {
		layer: RENDER_LAYER.Translucent,
		solid: false,
		fullCube: false,
		replaceable: true,
		opacity: 0,
		skyPassThrough: true,
		emission: PORTAL.lightLevel,
		hardness: -1,
		soundGroup: SOUND_GROUP.Glass,
		itemId: 0,
		drops: [],
	},
	SOUL_SAND: {
		hardness: 0.5,
		toolClass: TOOL_CLASS.Shovel,
		soundGroup: SOUND_GROUP.Sand,
	},
	QUARTZ_ORE: {
		hardness: 3,
		toolClass: TOOL_CLASS.Pickaxe,
		minTier: TOOL_TIER.Wood,
		drops: [drop(ITEM_V2.NETHER_QUARTZ, 1, 1, 1, TOOL_TIER.Wood)],
	},
	NETHER_BRICKS: {
		hardness: 2,
		toolClass: TOOL_CLASS.Pickaxe,
		minTier: TOOL_TIER.Wood,
	},
	MAGMA_BLOCK: {
		hardness: 0.5,
		toolClass: TOOL_CLASS.Pickaxe,
		minTier: TOOL_TIER.Wood,
		emission: MAGMA_EMISSION,
	},
	FARMLAND: {
		hardness: 0.6,
		toolClass: TOOL_CLASS.Shovel,
		soundGroup: SOUND_GROUP.Dirt,
		textures: { top: 'farmland_dry_top', side: 'farmland_side', bottom: 'farmland_bottom' },
		drops: [drop(BLOCK.DIRT)],
	},
	FARMLAND_WET: {
		hardness: 0.6,
		toolClass: TOOL_CLASS.Shovel,
		soundGroup: SOUND_GROUP.Dirt,
		textures: { top: 'farmland_wet_top', side: 'farmland_side', bottom: 'farmland_bottom' },
		// Hydration is a second block id, not a state bit, so both variants share
		// the dry farmland item, the way FURNACE_LIT shares the furnace item.
		itemId: BLOCK_V2.FARMLAND,
		drops: [drop(BLOCK.DIRT)],
	},
	WHEAT_CROP: {
		...CROP,
		textures: { all: 'wheat_stage_7' },
		drops: [drop(ITEM_V2.WHEAT_SEEDS)],
	},
	CARROT_CROP: {
		...CROP,
		textures: { all: 'carrot_stage_7' },
		drops: [drop(ITEM_V2.CARROT)],
	},
	POTATO_CROP: {
		...CROP,
		textures: { all: 'potato_stage_7' },
		drops: [drop(ITEM_V2.POTATO)],
	},
	ENCHANTING_TABLE: {
		hardness: 5,
		toolClass: TOOL_CLASS.Pickaxe,
		minTier: TOOL_TIER.Wood,
		textures: {
			top: 'enchanting_table_top',
			side: 'enchanting_table_side',
			bottom: 'enchanting_table_bottom',
		},
	},
	BOOKSHELF: {
		hardness: 1.5,
		toolClass: TOOL_CLASS.Axe,
		flammable: true,
		soundGroup: SOUND_GROUP.Wood,
	},
	GRAVEL_PATH: {
		hardness: 0.6,
		toolClass: TOOL_CLASS.Shovel,
		soundGroup: SOUND_GROUP.Dirt,
		textures: { top: 'gravel_path', side: 'gravel_path', bottom: 'dirt' },
	},
	COBBLESTONE_WALL: {
		...THIN,
		hardness: 2,
		toolClass: TOOL_CLASS.Pickaxe,
		minTier: TOOL_TIER.Wood,
	},
	HAY_BLOCK: {
		hardness: 0.5,
		flammable: true,
		soundGroup: SOUND_GROUP.Plant,
		textures: { top: 'hay_block_top', side: 'hay_block_side', bottom: 'hay_block_bottom' },
	},
	FENCE: {
		...THIN,
		hardness: 2,
		toolClass: TOOL_CLASS.Axe,
		flammable: true,
		soundGroup: SOUND_GROUP.Wood,
	},
	FENCE_GATE: {
		...THIN,
		hardness: 2,
		toolClass: TOOL_CLASS.Axe,
		flammable: true,
		soundGroup: SOUND_GROUP.Wood,
	},
}

/** The v1 rule: one of yourself, gated by the tier that can harvest you. */
function defaultDrops(def: BlockDef): readonly BlockDrop[] {
	if (def.itemId === 0) return []
	if (def.hardness < 0) return []
	if (def.fluid !== FLUID.None) return []
	return [drop(def.itemId, 1, 1, 1, def.minTier)]
}

function buildBlockV2Defs(): readonly BlockDef[] {
	const v1Names = new Set(BLOCK_DEFS.map((def) => def.name))
	const defs: BlockDef[] = []
	const seen = new Set<number>()

	for (const key of Object.keys(BLOCK_V2) as BlockV2KeyName[]) {
		const id: number = BLOCK_V2[key]
		if (id < BLOCK_V2_BASE || id > BLOCK_V2_MAX) {
			throw new RangeError(
				`v2 block '${key}' id ${String(id)} is outside ${String(BLOCK_V2_BASE)}..${String(BLOCK_V2_MAX)}`,
			)
		}
		const name = key.toLowerCase()
		if (v1Names.has(name)) throw new Error(`v2 block '${key}' reuses the v1 name '${name}'`)
		const overrides = BLOCK_V2_OVERRIDES[key]
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
		if (seen.has(id)) throw new Error(`duplicate v2 block id ${String(id)} (${name})`)
		seen.add(id)
		defs.push(merged)
	}

	defs.sort((a, b) => a.id - b.id)
	return Object.freeze(defs)
}

/** Every additive v2 block, ascending by id. */
export const BLOCK_V2_DEFS: readonly BlockDef[] = buildBlockV2Defs()
export const BLOCK_V2_DEF_COUNT = BLOCK_V2_DEFS.length

/** v1 plus v2: exactly what the shipped `BLOCKS` registry defines. */
export const ALL_BLOCK_DEFS: readonly BlockDef[] = Object.freeze(
	[...BLOCK_DEFS, ...BLOCK_V2_DEFS].sort((a, b) => a.id - b.id),
)
export const ALL_BLOCK_DEF_COUNT = ALL_BLOCK_DEFS.length
