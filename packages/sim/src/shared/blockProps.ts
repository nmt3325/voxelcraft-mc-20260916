/**
 * Minimal block facts the simulation needs.
 *
 * `packages/gameplay` owns the authoritative `BlockRegistry`, and `packages/sim`
 * must not depend on it, so the collision / optical / fluid facts used by the
 * simulation are derived here from the frozen `BLOCK` ids of the contract.
 * No constant is re-defined: `MAX_LIGHT`, `FLUID` and every block id come from
 * `@voxelcraft/core-types`.
 *
 * Unknown ids (including the experimental range 200..255) default to air-like so
 * a stray id can never create an invisible wall.
 */
import { BLOCK, FLUID, MAX_LIGHT } from '@voxelcraft/core-types'
import type { BlockId, FluidKind, LightProps } from '@voxelcraft/core-types'

export interface SimBlockProps extends LightProps {
	/** Has an AABB collider. */
	solid: boolean
	/** Occludes a whole voxel. */
	fullCube: boolean
	fluid: FluidKind
	/** Ladders: vertical movement without jumping. */
	climbable: boolean
	/** Can be replaced by placement or by flowing fluid. */
	replaceable: boolean
}

const BLOCK_COUNT = 256

function airLike(): SimBlockProps {
	return {
		opacity: 0,
		emission: 0,
		skyPassThrough: true,
		skyFilter: 0,
		solid: false,
		fullCube: false,
		fluid: FLUID.None,
		climbable: false,
		replaceable: true,
	}
}

const TABLE: SimBlockProps[] = Array.from({ length: BLOCK_COUNT }, () => airLike())

/** Solid, sky-blocking, full voxel. */
const SOLID_OPAQUE: readonly BlockId[] = [
	BLOCK.STONE,
	BLOCK.COBBLESTONE,
	BLOCK.DIRT,
	BLOCK.GRASS_BLOCK,
	BLOCK.SAND,
	BLOCK.SANDSTONE,
	BLOCK.GRAVEL,
	BLOCK.SNOW_BLOCK,
	BLOCK.BEDROCK,
	BLOCK.CLAY,
	BLOCK.OAK_LOG,
	BLOCK.BIRCH_LOG,
	BLOCK.SPRUCE_LOG,
	BLOCK.COAL_ORE,
	BLOCK.IRON_ORE,
	BLOCK.GOLD_ORE,
	BLOCK.DIAMOND_ORE,
	BLOCK.REDSTONE_ORE,
	BLOCK.LAPIS_ORE,
	BLOCK.PLANKS,
	BLOCK.CRAFTING_TABLE,
	BLOCK.FURNACE,
	BLOCK.FURNACE_LIT,
	BLOCK.GLOWSTONE,
	BLOCK.REDSTONE_LAMP,
	BLOCK.REDSTONE_LAMP_LIT,
	BLOCK.PISTON,
	BLOCK.STONE_BRICKS,
	BLOCK.BRICKS,
	BLOCK.OBSIDIAN,
	BLOCK.IRON_BLOCK,
	BLOCK.GOLD_BLOCK,
	BLOCK.DIAMOND_BLOCK,
	BLOCK.COAL_BLOCK,
	BLOCK.WOOL,
]
for (const id of SOLID_OPAQUE) {
	const p = TABLE[id]
	p.solid = true
	p.fullCube = true
	p.opacity = MAX_LIGHT
	p.skyPassThrough = false
	p.replaceable = false
}

