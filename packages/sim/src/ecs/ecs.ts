/**
 * Sparse-set ECS implementing the frozen `EcsWorld` contract.
 *
 * Determinism rules:
 *  - `query` returns a fresh snapshot in ascending entity id order.
 *  - While a query snapshot is live, structural component edits are buffered in
 *    a command buffer and applied by `flush()`, so iteration order can never
 *    shift underneath a running system.
 *  - `create()` applies immediately (a new id cannot change an existing
 *    snapshot) and always reuses the lowest free id, which keeps entity ids
 *    reproducible for replays.
 *  - `get` / `has` report the pre-flush state while buffering, so every system
 *    in a tick observes the same world.
 */
import type { ComponentId, ComponentType, EcsWorld, EntityId } from '@voxelcraft/core-types'

let nextComponentId = 0

/**
 * Registers a component type. Ids are assigned in module import order, which is
 * deterministic and only used as a storage key.
 */
export function defineComponent<T>(name: string, create: () => T): ComponentType<T> {
	return { id: nextComponentId++, name, create }
}

interface Store {
	readonly id: ComponentId
	readonly name: string
	/** entity id -> index into dense/values, -1 when the entity lacks it. */
	sparse: number[]
	dense: EntityId[]
	values: unknown[]
}

type Command =
	| { kind: 'add'; entity: EntityId; store: Store; value: unknown }
	| { kind: 'remove'; entity: EntityId; store: Store }
	| { kind: 'destroy'; entity: EntityId }

export interface SimEcsWorld extends EcsWorld {
	/** True while a query snapshot is live, i.e. structural edits are buffered. */
	readonly deferred: boolean
	readonly pendingCommands: number
	/** Alive entities in ascending id order. */
	entities(): EntityId[]
	/** Number of entities holding a component. */
	countOf(component: ComponentType<unknown>): number
	reset(): void
}

