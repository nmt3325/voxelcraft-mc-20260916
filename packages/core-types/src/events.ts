import type { BlockId, EntityId, Vec3f, Vec3i } from './ids'
import type { ItemStack } from './items'
import type { MobType } from './mob'
import type { BlockEntityData } from './blockEntity'

/** Canonical event names. Adding or renaming one is a contract change (L0 only). */
export const EVENT = {
	BlockChanged: 'block.changed',
	ChunkGenerated: 'chunk.generated',
	ChunkMeshed: 'chunk.meshed',
	ChunkUnloaded: 'chunk.unloaded',
	LightUpdated: 'light.updated',
	FluidChanged: 'fluid.changed',
	RedstonePowerChanged: 'redstone.powerChanged',
	BlockEntityUpdated: 'blockEntity.updated',
	EntitySpawned: 'entity.spawned',
	EntityDamaged: 'entity.damaged',
	EntityDied: 'entity.died',
	ItemDropped: 'item.dropped',
	ItemPickedUp: 'item.pickedUp',
	InventoryChanged: 'inventory.changed',
	RecipeCrafted: 'recipe.crafted',
	PlayerRespawned: 'player.respawned',
	WorldSaved: 'world.saved',
	WorldLoaded: 'world.loaded',
	SoundPlay: 'sound.play',
	SettingsChanged: 'settings.changed',
} as const
export type EventName = (typeof EVENT)[keyof typeof EVENT]

export interface EventPayloads {
	'block.changed': { x: number; y: number; z: number; before: BlockId; after: BlockId }
	'chunk.generated': { cx: number; cz: number; ms: number }
	'chunk.meshed': { cx: number; cz: number; sy: number; quads: number; ms: number }
	'chunk.unloaded': { cx: number; cz: number }
	'light.updated': { cx: number; cz: number; sectionMask: number }
	'fluid.changed': { x: number; y: number; z: number; packed: number }
	'redstone.powerChanged': { x: number; y: number; z: number; power: number }
	'blockEntity.updated': { x: number; y: number; z: number; data: BlockEntityData }
	'entity.spawned': { entity: EntityId; mob: MobType; at: Vec3f }
	'entity.damaged': { entity: EntityId; amount: number; source: EntityId | null }
	'entity.died': { entity: EntityId; at: Vec3f }
	'item.dropped': { stack: ItemStack; at: Vec3f }
	'item.pickedUp': { stack: ItemStack; entity: EntityId }
	'inventory.changed': { slot: number }
	'recipe.crafted': { recipeId: string; result: ItemStack }
	'player.respawned': { at: Vec3i }
	'world.saved': { worldId: string; chunks: number; ms: number }
	'world.loaded': { worldId: string; seed: number }
	'sound.play': { name: string; at: Vec3f | null; volume: number; pitch: number }
	'settings.changed': { key: string }
}

export interface EventBus {
	on<K extends EventName>(name: K, fn: (payload: EventPayloads[K]) => void): () => void
	emit<K extends EventName>(name: K, payload: EventPayloads[K]): void
	clear(): void
}
