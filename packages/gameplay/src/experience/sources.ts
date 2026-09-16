import {
	BLOCK,
	BLOCK_V2,
	XP,
	type BlockId,
	type MobType,
} from '@voxelcraft/core-types'
import { XP_SOURCE, xpForSource } from './xp'
import { spawnOrb, type OrbPool, type XpOrb } from './orbs'

/**
 * Where experience comes from: breaking ore, killing a mob, taking a smelted
 * result out of a furnace and breeding a pair of animals.
 *
 * The amounts themselves live in the frozen contract (`XP.oreDrop`,
 * `XP.mobDrop`, `XP.smeltDrop`, `BREEDING.xpOnBreed`); this module only maps
 * game events onto them and spawns the orb, so callers never hard-code a
 * number.
 */

/** Blocks that release experience when broken: every ore, v1 and v2. */
export const XP_ORE_BLOCKS: readonly BlockId[] = Object.freeze([
	BLOCK.COAL_ORE,
	BLOCK.IRON_ORE,
	BLOCK.GOLD_ORE,
	BLOCK.DIAMOND_ORE,
	BLOCK.REDSTONE_ORE,
	BLOCK.LAPIS_ORE,
	BLOCK_V2.QUARTZ_ORE,
])

const ORE_BLOCK_SET: ReadonlySet<BlockId> = new Set(XP_ORE_BLOCKS)

export function isOreBlock(id: BlockId): boolean {
	return ORE_BLOCK_SET.has(id)
}

export interface BlockBreakXpOptions {
	/**
	 * Silk Touch moves the ore itself into the inventory instead of smelting it
	 * later, so it releases no experience. The enchanting module passes this in;
	 * this module deliberately does not depend on it.
	 */
	silkTouch?: boolean
}

/** `XP.oreDrop` for an ore, 0 for every other block or with Silk Touch. */
export function xpForBlockBreak(id: BlockId, options: BlockBreakXpOptions = {}): number {
	if (options.silkTouch === true) return 0
	return isOreBlock(id) ? xpForSource(XP_SOURCE.OreBreak) : 0
}

/** Every mob drops the same `XP.mobDrop`; hostility does not change it. */
export function xpForMobKill(_mob: MobType): number {
	return xpForSource(XP_SOURCE.MobKill)
}

/** `XP.smeltDrop` per item collected from the furnace output slot. */
export function xpForSmelt(items = 1): number {
	return xpForSource(XP_SOURCE.Smelt, items)
}

/** `BREEDING.xpOnBreed`, granted once per successful breeding. */
export function xpForBreeding(): number {
	return xpForSource(XP_SOURCE.Breed)
}

export interface XpDrop {
	/** Experience released, 0 when this event grants none. */
	amount: number
	/** The orb the experience landed in, or null when nothing was released. */
	orb: XpOrb | null
}

function drop(pool: OrbPool, x: number, y: number, z: number, amount: number): XpDrop {
	if (amount <= 0) return { amount: 0, orb: null }
	return { amount, orb: spawnOrb(pool, x, y, z, amount) }
}

export function dropBlockBreakXp(
	pool: OrbPool,
	x: number,
	y: number,
	z: number,
	id: BlockId,
	options: BlockBreakXpOptions = {},
): XpDrop {
	return drop(pool, x, y, z, xpForBlockBreak(id, options))
}

export function dropMobKillXp(
	pool: OrbPool,
	x: number,
	y: number,
	z: number,
	mob: MobType,
): XpDrop {
	return drop(pool, x, y, z, xpForMobKill(mob))
}

export function dropSmeltXp(
	pool: OrbPool,
	x: number,
	y: number,
	z: number,
	items = 1,
): XpDrop {
	return drop(pool, x, y, z, xpForSmelt(items))
}

export function dropBreedingXp(pool: OrbPool, x: number, y: number, z: number): XpDrop {
	return drop(pool, x, y, z, xpForBreeding())
}

/** Sanity guard for the frozen amounts, used by the tests and by debug tools. */
export const XP_AMOUNTS = Object.freeze({
	ore: XP.oreDrop,
	mob: XP.mobDrop,
	smelt: XP.smeltDrop,
})
