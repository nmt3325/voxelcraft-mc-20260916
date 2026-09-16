/**
 * Canonical texture names. The renderer in packages/client looks textures up by
 * these exact strings, so the spelling is part of the contract. `missing` must
 * stay first: it is the fallback tile at atlas index 0.
 */
import { CROP_STAGES } from '@voxelcraft/core-types'

/** v1 names in shipped order. Frozen: these atlas layer indices must never move. */
export const V1_TEXTURES: readonly string[] = [
	'missing',
	'stone',
	'cobblestone',
	'dirt',
	'grass_top',
	'grass_side',
	'sand',
	'sandstone',
	'gravel',
	'snow',
	'ice',
	'water',
	'lava',
	'bedrock',
	'clay',
	'oak_log',
	'oak_log_top',
	'oak_leaves',
	'birch_log',
	'birch_log_top',
	'birch_leaves',
	'spruce_log',
	'spruce_log_top',
	'spruce_leaves',
	'cactus_side',
	'cactus_top',
	'tall_grass',
	'dead_bush',
	'flower_red',
	'flower_yellow',
	'oak_sapling',
	'coal_ore',
	'iron_ore',
	'gold_ore',
	'diamond_ore',
	'redstone_ore',
	'lapis_ore',
	'planks',
	'glass',
	'crafting_table_top',
	'crafting_table_side',
	'furnace_front',
	'furnace_front_lit',
	'furnace_side',
	'furnace_top',
	'chest_front',
	'chest_side',
	'chest_top',
	'torch',
	'glowstone',
	'door_lower',
	'door_upper',
	'bed_foot',
	'bed_head',
	'redstone_wire',
	'lever',
	'button',
	'pressure_plate',
	'redstone_lamp',
	'redstone_lamp_lit',
	'piston_side',
	'piston_top',
	'piston_head',
	'stone_bricks',
	'bricks',
	'obsidian',
	'snow_layer',
	'iron_block',
	'gold_block',
	'diamond_block',
	'coal_block',
	'wool',
	'ladder',
]

/** Crops that declare one cutout tile per growth stage. */
export const CROP_TEXTURE_CROPS: readonly string[] = ['wheat', 'carrot', 'potato']

/** `<crop>_stage_0` ... `<crop>_stage_{CROP_STAGES - 1}`, in growth order. */
export function cropStageNames(crop: string): readonly string[] {
	const names: string[] = []
	for (let stage = 0; stage < CROP_STAGES; stage++) names.push(`${crop}_stage_${stage}`)
	return names
}

const CROP_STAGE_TEXTURES: readonly string[] = CROP_TEXTURE_CROPS.flatMap((crop) => [
	...cropStageNames(crop),
])

/**
 * v2 additions covering the BLOCK_V2 64..81 band. Appended after the v1 block in
 * this fixed order so no existing layer index moves. `glowstone` already shipped
 * in v1 and is reused rather than duplicated.
 */
export const V2_TEXTURES: readonly string[] = [
	'netherrack',
	'nether_portal',
	'soul_sand',
	'soul_soil',
	'quartz_ore',
	'nether_bricks',
	'magma_block',
	'farmland_dry_top',
	'farmland_wet_top',
	'farmland_side',
	'farmland_bottom',
	...CROP_STAGE_TEXTURES,
	'enchanting_table_top',
	'enchanting_table_side',
	'enchanting_table_bottom',
	'bookshelf',
	'gravel_path',
	'cobblestone_wall',
	'hay_block_top',
	'hay_block_side',
	'hay_block_bottom',
	'fence',
	'fence_gate',
]

export const REQUIRED_TEXTURES: readonly string[] = [...V1_TEXTURES, ...V2_TEXTURES]

/** Binary alpha (0 or 255) after generation: drawn in the cutout render layer. */
export const CUTOUT_TEXTURES: readonly string[] = [
	'oak_leaves',
	'birch_leaves',
	'spruce_leaves',
	'tall_grass',
	'dead_bush',
	'flower_red',
	'flower_yellow',
	'oak_sapling',
	'torch',
	'ladder',
	'door_lower',
	'door_upper',
	'redstone_wire',
	...CROP_STAGE_TEXTURES,
	'fence',
	'fence_gate',
]

/** Partially transparent: these keep their 0 < alpha < 255 pixels. */
export const TRANSLUCENT_TEXTURES: readonly string[] = [
	'water',
	'ice',
	'glass',
	'lava',
	'nether_portal',
]
