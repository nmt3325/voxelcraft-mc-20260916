/**
 * The eight v1 mobs, one `MobDef` per frozen `MOB` id.
 *
 * Per species stats (health, size, speed, melee damage) live in `MobDef` by
 * design: the contract deliberately ships the *shape* of a mob definition and
 * not a table of numbers. Everything that is shared between mobs still comes
 * from the contract and is never redefined here:
 *  - caps, spawn distances and chase distances: `MOB_SPAWN`,
 *  - creeper fuse / radius / damage and arrow damage: `COMBAT`,
 *  - the tick rate used for cooldowns: `PERF.simTickHz`,
 *  - the maximum light level: `MAX_LIGHT`,
 *  - drops: `ITEM` / `BLOCK` ids.
 */
import { BLOCK, COMBAT, ITEM, MAX_LIGHT, MOB, MOB_SPAWN, PERF } from '@voxelcraft/core-types'
import type { AgentShape, MobDef, MobType } from '@voxelcraft/core-types'
import { pathShape } from '../pathfind/moves'

/** Passive mobs do not care about darkness. */
const PASSIVE_LIGHT = MAX_LIGHT
/** Hostile mobs need pitch black block light. */
const HOSTILE_LIGHT = 0
/** One second of ticks: the melee swing rate. */
const SWING_TICKS = PERF.simTickHz