export function createEcsWorld(): SimEcsWorld {
	const stores = new Map<ComponentId, Store>()
	const aliveFlags: boolean[] = []
	const freeIds: number[] = []
	const commands: Command[] = []
	let aliveCount = 0
	let queryDepth = 0

	const heapPush = (value: number): void => {
		freeIds.push(value)
		let i = freeIds.length - 1
		while (i > 0) {
			const parent = (i - 1) >> 1
			if (freeIds[parent] <= freeIds[i]) break
			const swap = freeIds[parent]
			freeIds[parent] = freeIds[i]
			freeIds[i] = swap
			i = parent
		}
	}

	const heapPop = (): number => {
		const top = freeIds[0]
		const last = freeIds.pop() as number
		if (freeIds.length > 0) {
			freeIds[0] = last
			let i = 0
			for (;;) {
				const left = i * 2 + 1
				const right = left + 1
				let best = i
				if (left < freeIds.length && freeIds[left] < freeIds[best]) best = left
				if (right < freeIds.length && freeIds[right] < freeIds[best]) best = right
				if (best === i) break
				const swap = freeIds[best]
				freeIds[best] = freeIds[i]
				freeIds[i] = swap
				i = best
			}
		}
		return top
	}

	const storeOf = (component: ComponentType<unknown>): Store => {
		let store = stores.get(component.id)
		if (!store) {
			store = { id: component.id, name: component.name, sparse: [], dense: [], values: [] }
			stores.set(component.id, store)
		}
		return store
	}

	const slotOf = (store: Store, entity: EntityId): number =>
		entity >= 0 && entity < store.sparse.length ? store.sparse[entity] : -1

	const addNow = (store: Store, entity: EntityId, value: unknown): void => {
		while (store.sparse.length <= entity) store.sparse.push(-1)
		const slot = store.sparse[entity]
		if (slot >= 0) {
			store.values[slot] = value
			return
		}
		store.sparse[entity] = store.dense.length
		store.dense.push(entity)
		store.values.push(value)
	}

	const removeNow = (store: Store, entity: EntityId): void => {
		const slot = slotOf(store, entity)
		if (slot < 0) return
		const lastEntity = store.dense[store.dense.length - 1]
		const lastValue = store.values[store.values.length - 1]
		store.dense[slot] = lastEntity
		store.values[slot] = lastValue
		store.dense.pop()
		store.values.pop()
		store.sparse[lastEntity] = slot
		store.sparse[entity] = -1
	}

	const destroyNow = (entity: EntityId): void => {
		if (!aliveFlags[entity]) return
		for (const store of stores.values()) removeNow(store, entity)
		aliveFlags[entity] = false
		aliveCount--
		heapPush(entity)
	}

	const world: SimEcsWorld = {
		create(): EntityId {
			const entity = freeIds.length > 0 ? heapPop() : aliveFlags.length
			aliveFlags[entity] = true
			aliveCount++
			return entity
		},
		destroy(entity: EntityId): void {
			if (!world.alive(entity)) return
			if (queryDepth > 0) commands.push({ kind: 'destroy', entity })
			else destroyNow(entity)
		},
		alive(entity: EntityId): boolean {
			return entity >= 0 && entity < aliveFlags.length && aliveFlags[entity] === true
		},
		add<T>(entity: EntityId, component: ComponentType<T>, value: T): void {
			if (!world.alive(entity)) return
			const store = storeOf(component as ComponentType<unknown>)
			if (queryDepth > 0) commands.push({ kind: 'add', entity, store, value })
			else addNow(store, entity, value)
		},
		get<T>(entity: EntityId, component: ComponentType<T>): T | undefined {
			const store = stores.get(component.id)
			if (!store) return undefined
			const slot = slotOf(store, entity)
			return slot < 0 ? undefined : (store.values[slot] as T)
		},
		has(entity: EntityId, component: ComponentType<unknown>): boolean {
			const store = stores.get(component.id)
			return store ? slotOf(store, entity) >= 0 : false
		},
		remove(entity: EntityId, component: ComponentType<unknown>): void {
			const store = stores.get(component.id)
			if (!store) return
			if (queryDepth > 0) commands.push({ kind: 'remove', entity, store })
			else removeNow(store, entity)
		},
		query(components: readonly ComponentType<unknown>[]): readonly EntityId[] {
			queryDepth++
			if (components.length === 0) return world.entities()
			const selected: Store[] = []
			let smallest: Store | undefined
			for (const component of components) {
				const store = stores.get(component.id)
				if (!store || store.dense.length === 0) return []
				selected.push(store)
				if (!smallest || store.dense.length < smallest.dense.length) smallest = store
			}
			const pivot = smallest as Store
			const out: EntityId[] = []
			for (const entity of pivot.dense) {
				if (aliveFlags[entity] !== true) continue
				let ok = true
				for (const store of selected) {
					if (store === pivot) continue
					if (slotOf(store, entity) < 0) {
						ok = false
						break
					}
				}
				if (ok) out.push(entity)
			}
			out.sort((a, b) => a - b)
			return out
		},
		flush(): void {
			queryDepth = 0
			if (commands.length === 0) return
			const pending = commands.splice(0, commands.length)
			for (const command of pending) {
				switch (command.kind) {
					case 'add':
						if (world.alive(command.entity)) addNow(command.store, command.entity, command.value)
						break
					case 'remove':
						removeNow(command.store, command.entity)
						break
					case 'destroy':
						destroyNow(command.entity)
						break
				}
			}
		},
		get entityCount(): number {
			return aliveCount
		},
		get deferred(): boolean {
			return queryDepth > 0
		},
		get pendingCommands(): number {
			return commands.length
		},
		entities(): EntityId[] {
			const out: EntityId[] = []
			for (let entity = 0; entity < aliveFlags.length; entity++) {
				if (aliveFlags[entity] === true) out.push(entity)
			}
			return out
		},
		countOf(component: ComponentType<unknown>): number {
			return stores.get(component.id)?.dense.length ?? 0
		},
		reset(): void {
			stores.clear()
			aliveFlags.length = 0
			freeIds.length = 0
			commands.length = 0
			aliveCount = 0
			queryDepth = 0
		},
	}
	return world
}
