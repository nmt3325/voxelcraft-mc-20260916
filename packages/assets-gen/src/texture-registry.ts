/** Maps every required texture name to the routine that paints its tile. */
import { CROP_STAGES } from '@voxelcraft/core-types'
import {
	BIRCH_BARK,
	BIRCH_RING,
	COAL,
	DIAMOND,
	FLOWER_RED,
	FLOWER_YELLOW,
	GOLD,
	IRON,
	IRON_ORE,
	LAPIS,
	OAK_BARK,
	OAK_RING,
	REDSTONE,
	SPRUCE_BARK,
	SPRUCE_RING,
} from './palette'
import {
	chestFrontTile,
	chestSideTile,
	chestTopTile,
	furnaceFrontLitTile,
	furnaceFrontTile,
	furnaceSideTile,
	furnaceTopTile,
} from './tex-built'
import {
	CROP_STYLES,
	cropStageTile,
	farmlandBottomTile,
	farmlandSideTile,
	farmlandTopTile,
} from './tex-farm'
import {
	bedFootTile,
	bedHeadTile,
	doorLowerTile,
	doorUpperTile,
	pistonHeadTile,
	pistonSideTile,
	pistonTopTile,
} from './tex-fixtures'
import {
	bedrockTile,
	clayTile,
	cobblestoneTile,
	dirtTile,
	grassSideTile,
	grassTopTile,
	gravelTile,
	missingTile,
	sandTile,
	sandstoneTile,
	snowLayerTile,
	snowTile,
	stoneTile,
} from './tex-ground'
import { glassTile, iceTile, lavaTile, waterTile } from './tex-liquid'
import {
	bricksTile,
	coalBlockTile,
	glowstoneTile,
	mineralBlockTile,
	obsidianTile,
	oreTile,
	stoneBricksTile,
	woolTile,
} from './tex-mineral'
import {
	magmaTile,
	netherBricksTile,
	netherPortalTile,
	netherrackTile,
	quartzOreTile,
	soulSandTile,
	soulSoilTile,
} from './tex-nether'
import { deadBushTile, flowerTile, leavesTile, saplingTile, tallGrassTile } from './tex-plants'
import { ladderTile, torchTile } from './tex-props'
import {
	buttonTile,
	leverTile,
	pressurePlateTile,
	redstoneLampLitTile,
	redstoneLampTile,
	redstoneWireTile,
} from './tex-redstone'
import {
	bookshelfTile,
	cobblestoneWallTile,
	enchantingTableBottomTile,
	enchantingTableSideTile,
	enchantingTableTopTile,
	fenceGateTile,
	fenceTile,
	gravelPathTile,
	hayBlockBottomTile,
	hayBlockSideTile,
	hayBlockTopTile,
} from './tex-village'
import {
	cactusSideTile,
	cactusTopTile,
	craftingTableSideTile,
	craftingTableTopTile,
	logSideTile,
	logTopTile,
	planksTile,
} from './tex-wood'
import { CROP_TEXTURE_CROPS, cropStageNames } from './texture-list'
import type { TileCanvas } from './tile'

export type TilePainter = (t: TileCanvas) => void

/** One painter per crop stage, keyed by the same names texture-list declares. */
function cropStageGenerators(): Record<string, TilePainter> {
	const out: Record<string, TilePainter> = {}
	for (const crop of CROP_TEXTURE_CROPS) {
		const style = CROP_STYLES[crop]
		if (!style) throw new Error(`no crop style registered for "${crop}"`)
		cropStageNames(crop).forEach((name, stage) => {
			out[name] = cropStageTile(style, stage, CROP_STAGES)
		})
	}
	return out
}

