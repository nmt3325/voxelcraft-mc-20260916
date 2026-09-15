import type { EntityId, ItemId, Vec3f } from './ids'

export const MOB = {
	Pig: 0,
	Cow: 1,
	Sheep: 2,
	Chicken: 3,
	Zombie: 4,
	Skeleton: 5,
	Creeper: 6,
	Spider: 7,
} as const
export type MobType = (typeof MOB)[keyof typeof MOB]

export interface MobDrop {
	item: ItemId
	min: number
	max: number
	chance: number
}

export interface MobDef {
	type: MobType
	name: string
	displayName: string
	hostile: boolean
	maxHealth: number
	width: number
	height: number
	/** Blocks per second. */
	speed: number
	attackDamage: number
	attackReach: number
	attackCooldownTicks: number
	/** Spawns only where block light is at most this value. */
	spawnMaxBlockLight: number
	spawnGroupMin: number
	spawnGroupMax: number
	drops: readonly MobDrop[]
	ranged: boolean
	explodes: boolean
	canClimb: boolean
}

export const AI_STATE = {
	Idle: 'idle',
	Wander: 'wander',
	Chase: 'chase',
	Attack: 'attack',
	Flee: 'flee',
	Fuse: 'fuse',
	Dead: 'dead',
} as const
export type AiState = (typeof AI_STATE)[keyof typeof AI_STATE]

export const MOB_SPAWN = {
	minDistance: 24,
	maxDistance: 96,
	despawnDistance: 128,
	mobCapHostile: 70,
	mobCapPassive: 10,
	attemptsPerTick: 8,
	/** Hysteresis: start chasing at 16, give up at 24. */
	chaseStartDistance: 16,
	chaseStopDistance: 24,
} as const

export interface Projectile {
	owner: EntityId
	velocity: Vec3f
	damage: number
	gravity: number
	lifeTicks: number
}

export const COMBAT = {
	invulnerableTicks: 10,
	arrowDamage: 4,
	arrowSpeed: 30,
	arrowGravity: 20,
	creeperFuseTicks: 30,
	creeperRadius: 3,
	creeperDamage: 22,
	playerMaxHealth: 20,
	regenIntervalTicks: 80,
} as const