/** Solid voxels that light still crosses, with their own attenuation. */
const SOLID_TRANSLUCENT: readonly {
	id: BlockId
	opacity: number
	skyFilter: number
	skyPassThrough: boolean
}[] = [
	{ id: BLOCK.GLASS, opacity: 0, skyFilter: 0, skyPassThrough: true },
	{ id: BLOCK.ICE, opacity: 2, skyFilter: 1, skyPassThrough: false },
	{ id: BLOCK.OAK_LEAVES, opacity: 1, skyFilter: 1, skyPassThrough: false },
	{ id: BLOCK.BIRCH_LEAVES, opacity: 1, skyFilter: 1, skyPassThrough: false },
	{ id: BLOCK.SPRUCE_LEAVES, opacity: 1, skyFilter: 1, skyPassThrough: false },
]
for (const entry of SOLID_TRANSLUCENT) {
	const p = TABLE[entry.id]
	p.solid = true
	p.fullCube = false
	p.opacity = entry.opacity
	p.skyFilter = entry.skyFilter
	p.skyPassThrough = entry.skyPassThrough
	p.replaceable = false
}

/** Solid but not a whole voxel: light passes without extra attenuation. */
const SOLID_PARTIAL: readonly BlockId[] = [
	BLOCK.CACTUS,
	BLOCK.CHEST,
	BLOCK.DOOR_LOWER,
	BLOCK.DOOR_UPPER,
	BLOCK.BED_FOOT,
	BLOCK.BED_HEAD,
	BLOCK.PISTON_HEAD,
]
for (const id of SOLID_PARTIAL) {
	const p = TABLE[id]
	p.solid = true
	p.fullCube = false
	p.opacity = 0
	p.skyPassThrough = false
	p.replaceable = false
}

const FLUID_BLOCKS: readonly { id: BlockId; kind: FluidKind }[] = [
	{ id: BLOCK.WATER, kind: FLUID.Water },
	{ id: BLOCK.WATER_FLOWING, kind: FLUID.Water },
	{ id: BLOCK.LAVA, kind: FLUID.Lava },
	{ id: BLOCK.LAVA_FLOWING, kind: FLUID.Lava },
]
for (const entry of FLUID_BLOCKS) {
	const p = TABLE[entry.id]
	p.fluid = entry.kind
	p.solid = false
	p.fullCube = false
	p.replaceable = true
	p.skyPassThrough = false
	if (entry.kind === FLUID.Water) {
		p.opacity = 2
		p.skyFilter = 1
	} else {
		p.opacity = 0
		p.emission = MAX_LIGHT
	}
}

const EMISSION: readonly (readonly [BlockId, number])[] = [
	[BLOCK.TORCH, 14],
	[BLOCK.GLOWSTONE, MAX_LIGHT],
	[BLOCK.FURNACE_LIT, 13],
	[BLOCK.REDSTONE_LAMP_LIT, MAX_LIGHT],
]
for (const [id, emission] of EMISSION) TABLE[id].emission = emission

TABLE[BLOCK.LADDER].climbable = true

for (const p of TABLE) Object.freeze(p)
Object.freeze(TABLE)

const AIR_PROPS: Readonly<SimBlockProps> = TABLE[BLOCK.AIR]

export function simBlockProps(id: BlockId): Readonly<SimBlockProps> {
	return id >= 0 && id < BLOCK_COUNT ? TABLE[id] : AIR_PROPS
}

/** The `LightProps` view of a block, i.e. the only input the light engine needs. */
export function lightPropsOf(id: BlockId): LightProps {
	const p = simBlockProps(id)
	return {
		opacity: p.opacity,
		emission: p.emission,
		skyPassThrough: p.skyPassThrough,
		skyFilter: p.skyFilter,
	}
}

export function isSolidBlock(id: BlockId): boolean {
	return simBlockProps(id).solid
}
export function isFullCubeBlock(id: BlockId): boolean {
	return simBlockProps(id).fullCube
}
export function fluidKindOf(id: BlockId): FluidKind {
	return simBlockProps(id).fluid
}
export function isLiquidBlock(id: BlockId): boolean {
	return simBlockProps(id).fluid !== FLUID.None
}
export function isClimbableBlock(id: BlockId): boolean {
	return simBlockProps(id).climbable
}
export function isReplaceableBlock(id: BlockId): boolean {
	return simBlockProps(id).replaceable
}
export function emissionOf(id: BlockId): number {
	return simBlockProps(id).emission
}
export function opacityOf(id: BlockId): number {
	return simBlockProps(id).opacity
}
