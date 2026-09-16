import { BLOCK, RENDER_LAYER, type RenderLayer } from '@voxelcraft/core-types'
import { textureLayer } from './textures'

/**
 * Client-side render description per block id.
 *
 * `packages/gameplay` owns the authoritative block registry and is being built
 * in parallel, so this is a client-local double keyed by the frozen `BLOCK` ids.
 * It only carries render data (layer, textures, tint, occlusion), never gameplay
 * data such as hardness or drops, so swapping it for the registry later is a
 * mechanical change contained in `packages/client`.
 */

export const TINT = { None: 0, Grass: 1, Foliage: 2, Water: 3, Lava: 4 } as const
export type TintIndex = (typeof TINT)[keyof typeof TINT]
export const TINT_COUNT = 5

export interface BlockAppearance {
	readonly id: number
	readonly name: string
	readonly layer: RenderLayer
	/** Meshed by the greedy pass as a full 1x1x1 cube. */
	readonly fullCube: boolean
	/** Meshed by the cross pass as two intersecting quads (plants, torches). */
	readonly cross: boolean
	/** Completely hides the neighbouring face it touches. */
	readonly opaqueCube: boolean
	/** Hide faces shared with a block in the same cull group (water/glass/ice). */
	readonly selfCull: boolean
	readonly cullGroup: number
	readonly emission: number
	/** Texture array layer per FACE index: NegX, PosX, NegY, PosY, NegZ, PosZ. */
	readonly faces: readonly number[]
	/** Tint palette index per FACE index. */
	readonly faceTints: readonly number[]
}

interface CubeSpec {
	all?: string
	top?: string
	bottom?: string
	side?: string
	/** Texture for the -Z face only (furnace/chest fronts). */
	front?: string
	layer?: RenderLayer
	opaque?: boolean
	selfCull?: boolean
	cullGroup?: number
	emission?: number
	tint?: number
	topTint?: number
	sideTint?: number
}

const TABLE_SIZE = 256
const table: Array<BlockAppearance | null> = new Array<BlockAppearance | null>(TABLE_SIZE).fill(null)
const opaqueLookup = new Uint8Array(TABLE_SIZE)

function defineCube(id: number, name: string, spec: CubeSpec = {}): void {
	const side = spec.side ?? spec.all ?? name
	const top = spec.top ?? spec.all ?? side
	const bottom = spec.bottom ?? spec.all ?? side
	const front = spec.front ?? side
	const layer = spec.layer ?? RENDER_LAYER.Opaque
	const tint = spec.tint ?? TINT.None
	const sideTint = spec.sideTint ?? tint
	table[id] = {
		id,
		name,
		layer,
		fullCube: true,
		cross: false,
		opaqueCube: spec.opaque ?? layer === RENDER_LAYER.Opaque,
		selfCull: spec.selfCull ?? false,
		cullGroup: spec.cullGroup ?? id,
		emission: spec.emission ?? 0,
		faces: [
			textureLayer(side),
			textureLayer(side),
			textureLayer(bottom),
			textureLayer(top),
			textureLayer(front),
			textureLayer(side),
		],
		faceTints: [sideTint, sideTint, tint, spec.topTint ?? tint, sideTint, sideTint],
	}
}

function defineCross(id: number, name: string, tint = TINT.None as number, emission = 0): void {
	const layerIndex = textureLayer(name)
	table[id] = {
		id,
		name,
		layer: RENDER_LAYER.Cutout,
		fullCube: false,
		cross: true,
		opaqueCube: false,
		selfCull: false,
		cullGroup: id,
		emission,
		faces: [layerIndex, layerIndex, layerIndex, layerIndex, layerIndex, layerIndex],
		faceTints: [tint, tint, tint, tint, tint, tint],
	}
}

/** Shared cull groups so `water` and `water_flowing` hide their mutual faces. */
const GROUP_WATER = 900
const GROUP_LAVA = 901
const GROUP_GLASS = 902

