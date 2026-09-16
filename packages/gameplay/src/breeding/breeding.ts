import {
	BREEDING,
	BREED_FOOD,
	EVENT_V2,
	hashU32,
	type EntityId,
	type EventBusV2,
	type ItemId,
	type MobType,
	type Vec3f,
} from '@voxelcraft/core-types'
import { XP_SOURCE, grantXpFrom, type XpState } from '../experience'

/**
 * Breeding rules and state.
 *
 * Rules and state only: movement, pathing and mob AI stay in the sim package,
 * so nothing here imports `@voxelcraft/sim` or `@voxelcraft/world`. Callers
 * feed animals, tick the herd and read `scaleOf` / `speedFactorOf` when they
 * present a baby.
 *
 * Every number comes from the frozen `BREEDING` contract, and a baby id is a
 * pure hash of the seed, both parents and the birth counter, so a herd replays
 * identically.
 */

/** Salt for the baby id hash, keeping it off every other RNG stream. */
const BABY_ID_SALT = 0x62726564

/** Baby ids are allocated deterministically inside this half-open range. */
export const BABY_ID_BASE = 1_000_000
export const BABY_ID_SPAN = 1_000_000

/** A breedable animal. Position is owned by the sim, the rest by this module. */
export interface Animal {
	id: EntityId
	mob: MobType
	x: number
	y: number
	z: number
	baby: boolean
	ageTicks: number
	loveTicks: number
	cooldownTicks: number
}

/** Everything but the counters, which default to a fresh adult. */
export interface AnimalInit {
	id: EntityId
	mob: MobType
	x: number
	y: number
	z: number
	baby?: boolean
	ageTicks?: number
	loveTicks?: number
	cooldownTicks?: number
}

export interface Herd {
	/** Insertion ordered, which is what makes pairing deterministic. */
	animals: Map<EntityId, Animal>
	/** Successful breedings so far. Part of the baby id hash. */
	births: number
}

export interface BreedOptions {
	seed: number
	xpState?: XpState | null
	bus?: EventBusV2 | null
}

export interface BreedResult {
	parentA: Animal
	parentB: Animal
	baby: Animal
	at: Vec3f
	/** Experience granted, 0 when no xp state was passed. */
	xpGained: number
}

export function createHerd(): Herd {
	return { animals: new Map<EntityId, Animal>(), births: 0 }
}

/** Adds an animal and returns it. Ids must be unique inside a herd. */
export function addAnimal(herd: Herd, init: AnimalInit): Animal {
	if (herd.animals.has(init.id)) {
		throw new Error(`duplicate animal id: ${String(init.id)}`)
	}
	const animal: Animal = {
		id: init.id,
		mob: init.mob,
		x: init.x,
		y: init.y,
		z: init.z,
		baby: init.baby ?? false,
		ageTicks: init.ageTicks ?? 0,
		loveTicks: init.loveTicks ?? 0,
		cooldownTicks: init.cooldownTicks ?? 0,
	}
	herd.animals.set(animal.id, animal)
	return animal
}

export function getAnimal(herd: Herd, id: EntityId): Animal | undefined {
	return herd.animals.get(id)
}

export function removeAnimal(herd: Herd, id: EntityId): boolean {
	return herd.animals.delete(id)
}

/** Herd members in insertion order. */
export function listAnimals(herd: Herd): readonly Animal[] {
	return [...herd.animals.values()]
}

/** Foods that put a species into love mode, empty for non-breedable mobs. */
export function breedFoodFor(mob: MobType): readonly ItemId[] {
	return BREED_FOOD[mob] ?? []
}

export function isBreedFood(mob: MobType, itemId: ItemId): boolean {
	return breedFoodFor(mob).includes(itemId)
}

/** True for a breedable adult that is off cooldown, so it can be fed. */
export function canBreed(herd: Herd, id: EntityId): boolean {
	const animal = herd.animals.get(id)
	if (animal === undefined) return false
	if (animal.baby) return false
	if (animal.cooldownTicks > 0) return false
	return breedFoodFor(animal.mob).length > 0
}

export function isInLove(animal: Animal): boolean {
	return !animal.baby && animal.loveTicks > 0
}

/** Feeds an item to an animal, setting `BREEDING.loveTicks` on success. */
export function feed(herd: Herd, id: EntityId, itemId: ItemId): boolean {
	const animal = herd.animals.get(id)
	if (animal === undefined) return false
	if (!canBreed(herd, id)) return false
	if (!isBreedFood(animal.mob, itemId)) return false
	animal.loveTicks = BREEDING.loveTicks
	return true
}

/** Squared distance, so the radius check never needs a square root. */
function distanceSq(a: Animal, b: Animal): number {
	const dx = a.x - b.x
	const dy = a.y - b.y
	const dz = a.z - b.z
	return dx * dx + dy * dy + dz * dz
}

