import type { BlockId, ItemId } from './ids'
import type { FluidKind } from './fluid'
import type { LightProps } from './light'
import type { BlockEntityKind } from './blockEntity'
import type { RedstoneRole } from './redstone'

export const RENDER_LAYER = { Opaque: 0, Cutout: 1, Translucent: 2 } as const
export type RenderLayer = (typeof RENDER_LAYER)[keyof typeof RENDER_LAYER]

export const TOOL_CLASS = {
	None: 0,
	Pickaxe: 1,
	Axe: 2,
	Shovel: 3,
	Sword: 4,
	Shears: 5,
} as const
export type ToolClass = (typeof TOOL_CLASS)[keyof typeof TOOL_CLASS]

export const TOOL_TIER = { None: 0, Wood: 1, Stone: 2, Iron: 3, Diamond: 4 } as const
export type ToolTier = (typeof TOOL_TIER)[keyof typeof TOOL_TIER]

/** Mining speed multiplier per tier, indexed by ToolTier. */
export const TIER_SPEED: readonly number[] = [1, 2, 4, 6, 8]

export const SOUND_GROUP = {
	Stone: 'stone',
	Dirt: 'dirt',
	Grass: 'grass',
	Sand: 'sand',
	Wood: 'wood',
	Glass: 'glass',
	Wool: 'wool',
	Metal: 'metal',
	Snow: 'snow',
	Liquid: 'liquid',
	Plant: 'plant',
} as const
export type SoundGroup = (typeof SOUND_GROUP)[keyof typeof SOUND_GROUP]

/**
 * Canonical block ids. FROZEN for v1: world generation, gameplay definitions,
 * save files and tests all rely on these numbers.
 * Ids 200..255 are a free experimental range for the owning package.
 */
export const BLOCK = {
	AIR: 0,
	STONE: 1,
	COBBLESTONE: 2,
	DIRT: 3,
	GRASS_BLOCK: 4,
	SAND: 5,
	SANDSTONE: 6,
	GRAVEL: 7,
	SNOW_BLOCK: 8,
	ICE: 9,
	WATER: 10,
	LAVA: 11,
	BEDROCK: 12,
	CLAY: 13,
	OAK_LOG: 14,
	OAK_LEAVES: 15,
	BIRCH_LOG: 16,
	BIRCH_LEAVES: 17,
	SPRUCE_LOG: 18,
	SPRUCE_LEAVES: 19,
	CACTUS: 20,
	TALL_GRASS: 21,
	DEAD_BUSH: 22,
	FLOWER_RED: 23,
	FLOWER_YELLOW: 24,
	OAK_SAPLING: 25,
	COAL_ORE: 26,
	IRON_ORE: 27,
	GOLD_ORE: 28,
	DIAMOND_ORE: 29,
	REDSTONE_ORE: 30,
	LAPIS_ORE: 31,
	PLANKS: 32,
	GLASS: 33,
	CRAFTING_TABLE: 34,
	FURNACE: 35,
	FURNACE_LIT: 36,
	CHEST: 37,
	TORCH: 38,
	GLOWSTONE: 39,
	DOOR_LOWER: 40,
	DOOR_UPPER: 41,
	BED_FOOT: 42,
	BED_HEAD: 43,
	REDSTONE_WIRE: 44,
	LEVER: 45,
	BUTTON: 46,
	PRESSURE_PLATE: 47,
	REDSTONE_LAMP: 48,
	REDSTONE_LAMP_LIT: 49,
	PISTON: 50,
	PISTON_HEAD: 51,
	STONE_BRICKS: 52,
	BRICKS: 53,
	OBSIDIAN: 54,
	SNOW_LAYER: 55,
	IRON_BLOCK: 56,
	GOLD_BLOCK: 57,
	DIAMOND_BLOCK: 58,
	COAL_BLOCK: 59,
	WOOL: 60,
	LADDER: 61,
	WATER_FLOWING: 62,
	LAVA_FLOWING: 63,
} as const
export type BlockKeyName = keyof typeof BLOCK
export const BLOCK_EXPERIMENTAL_BASE = 200
export const BLOCK_ID_MAX = 255

export interface BlockTextures {
	all?: string
	top?: string
	bottom?: string
	side?: string
}

export interface BlockDrop {
	item: ItemId
	min: number
	max: number
	/** 0..1 */
	chance: number
	requiresTier: ToolTier
}

export interface BlockDef {
	id: BlockId
	/** Registry name, e.g. 'grass_block'. */
	name: string
	displayName: string
	layer: RenderLayer
	/** Has an AABB collider. */
	solid: boolean
	/** Occludes neighbour faces completely (mesher face culling). */
	fullCube: boolean
	/** Can be replaced by block placement (air, plants, fluids). */
	replaceable: boolean
	/** 0..15, 15 = fully opaque to light. */
	opacity: number
	/** 0..15 emitted block light. */
	emission: number
	skyPassThrough: boolean
	skyFilter: number
	/** Seconds of base hardness, -1 = unbreakable. */
	hardness: number
	toolClass: ToolClass
	minTier: ToolTier
	textures: BlockTextures
	drops: readonly BlockDrop[]
	fluid: FluidKind
	blockEntity: BlockEntityKind | null
	gravity: boolean
	flammable: boolean
	redstone: RedstoneRole | null
	soundGroup: SoundGroup
	/** Item produced in the inventory; equals id for plain block items. */
	itemId: ItemId
}

export interface BlockRegistry {
	define(def: BlockDef): void
	byId(id: BlockId): BlockDef
	byName(name: string): BlockDef | undefined
	all(): readonly BlockDef[]
	isSolid(id: BlockId): boolean
	isFullCube(id: BlockId): boolean
	layerOf(id: BlockId): RenderLayer
	lightPropsOf(id: BlockId): LightProps
}

/**
 * Canonical break time. Shared by the mining system and the HUD progress bar,
 * so both must call this function instead of re-deriving the formula.
 */
export function breakTimeSeconds(
	def: BlockDef,
	tier: ToolTier,
	toolClass: ToolClass,
): number {
	if (def.hardness < 0) return Number.POSITIVE_INFINITY
	if (def.hardness === 0) return 0
	const correctTool = def.toolClass !== TOOL_CLASS.None && toolClass === def.toolClass
	const canHarvest = def.minTier === TOOL_TIER.None || (correctTool && tier >= def.minTier)
	const speed = correctTool ? TIER_SPEED[tier] : 1
	const factor = canHarvest ? 1.5 : 5
	return (def.hardness * factor) / speed
}

export function canHarvest(def: BlockDef, tier: ToolTier, toolClass: ToolClass): boolean {
	if (def.minTier === TOOL_TIER.None) return true
	return def.toolClass === toolClass && tier >= def.minTier
}