/** Indexed by `MobType`, so `MOB_DEFS[MOB.Creeper]` is the creeper. */
export const MOB_DEFS: readonly MobDef[] = [
	{
		type: MOB.Pig,
		name: 'pig',
		displayName: 'Pig',
		hostile: false,
		maxHealth: 10,
		width: 0.9,
		height: 0.9,
		speed: 3.5,
		attackDamage: 0,
		attackReach: 0,
		attackCooldownTicks: 0,
		spawnMaxBlockLight: PASSIVE_LIGHT,
		spawnGroupMin: 3,
		spawnGroupMax: 4,
		drops: [{ item: ITEM.RAW_PORK, min: 1, max: 3, chance: 1 }],
		ranged: false,
		explodes: false,
		canClimb: false,
	},
	{
		type: MOB.Cow,
		name: 'cow',
		displayName: 'Cow',
		hostile: false,
		maxHealth: 10,
		width: 0.9,
		height: 1.4,
		speed: 3.4,
		attackDamage: 0,
		attackReach: 0,
		attackCooldownTicks: 0,
		spawnMaxBlockLight: PASSIVE_LIGHT,
		spawnGroupMin: 3,
		spawnGroupMax: 4,
		drops: [
			{ item: ITEM.RAW_BEEF, min: 1, max: 3, chance: 1 },
			{ item: ITEM.LEATHER, min: 0, max: 2, chance: 1 },
		],
		ranged: false,
		explodes: false,
		canClimb: false,
	},
	{
		type: MOB.Sheep,
		name: 'sheep',
		displayName: 'Sheep',
		hostile: false,
		maxHealth: 8,
		width: 0.9,
		height: 1.3,
		speed: 3.4,
		attackDamage: 0,
		attackReach: 0,
		attackCooldownTicks: 0,
		spawnMaxBlockLight: PASSIVE_LIGHT,
		spawnGroupMin: 3,
		spawnGroupMax: 4,
		drops: [
			{ item: ITEM.RAW_MUTTON, min: 1, max: 2, chance: 1 },
			{ item: BLOCK.WOOL, min: 1, max: 1, chance: 1 },
		],
		ranged: false,
		explodes: false,
		canClimb: false,
	},
	{
		type: MOB.Chicken,
		name: 'chicken',
		displayName: 'Chicken',
		hostile: false,
		maxHealth: 4,
		width: 0.4,
		height: 0.7,
		speed: 3,
		attackDamage: 0,
		attackReach: 0,
		attackCooldownTicks: 0,
		spawnMaxBlockLight: PASSIVE_LIGHT,
		spawnGroupMin: 3,
		spawnGroupMax: 4,
		drops: [
			{ item: ITEM.RAW_CHICKEN, min: 1, max: 1, chance: 1 },
			{ item: ITEM.FEATHER, min: 0, max: 2, chance: 1 },
		],
		ranged: false,
		explodes: false,
		canClimb: false,
	},
	{
		type: MOB.Zombie,
		name: 'zombie',
		displayName: 'Zombie',
		hostile: true,
		maxHealth: 20,
		width: 0.6,
		height: 1.95,
		speed: 3.7,
		attackDamage: 3,
		attackReach: 1.5,
		attackCooldownTicks: SWING_TICKS,
		spawnMaxBlockLight: HOSTILE_LIGHT,
		spawnGroupMin: 1,
		spawnGroupMax: 4,
		drops: [{ item: ITEM.ROTTEN_FLESH, min: 0, max: 2, chance: 1 }],
		ranged: false,
		explodes: false,
		canClimb: false,
	},
	{
		type: MOB.Skeleton,
		name: 'skeleton',
		displayName: 'Skeleton',
		hostile: true,
		maxHealth: 20,
		width: 0.6,
		height: 1.99,
		speed: 3.7,
		// The arrow carries the damage; the def mirrors `COMBAT.arrowDamage` so
		// tooltips and the AI agree instead of hard coding a second number.
		attackDamage: COMBAT.arrowDamage,
		// Bow range: the distance at which a hostile mob starts chasing.
		attackReach: MOB_SPAWN.chaseStartDistance,
		attackCooldownTicks: SWING_TICKS * 1.5,
		spawnMaxBlockLight: HOSTILE_LIGHT,
		spawnGroupMin: 1,
		spawnGroupMax: 4,
		drops: [
			{ item: ITEM.BONE, min: 0, max: 2, chance: 1 },
			{ item: ITEM.ARROW, min: 0, max: 2, chance: 1 },
		],
		ranged: true,
		explodes: false,
		canClimb: false,
	},
	{
		type: MOB.Creeper,
		name: 'creeper',
		displayName: 'Creeper',
		hostile: true,
		maxHealth: 20,
		width: 0.6,
		height: 1.7,
		speed: 3.5,
		attackDamage: COMBAT.creeperDamage,
		// Lighting the fuse and the blast share one radius.
		attackReach: COMBAT.creeperRadius,
		attackCooldownTicks: COMBAT.creeperFuseTicks,
		spawnMaxBlockLight: HOSTILE_LIGHT,
		spawnGroupMin: 1,
		spawnGroupMax: 2,
		drops: [{ item: ITEM.GUNPOWDER, min: 0, max: 2, chance: 1 }],
		ranged: false,
		explodes: true,
		canClimb: false,
	},
	{
		type: MOB.Spider,
		name: 'spider',
		displayName: 'Spider',
		hostile: true,
		maxHealth: 16,
		width: 1.4,
		height: 0.9,
		speed: 4.2,
		attackDamage: 2,
		attackReach: 1.5,
		attackCooldownTicks: SWING_TICKS,
		spawnMaxBlockLight: HOSTILE_LIGHT,
		spawnGroupMin: 1,
		spawnGroupMax: 2,
		drops: [{ item: ITEM.STRING, min: 0, max: 2, chance: 1 }],
		ranged: false,
		explodes: false,
		canClimb: true,
	},
]

/** Spawn / iteration order. Fixed, because spawning picks from it with an rng. */
export const MOB_TYPES: readonly MobType[] = MOB_DEFS.map((def) => def.type)

export function mobDefOf(type: MobType): MobDef {
	const def = MOB_DEFS[type]
	if (def === undefined) throw new Error(`unknown mob type ${String(type)}`)
	return def
}

export function mobIsHostile(type: MobType): boolean {
	return mobDefOf(type).hostile
}

/** Navigation envelope of a mob: body size plus the derived jump / fall limits. */
export function mobShapeOf(def: MobDef): AgentShape {
	return pathShape(def.width, def.height)
}

/** Eye height used for line of sight and for spawning arrows. */
export function mobEyeHeight(def: MobDef): number {
	return def.height * 0.85
}
