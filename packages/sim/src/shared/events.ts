/**
 * `EventBus` implementation for the simulation.
 *
 * Listeners fire in registration order and `emit` iterates a copy, so a handler
 * that subscribes or unsubscribes cannot change the order of the current
 * dispatch. That is what keeps a replayed tick observably identical.
 */
import type { EventBus, EventName, EventPayloads } from '@voxelcraft/core-types'

type Listener = (payload: unknown) => void

export function createEventBus(): EventBus {
	const listeners = new Map<EventName, Listener[]>()
	return {
		on<K extends EventName>(name: K, fn: (payload: EventPayloads[K]) => void): () => void {
			const wrapped = fn as Listener
			const list = listeners.get(name)
			if (list) list.push(wrapped)
			else listeners.set(name, [wrapped])
			return () => {
				const current = listeners.get(name)
				if (!current) return
				const at = current.indexOf(wrapped)
				if (at >= 0) current.splice(at, 1)
			}
		},
		emit<K extends EventName>(name: K, payload: EventPayloads[K]): void {
			const current = listeners.get(name)
			if (!current || current.length === 0) return
			for (const fn of current.slice()) fn(payload)
		},
		clear(): void {
			listeners.clear()
		},
	}
}

export interface RecordedEvent {
	name: EventName
	payload: unknown
}

export interface RecordingEventBus extends EventBus {
	readonly recorded: readonly RecordedEvent[]
	resetRecording(): void
}

/** Bus that also keeps every emitted event, in order. Handy in tests. */
export function createRecordingEventBus(): RecordingEventBus {
	const inner = createEventBus()
	const recorded: RecordedEvent[] = []
	return {
		on: inner.on.bind(inner),
		emit<K extends EventName>(name: K, payload: EventPayloads[K]): void {
			recorded.push({ name, payload })
			inner.emit(name, payload)
		},
		clear(): void {
			inner.clear()
		},
		recorded,
		resetRecording(): void {
			recorded.length = 0
		},
	}
}