export const GENERATORS: Readonly<Record<string, TilePainter>> = {
	missing: missingTile,
	stone: stoneTile,
	cobblestone: cobblestoneTile,
	dirt: dirtTile,
	grass_top: grassTopTile,
	grass_side: grassSideTile,
	sand: sandTile,
	sandstone: sandstoneTile,
	gravel: gravelTile,
	snow: snowTile,
	ice: iceTile,
	water: waterTile,
	lava: lavaTile,
	bedrock: bedrockTile,
	clay: clayTile,
	oak_log: logSideTile(OAK_BARK, 601),
	oak_log_top: logTopTile(OAK_BARK, OAK_RING, 602),
	oak_leaves: leavesTile(603),
	birch_log: logSideTile(BIRCH_BARK, 611),
	birch_log_top: logTopTile(BIRCH_BARK, BIRCH_RING, 612),
	birch_leaves: leavesTile(613),
	spruce_log: logSideTile(SPRUCE_BARK, 621),
	spruce_log_top: logTopTile(SPRUCE_BARK, SPRUCE_RING, 622),
	spruce_leaves: leavesTile(623),
	cactus_side: cactusSideTile,
	cactus_top: cactusTopTile,
	tall_grass: tallGrassTile,
	dead_bush: deadBushTile,
	flower_red: flowerTile(FLOWER_RED, 631),
	flower_yellow: flowerTile(FLOWER_YELLOW, 632),
	oak_sapling: saplingTile,
	coal_ore: oreTile(COAL, 5, 641),
	iron_ore: oreTile(IRON_ORE, 6, 642),
	gold_ore: oreTile(GOLD, 5, 643),
	diamond_ore: oreTile(DIAMOND, 4, 644),
	redstone_ore: oreTile(REDSTONE, 6, 645),
	lapis_ore: oreTile(LAPIS, 5, 646),
	planks: planksTile,
	glass: glassTile,
	crafting_table_top: craftingTableTopTile,
	crafting_table_side: craftingTableSideTile,
	furnace_front: furnaceFrontTile,
	furnace_front_lit: furnaceFrontLitTile,
	furnace_side: furnaceSideTile,
	furnace_top: furnaceTopTile,
	chest_front: chestFrontTile,
	chest_side: chestSideTile,
	chest_top: chestTopTile,
	torch: torchTile,
	glowstone: glowstoneTile,
	door_lower: doorLowerTile,
	door_upper: doorUpperTile,
	bed_foot: bedFootTile,
	bed_head: bedHeadTile,
	redstone_wire: redstoneWireTile,
	lever: leverTile,
	button: buttonTile,
	pressure_plate: pressurePlateTile,
	redstone_lamp: redstoneLampTile,
	redstone_lamp_lit: redstoneLampLitTile,
	piston_side: pistonSideTile,
	piston_top: pistonTopTile,
	piston_head: pistonHeadTile,
	stone_bricks: stoneBricksTile,
	bricks: bricksTile,
	obsidian: obsidianTile,
	snow_layer: snowLayerTile,
	iron_block: mineralBlockTile(IRON, 651),
	gold_block: mineralBlockTile(GOLD, 652),
	diamond_block: mineralBlockTile(DIAMOND, 653),
	coal_block: coalBlockTile,
	wool: woolTile,
	ladder: ladderTile,
	netherrack: netherrackTile,
	nether_portal: netherPortalTile,
	soul_sand: soulSandTile,
	soul_soil: soulSoilTile,
	quartz_ore: quartzOreTile,
	nether_bricks: netherBricksTile,
	magma_block: magmaTile,
	farmland_dry_top: farmlandTopTile(false, 791),
	farmland_wet_top: farmlandTopTile(true, 796),
	farmland_side: farmlandSideTile,
	farmland_bottom: farmlandBottomTile,
	...cropStageGenerators(),
	enchanting_table_top: enchantingTableTopTile,
	enchanting_table_side: enchantingTableSideTile,
	enchanting_table_bottom: enchantingTableBottomTile,
	bookshelf: bookshelfTile,
	gravel_path: gravelPathTile,
	cobblestone_wall: cobblestoneWallTile,
	hay_block_top: hayBlockTopTile,
	hay_block_side: hayBlockSideTile,
	hay_block_bottom: hayBlockBottomTile,
	fence: fenceTile,
	fence_gate: fenceGateTile,
}
