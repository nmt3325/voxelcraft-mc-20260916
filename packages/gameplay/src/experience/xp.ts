import {
	BREEDING,
	EVENT_V2,
	XP,
	xpForLevel,
	type EventBusV2,
} from '@voxelcraft/core-types'

/**
 * Experience totals, the level curve and the gains that feed them.
 *
 * The curve itself is frozen in the contract (`xpForLevel` / `levelFromXp`);
 * this module owns the mutable player state, a closed-form reverse lookup for
 * hot paths and the `xp.changed` event, so the HUD bar, the enchanting table
 * and the tests can never disagree about a level.
 */

/** Highest level the enchanting table and the HUD bar account for. */
export const MAX_LEVEL = XP.maxLevel

export interface XpState {
	/** Total experience collected. Never negative. */
	total: number
	/** Always `levelFromXp(total)`, cached so the HUD does not re-derive it. */
	level: number
}

export const XP_SOURCE = {
	OreBreak: 'oreBreak',
	MobKill: 'mobKill',
	Smelt: 'smelt',
	Breed: 'breed',
} as const
export type XpSource = (typeof XP_SOURCE)[keyof typeof XP_SOURCE]

/** Experience for one event of each source, straight from the contract. */
export const XP_SOURCE_AMOUNT: Readonly<Record<XpSource, number>> = {
	[XP_SOURCE.OreBreak]: XP.oreDrop,
	[XP_SOURCE.MobKill]: XP.mobDrop,
	[XP_SOURCE.Smelt]: XP.smeltDrop,
	[XP_SOURCE.Breed]: BREEDING.xpOnBreed,
}

export interface XpGrant {
	state: XpState
	/** Experience actually added. */
	gained: number
	levelsGained: number
	leveledUp: boolean
}

export interface XpSpend {
	state: XpState
	/** Experience points removed from the total. */
	spent: number
	paid: boolean
}

function clampTotal(total: number): number {
	if (!Number.isFinite(total) || total <= 0) return 0
	return Math.floor(total)
}

export function createXpState(total = 0): XpState {
	const xp = clampTotal(total)
	return { total: xp, level: levelFromTotalXp(xp) }
}

/**
 * Closed-form inverse of `xpForLevel`, since that curve is `l^2 + baseCost*l`:
 * `level = floor((sqrt(4*xp + baseCost^2) - baseCost) / 2)`. The two guard
 * loops absorb float error at the boundaries, so the result is identical to
 * the contract's `levelFromXp` for every total.
 */
export function levelFromTotalXp(total: number): number {
	const xp = clampTotal(total)
	const base = XP.baseCost
	let level = Math.floor((Math.sqrt(4 * xp + base * base) - base) / 2)
	if (level < 0) level = 0
	while (level > 0 && xpForLevel(level) > xp) level -= 1
	while (xpForLevel(level + 1) <= xp) level += 1
	return level
}

/** Experience earned inside the current level. */
export function xpInLevel(total: number): number {
	const xp = clampTotal(total)
	return xp - xpForLevel(levelFromTotalXp(xp))
}

/** Experience still needed to reach the next level. */
export function xpToNextLevel(total: number): number {
	const xp = clampTotal(total)
	return xpForLevel(levelFromTotalXp(xp) + 1) - xp
}

/** Fill ratio of the HUD level bar, 0..1. */
export function levelProgress(total: number): number {
	const xp = clampTotal(total)
	const level = levelFromTotalXp(xp)
	const span = xpForLevel(level + 1) - xpForLevel(level)
	if (span <= 0) return 0
	return (xp - xpForLevel(level)) / span
}

/** Experience dropped by `count` events of one source. */
export function xpForSource(source: XpSource, count = 1): number {
	if (!Number.isFinite(count) || count <= 0) return 0
	return XP_SOURCE_AMOUNT[source] * Math.floor(count)
}

function emitChanged(state: XpState, bus?: EventBusV2 | null): void {
	if (bus === undefined || bus === null) return
	bus.emit(EVENT_V2.XpChanged, { total: state.total, level: state.level })
}

/**
 * Adds experience to `state`, mutating and returning it. `xp.changed` is
 * emitted once per grant, never for a zero grant.
 */
export function grantXp(state: XpState, amount: number, bus?: EventBusV2 | null): XpGrant {
	const add = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0
	const before = state.level
	if (add > 0) {
		state.total = clampTotal(state.total + add)
		state.level = levelFromTotalXp(state.total)
		emitChanged(state, bus)
	}
	const levelsGained = state.level - before
	return { state, gained: add, levelsGained, leveledUp: levelsGained > 0 }
}

/** Ore breaking, mob kills, smelting and breeding all come through here. */
export function grantXpFrom(
	state: XpState,
	source: XpSource,
	count = 1,
	bus?: EventBusV2 | null,
): XpGrant {
	return grantXp(state, xpForSource(source, count), bus)
}

export function canAfford(state: XpState, levels: number): boolean {
	const want = Number.isFinite(levels) && levels > 0 ? Math.floor(levels) : 0
	return state.level >= want
}

/**
 * Pays `levels` levels for an enchantment. The progress earned inside the
 * current level is kept, so paying 3 levels at 10 + 3 xp leaves level 7 + 3 xp.
 */
export function spendLevels(
	state: XpState,
	levels: number,
	bus?: EventBusV2 | null,
): XpSpend {
	const want = Number.isFinite(levels) && levels > 0 ? Math.floor(levels) : 0
	if (want === 0) return { state, spent: 0, paid: true }
	if (state.level < want) return { state, spent: 0, paid: false }
	const cost = xpForLevel(state.level) - xpForLevel(state.level - want)
	state.total = clampTotal(state.total - cost)
	state.level = levelFromTotalXp(state.total)
	emitChanged(state, bus)
	return { state, spent: cost, paid: true }
}