/**
 * `BREEDING.partnerRadius` is inclusive: a partner exactly 8 blocks away is
 * still a partner, 9 blocks away is not.
 */
export function withinPartnerRadius(a: Animal, b: Animal): boolean {
	return distanceSq(a, b) <= BREEDING.partnerRadius * BREEDING.partnerRadius
}

/** First in-love partner of the same species in range, insertion ordered. */
export function findPartner(herd: Herd, id: EntityId): Animal | null {
	const animal = herd.animals.get(id)
	if (animal === undefined) return null
	if (!isInLove(animal) || animal.cooldownTicks > 0) return null
	for (const other of herd.animals.values()) {
		if (other.id === animal.id) continue
		if (other.mob !== animal.mob) continue
		if (!isInLove(other) || other.cooldownTicks > 0) continue
		if (!withinPartnerRadius(animal, other)) continue
		return other
	}
	return null
}

/** Hashed baby id, probed upwards while an id is already taken. */
function babyIdFor(herd: Herd, seed: number, parentA: EntityId, parentB: EntityId): EntityId {
	const hash = hashU32(seed, BABY_ID_SALT, parentA, parentB, herd.births)
	for (let probe = 0; probe < BABY_ID_SPAN; probe++) {
		const id = BABY_ID_BASE + ((hash + probe) % BABY_ID_SPAN)
		if (!herd.animals.has(id)) return id
	}
	throw new Error('no free baby id left in the herd')
}

/** Midpoint of both parents: where the baby is born. */
function midpoint(a: Animal, b: Animal): Vec3f {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
}

function breedPair(
	herd: Herd,
	parentA: Animal,
	parentB: Animal,
	options: BreedOptions,
): BreedResult {
	const at = midpoint(parentA, parentB)
	const baby: Animal = {
		id: babyIdFor(herd, options.seed, parentA.id, parentB.id),
		mob: parentA.mob,
		x: at.x,
		y: at.y,
		z: at.z,
		baby: true,
		ageTicks: 0,
		loveTicks: 0,
		cooldownTicks: 0,
	}
	herd.animals.set(baby.id, baby)
	herd.births += 1

	parentA.loveTicks = 0
	parentB.loveTicks = 0
	parentA.cooldownTicks = BREEDING.cooldownTicks
	parentB.cooldownTicks = BREEDING.cooldownTicks

	const xpState = options.xpState ?? null
	const xpGained = xpState === null ? 0 : grantXpFrom(xpState, XP_SOURCE.Breed).gained

	options.bus?.emit(EVENT_V2.EntityBred, {
		parentA: parentA.id,
		parentB: parentB.id,
		baby: baby.id,
		at,
	})

	return { parentA, parentB, baby, at, xpGained }
}

/**
 * Breeds the first pair of in-love adults of one species within
 * `BREEDING.partnerRadius`, or returns null when no pair qualifies.
 */
export function tryBreed(herd: Herd, options: BreedOptions): BreedResult | null {
	for (const animal of herd.animals.values()) {
		const partner = findPartner(herd, animal.id)
		if (partner === null) continue
		return breedPair(herd, animal, partner, options)
	}
	return null
}

/**
 * Ages the herd by `ticks`: love and cooldown count down, and a baby becomes
 * an adult on the tick it reaches `BREEDING.babyGrowTicks`. Returns the
 * animals that grew up during this call.
 */
export function tickHerd(herd: Herd, ticks: number, bus?: EventBusV2 | null): readonly Animal[] {
	const step = Number.isFinite(ticks) && ticks > 0 ? Math.floor(ticks) : 0
	if (step === 0) return []
	const grown: Animal[] = []
	for (const animal of herd.animals.values()) {
		animal.ageTicks += step
		animal.loveTicks = animal.loveTicks > step ? animal.loveTicks - step : 0
		animal.cooldownTicks = animal.cooldownTicks > step ? animal.cooldownTicks - step : 0
		if (animal.baby && animal.ageTicks >= BREEDING.babyGrowTicks) {
			animal.baby = false
			grown.push(animal)
			bus?.emit(EVENT_V2.EntityGrown, { entity: animal.id, mob: animal.mob })
		}
	}
	return grown
}

/** `BREEDING.babyScale` for a baby, 1 for an adult. */
export function scaleOf(animal: Animal): number {
	return animal.baby ? BREEDING.babyScale : 1
}

/** Babies move `BREEDING.babySpeedFactor` times as fast as their parents. */
export function speedFactorOf(animal: Animal, baseSpeed: number): number {
	return animal.baby ? baseSpeed * BREEDING.babySpeedFactor : baseSpeed
}
