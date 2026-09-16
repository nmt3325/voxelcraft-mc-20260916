/**
 * Pointer lock, and the way back out of it.
 *
 * A first-person canvas needs pointer lock to read raw mouse deltas, and it is
 * also the one browser capture a player can get stuck inside. Through v1.2.0
 * this app asked for the lock on `mousedown` and then never called
 * `exitPointerLock`, never listened for `pointerlockchange`, and re-captured on
 * the very next click, so the cursor came back for an instant and was taken
 * again before it could be used.
 *
 * Chrome and Safari consume the `Escape` keypress that ends a lock instead of
 * dispatching it to the page, so `keydown` cannot be the signal:
 * `pointerlockchange` is the only reliable one. This controller owns that
 * lifecycle and reports a lost lock exactly once, which is what lets the app
 * pause itself and then leave the cursor alone until the player asks again.
 *
 * Only the DOM members actually used are declared, so the unit tests can drive
 * the whole state machine with plain objects instead of a browser.
 */

/** The element the lock is requested on. `HTMLCanvasElement` satisfies this. */
export interface PointerLockTarget {
	requestPointerLock(): unknown
}

/** The slice of `document` this controller talks to. */
export interface PointerLockDocument {
	readonly pointerLockElement: unknown
	exitPointerLock(): void
	addEventListener(type: string, listener: () => void): void
	removeEventListener(type: string, listener: () => void): void
}

/**
 * Chrome and Safari both refuse a request that arrives immediately after a
 * release the user asked for ("The user has exited the lock before this request
 * was completed"). Asking again inside this window cannot succeed, so the
 * request is dropped instead of becoming a rejected promise and a console error.
 */
export const POINTER_LOCK_COOLDOWN_MS = 1500

export interface PointerLockConfig {
	target: PointerLockTarget
	doc: PointerLockDocument
	/** Fires once per release of a lock we held, whoever ended it. */
	onLost: () => void
	/** Fires when the browser refuses a request. */
	onDenied?: (message: string) => void
	/** Injectable clock in milliseconds; defaults to `performance.now()`. */
	now?: () => number
}

export interface PointerLockController {
	/** True while this target owns the pointer. */
	isLocked(): boolean
	/** True while the browser would refuse a fresh request. */
	isCoolingDown(): boolean
	capture(): void
	release(): void
	dispose(): void
}

function defaultNow(): number {
	return typeof performance === 'undefined' ? Date.now() : performance.now()
}

export function createPointerLock(config: PointerLockConfig): PointerLockController {
	const { doc, onLost, target } = config
	const now = config.now ?? defaultNow
	const onDenied = config.onDenied

	const isLocked = (): boolean => doc.pointerLockElement === target
	const isCoolingDown = (): boolean => now() - releasedAt < POINTER_LOCK_COOLDOWN_MS

	let held = isLocked()
	let releasedAt = Number.NEGATIVE_INFINITY

	const onChange = (): void => {
		const locked = isLocked()
		if (held && !locked) {
			// The release the app never used to notice. Reported once: a duplicate
			// change event for the same release must not pause the game twice.
			held = false
			releasedAt = now()
			onLost()
			return
		}
		held = locked
	}

	const onError = (): void => {
		// A refused request is as good as a release here: the app must never be
		// left believing it owns look input that it does not.
		const wasHeld = held
		held = isLocked()
		releasedAt = now()
		onDenied?.('pointerlockerror')
		if (wasHeld && !held) onLost()
	}

	doc.addEventListener('pointerlockchange', onChange)
	doc.addEventListener('pointerlockerror', onError)

	return {
		isLocked,
		isCoolingDown,
		capture(): void {
			if (isLocked() || isCoolingDown()) return
			const pending: unknown = target.requestPointerLock()
			// Chrome returns a promise, older Safari returns undefined. An unhandled
			// rejection would show up as a console error, which the E2E gate forbids.
			if (pending instanceof Promise) {
				void pending.catch((error: unknown) => {
					releasedAt = now()
					onDenied?.(String(error))
				})
			}
		},
		release(): void {
			if (!isLocked()) return
			held = false
			releasedAt = now()
			doc.exitPointerLock()
		},
		dispose(): void {
			doc.removeEventListener('pointerlockchange', onChange)
			doc.removeEventListener('pointerlockerror', onError)
		},
	}
}
