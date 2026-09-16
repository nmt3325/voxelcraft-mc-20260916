import { describe, expect, it, vi } from 'vitest'
import {
	createPointerLock,
	POINTER_LOCK_COOLDOWN_MS,
	type PointerLockController,
	type PointerLockDocument,
	type PointerLockTarget,
} from './pointerLock'

/** A canvas plus the slice of `document` the controller drives, on a fake clock. */
interface Harness {
	target: PointerLockTarget
	doc: PointerLockDocument
	now: () => number
	requests: () => number
	exits: () => number
	listeners: () => number
	advance: (ms: number) => void
	/** The browser granted the lock we asked for. */
	grant: () => void
	/** The browser ended the lock: Escape, tab switch, or a macOS app switch. */
	browserRelease: () => void
	fireError: () => void
}

function harness(request?: () => unknown): Harness {
	let requests = 0
	let exits = 0
	let clock = 10000
	let element: unknown = null
	const listeners = new Map<string, Set<() => void>>()

	const emit = (type: string): void => {
		for (const listener of [...(listeners.get(type) ?? [])]) listener()
	}

	const target: PointerLockTarget = {
		requestPointerLock(): unknown {
			requests += 1
			return request === undefined ? undefined : request()
		},
	}

	const doc: PointerLockDocument = {
		get pointerLockElement(): unknown {
			return element
		},
		exitPointerLock(): void {
			exits += 1
			if (element === null) return
			element = null
			emit('pointerlockchange')
		},
		addEventListener(type: string, listener: () => void): void {
			const set = listeners.get(type) ?? new Set<() => void>()
			set.add(listener)
			listeners.set(type, set)
		},
		removeEventListener(type: string, listener: () => void): void {
			listeners.get(type)?.delete(listener)
		},
	}

	return {
		target,
		doc,
		now: () => clock,
		requests: () => requests,
		exits: () => exits,
		listeners: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
		advance: (ms: number): void => {
			clock += ms
		},
		grant: (): void => {
			element = target
			emit('pointerlockchange')
		},
		browserRelease: (): void => {
			element = null
			emit('pointerlockchange')
		},
		fireError: (): void => {
			emit('pointerlockerror')
		},
	}
}

function controller(
	h: Harness,
	hooks: { onLost?: () => void; onDenied?: (message: string) => void } = {},
): PointerLockController {
	return createPointerLock({
		target: h.target,
		doc: h.doc,
		onLost: hooks.onLost ?? ((): void => {}),
		onDenied: hooks.onDenied,
		now: h.now,
	})
}

describe('pointer lock controller', () => {
	it('captures on demand and follows the browser confirmation', () => {
		const h = harness()
		const lock = controller(h)

		expect(lock.isLocked()).toBe(false)
		lock.capture()
		expect(h.requests()).toBe(1)
		h.grant()
		expect(lock.isLocked()).toBe(true)

		// Already captured: a second click mines, it does not re-request.
		lock.capture()
		expect(h.requests()).toBe(1)
	})

	it('reports a browser-driven release once, which is how Escape is seen', () => {
		const h = harness()
		const onLost = vi.fn()
		const lock = controller(h, { onLost })

		lock.capture()
		h.grant()
		h.browserRelease()

		expect(onLost).toHaveBeenCalledTimes(1)
		expect(lock.isLocked()).toBe(false)

		// A duplicate change event for the same release is not a second loss.
		h.browserRelease()
		expect(onLost).toHaveBeenCalledTimes(1)
	})

	it('drops a re-capture inside the browser cooldown, then allows it', () => {
		const h = harness()
		const lock = controller(h)

		lock.capture()
		h.grant()
		h.browserRelease()

		// This is the shipped bug: the next click used to re-capture immediately.
		expect(lock.isCoolingDown()).toBe(true)
		lock.capture()
		expect(h.requests()).toBe(1)

		h.advance(POINTER_LOCK_COOLDOWN_MS)
		expect(lock.isCoolingDown()).toBe(false)
		lock.capture()
		expect(h.requests()).toBe(2)
	})

	it('treats a release it asked for as expected, not as a loss', () => {
		const h = harness()
		const onLost = vi.fn()
		const lock = controller(h, { onLost })

		lock.capture()
		h.grant()
		lock.release()

		expect(h.exits()).toBe(1)
		expect(lock.isLocked()).toBe(false)
		expect(onLost).not.toHaveBeenCalled()
	})

	it('does nothing when releasing a pointer it never captured', () => {
		const h = harness()
		const lock = controller(h)

		lock.release()
		expect(h.exits()).toBe(0)
	})

	it('reports a rejected request instead of leaking an unhandled rejection', async () => {
		const h = harness(() => Promise.reject(new Error('SecurityError')))
		const onDenied = vi.fn()
		const lock = controller(h, { onDenied })

		lock.capture()
		await Promise.resolve()
		await Promise.resolve()

		expect(onDenied).toHaveBeenCalledTimes(1)
		expect(String(onDenied.mock.calls[0]?.[0])).toContain('SecurityError')

		// The rejection also starts the cooldown, so no retry storm follows.
		lock.capture()
		expect(h.requests()).toBe(1)
	})

	it('starts the cooldown when the browser raises pointerlockerror', () => {
		const h = harness()
		const onLost = vi.fn()
		const onDenied = vi.fn()
		const lock = controller(h, { onLost, onDenied })

		lock.capture()
		h.fireError()

		expect(onDenied).toHaveBeenCalledWith('pointerlockerror')
		expect(onLost).not.toHaveBeenCalled()
		lock.capture()
		expect(h.requests()).toBe(1)
	})

	it('unhooks both listeners on dispose', () => {
		const h = harness()
		const onLost = vi.fn()
		const lock = controller(h, { onLost })

		expect(h.listeners()).toBe(2)
		lock.dispose()
		expect(h.listeners()).toBe(0)

		h.grant()
		h.browserRelease()
		expect(onLost).not.toHaveBeenCalled()
	})
})