const SIMPLE_CUBES: ReadonlyArray<readonly [number, string]> = [
	[BLOCK.STONE, 'stone'],
	[BLOCK.COBBLESTONE, 'cobblestone'],
	[BLOCK.DIRT, 'dirt'],
	[BLOCK.SAND, 'sand'],
	[BLOCK.SANDSTONE, 'sandstone'],
	[BLOCK.GRAVEL, 'gravel'],
	[BLOCK.SNOW_BLOCK, 'snow'],
	[BLOCK.BEDROCK, 'bedrock'],
	[BLOCK.CLAY, 'clay'],
	[BLOCK.COAL_ORE, 'coal_ore'],
	[BLOCK.IRON_ORE, 'iron_ore'],
	[BLOCK.GOLD_ORE, 'gold_ore'],
	[BLOCK.DIAMOND_ORE, 'diamond_ore'],
	[BLOCK.REDSTONE_ORE, 'redstone_ore'],
	[BLOCK.LAPIS_ORE, 'lapis_ore'],
	[BLOCK.PLANKS, 'planks'],
	[BLOCK.BED_FOOT, 'bed_foot'],
	[BLOCK.BED_HEAD, 'bed_head'],
	[BLOCK.REDSTONE_LAMP, 'redstone_lamp'],
	[BLOCK.STONE_BRICKS, 'stone_bricks'],
	[BLOCK.BRICKS, 'bricks'],
	[BLOCK.OBSIDIAN, 'obsidian'],
	[BLOCK.SNOW_LAYER, 'snow_layer'],
	[BLOCK.IRON_BLOCK, 'iron_block'],
	[BLOCK.GOLD_BLOCK, 'gold_block'],
	[BLOCK.DIAMOND_BLOCK, 'diamond_block'],
	[BLOCK.COAL_BLOCK, 'coal_block'],
	[BLOCK.WOOL, 'wool'],
	[BLOCK.PISTON_HEAD, 'piston_head'],
]
for (const [id, texture] of SIMPLE_CUBES) defineCube(id, texture, { all: texture })

const LOGS: ReadonlyArray<readonly [number, string, string]> = [
	[BLOCK.OAK_LOG, 'oak_log', 'oak_log_top'],
	[BLOCK.BIRCH_LOG, 'birch_log', 'birch_log_top'],
	[BLOCK.SPRUCE_LOG, 'spruce_log', 'spruce_log_top'],
]
for (const [id, side, cap] of LOGS) defineCube(id, side, { side, top: cap, bottom: cap })

const LEAVES: ReadonlyArray<readonly [number, string]> = [
	[BLOCK.OAK_LEAVES, 'oak_leaves'],
	[BLOCK.BIRCH_LEAVES, 'birch_leaves'],
	[BLOCK.SPRUCE_LEAVES, 'spruce_leaves'],
]
for (const [id, texture] of LEAVES) {
	defineCube(id, texture, {
		all: texture,
		layer: RENDER_LAYER.Cutout,
		opaque: false,
		tint: TINT.Foliage,
	})
}

const CROSSES: ReadonlyArray<readonly [number, string, number, number]> = [
	[BLOCK.TALL_GRASS, 'tall_grass', TINT.Grass, 0],
	[BLOCK.DEAD_BUSH, 'dead_bush', TINT.None, 0],
	[BLOCK.FLOWER_RED, 'flower_red', TINT.None, 0],
	[BLOCK.FLOWER_YELLOW, 'flower_yellow', TINT.None, 0],
	[BLOCK.OAK_SAPLING, 'oak_sapling', TINT.Foliage, 0],
	[BLOCK.TORCH, 'torch', TINT.None, 14],
	[BLOCK.REDSTONE_WIRE, 'redstone_wire', TINT.None, 0],
	[BLOCK.LEVER, 'lever', TINT.None, 0],
	[BLOCK.BUTTON, 'button', TINT.None, 0],
	[BLOCK.PRESSURE_PLATE, 'pressure_plate', TINT.None, 0],
	[BLOCK.LADDER, 'ladder', TINT.None, 0],
]
for (const [id, texture, tint, emission] of CROSSES) defineCross(id, texture, tint, emission)

