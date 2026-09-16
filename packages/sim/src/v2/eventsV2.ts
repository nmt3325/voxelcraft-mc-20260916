/**
 * `EventBusV2` implementation for the v1.1 simulation subtrees.
 *
 * `shared/events.ts` only carries the frozen v1 `EVENT` names, so the v2
 * subtrees (dimension transitions, breeding, particles) need a bus that also
 * accepts the `EVENT_V2` names. The dispatch rules are identical: listeners
 * fire in registration order and `emit` iterates a copy, so a handler that
 * subscribes or unsubscribes cannot reorder the current dispatch and a
 * replayed tick stays observably identical.
 */
import type { AnyEventName, AnyEventPayloads, EventBusV2 } from '@voxelcraft/core-types'

type Listener = (payload: unknown) => void

export function createEventBusV2(): EventBusV2 {
	const listeners = new Map<AnyEventName, Listener[]>()
	return {
		on<K extends AnyEventName>(name: K, fn: (payload: AnyEventPayloads[K]) => void): () => void {
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
		emit<K extends AnyEventName>(name: K, payload: AnyEventPayloads[K]): void {
			const current = listeners.get(name)
			if (!current || current.length === 0) return
			for (const fn of current.slice()) fn(payload)
		},
		clear(): void {
			listeners.clear()
		},
	}
}

export interface RecordedEventV2 {
	name: AnyEventName
	payload: unknown
}

export interface RecordingEventBusV2 extends EventBusV2 {
	readonly recorded: readonly RecordedEventV2[]
	resetRecording(): void
}

/** Bus that also keeps every emitted event, in order. Handy in tests. */
export function createRecordingEventBusV2(): RecordingEventBusV2 {
	const inner = createEventBusV2()
	const recorded: RecordedEventV2[] = []
	return {
		on: inner.on.bind(inner),
		emit<K extends AnyEventName>(name: K, payload: AnyEventPayloads[K]): void {
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

/** Number of recorded events with `name`. Keeps assertions short in tests. */
export function v2CountEvents(bus: RecordingEventBusV2, name: AnyEventName): number {
	let total = 0
	for (const event of bus.recorded) if (event.name === name) total += 1
	return total
}

/** Payloads of every recorded event with `name`, in emission order. */
export function v2EventsNamed<K extends AnyEventName>(
	bus: RecordingEventBusV2,
	name: K,
): AnyEventPayloads[K][] {
	const out: AnyEventPayloads[K][] = []
	for (const event of bus.recorded) {
		if (event.name === name) out.push(event.payload as AnyEventPayloads[K])
	}
	return out
}
