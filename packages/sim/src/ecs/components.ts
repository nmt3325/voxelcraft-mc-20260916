/**
 * Components shared across the whole simulation subtree.
 *
 * Mob, path and combat specific components live in their own folders; anything
 * that more than one system family needs (transform, velocity, collider,
 * physics state, health, intent) is declared here so there is exactly one
 * definition of each.
 */
import { COMBAT, PHYSICS } from '@voxelcraft/core-types'
import type { EcsWorld, EntityId } from '@voxelcraft/core-types'
import { defineComponent } from './ecs'

export interface TransformComp {
	x: number
	y: number
	z: number
	/** Radians, 0 = +Z, increasing towards +X. */
	yaw: number
	pitch: number
}
export const Transform = defineComponent<TransformComp>('transform', () => ({
	x: 0,
	y: 0,
	z: 0,
	yaw: 0,
	pitch: 0,
}))

export interface VelocityComp {
	x: number
	y: number
	z: number
}
export const Velocity = defineComponent<VelocityComp>('velocity', () => ({ x: 0, y: 0, z: 0 }))

export interface ColliderComp {
	width: number
	height: number
}
export const Collider = defineComponent<ColliderComp>('collider', () => ({
	width: PHYSICS.playerWidth,
	height: PHYSICS.playerHeight,
}))

export interface PhysicsStateComp {
	onGround: boolean
	inWater: boolean
	inLava: boolean
	steppedUp: boolean
	/** Blocks fallen since leaving the ground; reset on landing. */
	fallDistance: number
	/** Damage from the last landing, consumed by the combat system. */
	pendingFallDamage: number
}
export const PhysicsState = defineComponent<PhysicsStateComp>('physicsState', () => ({
	onGround: false,
	inWater: false,
	inLava: false,
	steppedUp: false,
	fallDistance: 0,
	pendingFallDamage: 0,
}))

/** Movement wish for one tick. Produced by the input system or by mob AI. */
export interface IntentComp {
	/** -1..1 along the facing direction. */
	forward: number
	/** -1..1 to the right of the facing direction. */
	strafe: number
	jump: boolean
	sprint: boolean
	sneak: boolean
	/** Yaw the movement is relative to, radians. */
	yaw: number
}
export const Intent = defineComponent<IntentComp>('intent', () => ({
	forward: 0,
	strafe: 0,
	jump: false,
	sprint: false,
	sneak: false,
	yaw: 0,
}))

export interface HealthComp {
	current: number
	max: number
	/** Remaining ticks of damage immunity (`COMBAT.invulnerableTicks`). */
	invulnerableTicks: number
}
export const Health = defineComponent<HealthComp>('health', () => ({
	current: COMBAT.playerMaxHealth,
	max: COMBAT.playerMaxHealth,
	invulnerableTicks: 0,
}))

export interface PlayerTagComp {
	name: string
}
export const PlayerTag = defineComponent<PlayerTagComp>('playerTag', () => ({ name: 'player' }))

/** Marks an entity for removal by the despawn system. */
export interface DespawnComp {
	reason: 'dead' | 'distance' | 'expired'
	tick: number
}
export const Despawn = defineComponent<DespawnComp>('despawn', () => ({ reason: 'expired', tick: 0 }))

export interface SpawnLivingOptions {
	x: number
	y: number
	z: number
	width?: number
	height?: number
	maxHealth?: number
	yaw?: number
}

/**
 * Creates an entity with the standard physical + living component set.
 * Mob specific components are added by the caller.
 */
export function spawnLivingEntity(world: EcsWorld, options: SpawnLivingOptions): EntityId {
	const entity = world.create()
	const width = options.width ?? PHYSICS.playerWidth
	const height = options.height ?? PHYSICS.playerHeight
	const maxHealth = options.maxHealth ?? COMBAT.playerMaxHealth
	world.add(entity, Transform, {
		x: options.x,
		y: options.y,
		z: options.z,
		yaw: options.yaw ?? 0,
		pitch: 0,
	})
	world.add(entity, Velocity, { x: 0, y: 0, z: 0 })
	world.add(entity, Collider, { width, height })
	world.add(entity, PhysicsState, {
		onGround: false,
		inWater: false,
		inLava: false,
		steppedUp: false,
		fallDistance: 0,
		pendingFallDamage: 0,
	})
	world.add(entity, Health, { current: maxHealth, max: maxHealth, invulnerableTicks: 0 })
	return entity
}