defineCube(BLOCK.GRASS_BLOCK, 'grass_block', {
	top: 'grass_top',
	side: 'grass_side',
	bottom: 'dirt',
	topTint: TINT.Grass,
	sideTint: TINT.Grass,
})
defineCube(BLOCK.CACTUS, 'cactus', { side: 'cactus_side', top: 'cactus_top', bottom: 'cactus_top' })
defineCube(BLOCK.ICE, 'ice', {
	all: 'ice',
	layer: RENDER_LAYER.Translucent,
	opaque: false,
	selfCull: true,
	cullGroup: GROUP_GLASS,
})
defineCube(BLOCK.GLASS, 'glass', {
	all: 'glass',
	layer: RENDER_LAYER.Cutout,
	opaque: false,
	selfCull: true,
	cullGroup: GROUP_GLASS,
})
for (const [id, name] of [
	[BLOCK.WATER, 'water'],
	[BLOCK.WATER_FLOWING, 'water_flowing'],
] as ReadonlyArray<readonly [number, string]>) {
	defineCube(id, name, {
		all: 'water',
		layer: RENDER_LAYER.Translucent,
		opaque: false,
		selfCull: true,
		cullGroup: GROUP_WATER,
		tint: TINT.Water,
	})
}
for (const [id, name] of [
	[BLOCK.LAVA, 'lava'],
	[BLOCK.LAVA_FLOWING, 'lava_flowing'],
] as ReadonlyArray<readonly [number, string]>) {
	defineCube(id, name, { all: 'lava', emission: 15, selfCull: true, cullGroup: GROUP_LAVA })
}
defineCube(BLOCK.CRAFTING_TABLE, 'crafting_table', {
	top: 'crafting_table_top',
	side: 'crafting_table_side',
	bottom: 'planks',
})
defineCube(BLOCK.FURNACE, 'furnace', {
	side: 'furnace_side',
	front: 'furnace_front',
	top: 'furnace_top',
	bottom: 'furnace_top',
})
defineCube(BLOCK.FURNACE_LIT, 'furnace_lit', {
	side: 'furnace_side',
	front: 'furnace_front_lit',
	top: 'furnace_top',
	bottom: 'furnace_top',
	emission: 13,
})
defineCube(BLOCK.CHEST, 'chest', {
	side: 'chest_side',
	front: 'chest_front',
	top: 'chest_top',
	bottom: 'chest_top',
})
defineCube(BLOCK.GLOWSTONE, 'glowstone', { all: 'glowstone', emission: 15 })
defineCube(BLOCK.REDSTONE_LAMP_LIT, 'redstone_lamp_lit', { all: 'redstone_lamp_lit', emission: 15 })
defineCube(BLOCK.PISTON, 'piston', { side: 'piston_side', top: 'piston_top', bottom: 'piston_side' })
// Doors are modelled as cutout cubes until gameplay supplies real block shapes.
defineCube(BLOCK.DOOR_LOWER, 'door_lower', {
	all: 'door_lower',
	layer: RENDER_LAYER.Cutout,
	opaque: false,
})
defineCube(BLOCK.DOOR_UPPER, 'door_upper', {
	all: 'door_upper',
	layer: RENDER_LAYER.Cutout,
	opaque: false,
})

for (let id = 0; id < TABLE_SIZE; id++) {
	const appearance = table[id]
	opaqueLookup[id] = appearance !== null && appearance.opaqueCube ? 1 : 0
}

export function appearanceOf(id: number): BlockAppearance | null {
	if (id <= 0 || id >= TABLE_SIZE) return null
	return table[id]
}

/** Fast path used by the AO and smooth-light samplers. */
export function isOpaqueId(id: number): boolean {
	if (id <= 0 || id >= TABLE_SIZE) return false
	return opaqueLookup[id] === 1
}

export function isRenderable(id: number): boolean {
	const appearance = appearanceOf(id)
	return appearance !== null && (appearance.fullCube || appearance.cross)
}

/**
 * Face visibility rule shared by the mesher and `countVisibleFaces`, which is
 * what makes the merged-area invariant hold.
 */
export function occludedBy(target: BlockAppearance, neighbourId: number): boolean {
	if (neighbourId === 0) return false
	const neighbour = appearanceOf(neighbourId)
	if (neighbour === null) return false
	if (neighbour.opaqueCube) return true
	return target.selfCull && neighbour.cullGroup === target.cullGroup
}
