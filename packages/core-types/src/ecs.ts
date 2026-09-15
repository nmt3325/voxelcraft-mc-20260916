import type { EntityId, Tick } from './ids'

export type ComponentId = number

export interface ComponentType<T> {
	readonly id: ComponentId
	readonly name: string
	readonly create: () => T
}

/**
 * Sparse-set ECS. Structural changes made during a query are buffered and
 * applied by flush() at the end of the tick to keep iteration order stable.
 */
export interface EcsWorld {
	create(): EntityId
	destroy(e: EntityId): void
	alive(e: EntityId): boolean
	add<T>(e: EntityId, c: ComponentType<T>, value: T): void
	get<T>(e: EntityId, c: ComponentType<T>): T | undefined
	has(e: EntityId, c: ComponentType<unknown>): boolean
	remove(e: EntityId, c: ComponentType<unknown>): void
	/** Ascending entity index order. Stable and deterministic. */
	query(components: readonly ComponentType<unknown>[]): readonly EntityId[]
	flush(): void
	readonly entityCount: number
}

export type SystemFn = (world: EcsWorld, dt: number, tick: Tick) => void

export interface SystemEntry {
	name: string
	fn: SystemFn
}

/** Array order is execution order and is frozen by the contract. */
export interface Schedule {
	readonly systems: readonly SystemEntry[]
}

export const SYSTEM_ORDER: readonly string[] = [
	'input',
	'fluid',
	'light',
	'redstone',
	'blockEntity',
	'mobSpawn',
	'mobAi',
	'physics',
	'combat',
	'projectile',
	'itemPickup',
	'despawn',
	'persist',
]
