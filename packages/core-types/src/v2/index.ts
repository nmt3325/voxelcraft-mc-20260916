/**
 * v2 contract barrel. Everything here is additive: v1 ids, events and codecs
 * keep their meaning so v1 saves and v1 packages stay valid.
 */
import type { EntityId, Vec3f, Vec3i } from '../ids'
import type { ItemStack } from '../items'
import type { MobType } from '../mob'
import type { EventName, EventPayloads } from '../events'
import type { DimensionId, StructureKind } from './world2'
import type { EnchantmentId, ParticleId } from './gameplay2'

export * from './world2'
export * from './gameplay2'
export * from './net'

/** Bumped together with CONTRACT_VERSION when the v2 surface changes. */
export const CONTRACT_V2_VERSION = '1.1.0'

/** Event names added in v2. The v1 EVENT map stays frozen. */
export const EVENT_V2 = {
	DimensionChanged: 'dimension.changed',
	PortalUsed: 'portal.used',
	CropGrown: 'crop.grown',
	EntityBred: 'entity.bred',
	EntityGrown: 'entity.grown',
	ParticleSpawn: 'particle.spawn',
	VillageGenerated: 'village.generated',
	EnchantApplied: 'enchant.applied',
	XpChanged: 'xp.changed',
	NetConnected: 'net.connected',
	NetDisconnected: 'net.disconnected',
	NetSnapshot: 'net.snapshot',
} as const
export type EventV2Name = (typeof EVENT_V2)[keyof typeof EVENT_V2]

export interface EventV2Payloads {
	'dimension.changed': {
		entity: EntityId
		from: DimensionId
		to: DimensionId
		at: Vec3f
	}
	'portal.used': { entity: EntityId; at: Vec3i }
	'crop.grown': { x: number; y: number; z: number; stage: number }
	'entity.bred': { parentA: EntityId; parentB: EntityId; baby: EntityId; at: Vec3f }
	'entity.grown': { entity: EntityId; mob: MobType }
	'particle.spawn': { kind: ParticleId; x: number; y: number; z: number; count: number }
	'village.generated': {
		regionX: number
		regionZ: number
		pieces: number
		kinds: readonly StructureKind[]
	}
	'enchant.applied': {
		item: ItemStack
		enchantment: EnchantmentId
		level: number
		cost: number
	}
	'xp.changed': { total: number; level: number }
	'net.connected': { playerId: EntityId; name: string }
	'net.disconnected': { playerId: EntityId; reason: string }
	'net.snapshot': { tick: number; entities: number; bytes: number }
}

/** Every event name a v2 build may emit. */
export type AnyEventName = EventName | EventV2Name
export type AnyEventPayloads = EventPayloads & EventV2Payloads

/**
 * Superset of EventBus that also carries v2 names. A v1 EventBus instance is
 * assignable to code that only emits v1 names, so packages can migrate one at
 * a time.
 */
export interface EventBusV2 {
	on<K extends AnyEventName>(name: K, fn: (payload: AnyEventPayloads[K]) => void): () => void
	emit<K extends AnyEventName>(name: K, payload: AnyEventPayloads[K]): void
	clear(): void
}
