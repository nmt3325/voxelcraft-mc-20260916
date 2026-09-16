/**
 * Canonical texture order.
 *
 * `MeshRequest` carries no atlas information (the contract in `mesh.ts` freezes
 * the message shape), so the mesher may not depend on a runtime manifest.
 * Instead lane 4 of every vertex stores the index into THIS list, and the
 * renderer builds its `DataArrayTexture` in exactly this order by looking each
 * name up in the `AtlasManifest` produced by `@voxelcraft/assets-gen`.
 *
 * Consequences:
 *  - mesher output is a pure function of its input (byte determinism holds even
 *    if the atlas is regenerated with a different tile order),
 *  - a texture missing from the atlas degrades to layer 0 (`missing`) instead of
 *    shifting every other layer.
 *
 * Index 0 MUST stay `missing`.
 */
export const TEXTURE_NAMES = [
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
	// v2 additions (BLOCK_V2 64..81), appended so v1 layer indices never move.
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
	'wheat_stage_0',
	'wheat_stage_1',
	'wheat_stage_2',
	'wheat_stage_3',
	'wheat_stage_4',
	'wheat_stage_5',
	'wheat_stage_6',
	'wheat_stage_7',
	'carrot_stage_0',
	'carrot_stage_1',
	'carrot_stage_2',
	'carrot_stage_3',
	'carrot_stage_4',
	'carrot_stage_5',
	'carrot_stage_6',
	'carrot_stage_7',
	'potato_stage_0',
	'potato_stage_1',
	'potato_stage_2',
	'potato_stage_3',
	'potato_stage_4',
	'potato_stage_5',
	'potato_stage_6',
	'potato_stage_7',
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
] as const

export type TextureName = (typeof TEXTURE_NAMES)[number]

export const TEXTURE_COUNT = TEXTURE_NAMES.length

const layerByName: Record<string, number> = {}
for (let i = 0; i < TEXTURE_NAMES.length; i++) layerByName[TEXTURE_NAMES[i]] = i

export const TEXTURE_LAYER: Readonly<Record<string, number>> = Object.freeze(layerByName)

/** Layer index for a texture name; unknown names fall back to `missing` (0). */
export function textureLayer(name: string): number {
	const index = TEXTURE_LAYER[name]
	return index === undefined ? 0 : index
}
