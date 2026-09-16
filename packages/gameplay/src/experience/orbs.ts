import { XP, type EventBusV2 } from '@voxelcraft/core-types'
import { grantXp, type XpGrant, type XpState } from './xp'

/**
 * Experience orbs: merging, pickup and expiry.
 *
 * The pool is plain data and every operation is deterministic - ids are handed
 * out in spawn order and merging walks the list in order - so a replayed tick
 * sequence produces exactly the same orbs. Movement is not simulated here; the
 * sim package owns motion and only calls into this module.
 */
export interface XpOrb {
	id: number
	x: number
	y: number
	z: number
	/** Experience carried by this orb. */
	amount: number
	ageTicks: number
}

export interface OrbPool {
	orbs: XpOrb[]
	/** Next id to hand out. Spawn order, so replays match. */
	nextId: number
}

export function createOrbPool(orbs: readonly XpOrb[] = []): OrbPool {
	const copies = orbs.map((orb) => ({ ...orb }))
	let max = 0
	for (const orb of copies) if (orb.id > max) max = orb.id
	return { orbs: copies, nextId: max + 1 }
}

function distanceSq(orb: XpOrb, x: number, y: number, z: number): number {
	const dx = orb.x - x
	const dy = orb.y - y
	const dz = orb.z - z
	return dx * dx + dy * dy + dz * dz
}

function wholeXp(amount: number): number {
	if (!Number.isFinite(amount) || amount <= 0) return 0
	return Math.floor(amount)
}

/**
 * Spawns `amount` experience at a position. When an orb already sits inside
 * `XP.orbMergeRadius` the experience is absorbed by the closest one instead of
 * creating a second entity, and that orb's lifetime restarts.
 */
export function spawnOrb(
	pool: OrbPool,
	x: number,
	y: number,
	z: number,
	amount: number,
): XpOrb | null {
	const value = wholeXp(amount)
	if (value <= 0) return null
	const radiusSq = XP.orbMergeRadius * XP.orbMergeRadius
	let best: XpOrb | null = null
	let bestDistance = Number.POSITIVE_INFINITY
	for (const orb of pool.orbs) {
		const distance = distanceSq(orb, x, y, z)
		if (distance > radiusSq || distance >= bestDistance) continue
		best = orb
		bestDistance = distance
	}
	if (best !== null) {
		best.amount += value
		best.ageTicks = 0
		return best
	}
	const orb: XpOrb = { id: pool.nextId, x, y, z, amount: value, ageTicks: 0 }
	pool.nextId += 1
	pool.orbs.push(orb)
	return orb
}

/**
 * Collapses a list of orbs, folding every orb into the first kept orb inside
 * the merge radius. Input orbs are never mutated; the merged orb keeps the
 * lowest id and the youngest age, so it lives as long as its newest part.
 */
export function mergeOrbs(orbs: readonly XpOrb[]): XpOrb[] {
	const radiusSq = XP.orbMergeRadius * XP.orbMergeRadius
	const out: XpOrb[] = []
	for (const orb of orbs) {
		let target: XpOrb | null = null
		for (const candidate of out) {
			if (distanceSq(candidate, orb.x, orb.y, orb.z) > radiusSq) continue
			target = candidate
			break
		}
		if (target === null) {
			out.push({ ...orb })
			continue
		}
		target.amount += orb.amount
		target.id = Math.min(target.id, orb.id)
		target.ageTicks = Math.min(target.ageTicks, orb.ageTicks)
	}
	return out
}

/** Ages every orb and removes those past `XP.orbLifetimeTicks`. */
export function tickOrbs(pool: OrbPool, ticks = 1): XpOrb[] {
	const step = Number.isFinite(ticks) && ticks > 0 ? Math.floor(ticks) : 0
	if (step === 0) return []
	const expired: XpOrb[] = []
	const kept: XpOrb[] = []
	for (const orb of pool.orbs) {
		orb.ageTicks += step
		if (orb.ageTicks >= XP.orbLifetimeTicks) expired.push(orb)
		else kept.push(orb)
	}
	pool.orbs = kept
	return expired
}

export interface OrbPickup {
	/** Experience added to the player. */
	collected: number
	/** The orbs that were removed from the pool. */
	orbs: XpOrb[]
	grant: XpGrant
}

/**
 * Picks up every orb inside `XP.orbPickupRadius` and grants the experience in
 * one go, so a cluster of orbs produces a single `xp.changed` event.
 */
export function collectOrbs(
	pool: OrbPool,
	x: number,
	y: number,
	z: number,
	state: XpState,
	bus?: EventBusV2 | null,
): OrbPickup {
	const radiusSq = XP.orbPickupRadius * XP.orbPickupRadius
	const picked: XpOrb[] = []
	const kept: XpOrb[] = []
	for (const orb of pool.orbs) {
		if (distanceSq(orb, x, y, z) <= radiusSq) picked.push(orb)
		else kept.push(orb)
	}
	pool.orbs = kept
	let collected = 0
	for (const orb of picked) collected += orb.amount
	const grant = grantXp(state, collected, bus)
	return { collected, orbs: picked, grant }
}

export function orbsInRadius(
	pool: OrbPool,
	x: number,
	y: number,
	z: number,
	radius: number,
): XpOrb[] {
	const radiusSq = radius * radius
	return pool.orbs.filter((orb) => distanceSq(orb, x, y, z) <= radiusSq)
}

export function orbCount(pool: OrbPool): number {
	return pool.orbs.length
}

export function totalOrbXp(pool: OrbPool): number {
	let total = 0
	for (const orb of pool.orbs) total += orb.amount
	return total
}
