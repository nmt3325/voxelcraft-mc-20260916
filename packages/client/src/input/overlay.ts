/**
 * Touch control overlay: the DOM adapter around `./touch`.
 *
 * It owns the elements, the pointer listeners and the long-press timer, and
 * only reports intent to the host. Every threshold and size comes from the
 * frozen `TOUCH` contract, and the mapping itself lives in `./touch` so it can
 * be tested without a DOM.
 *
 * The overlay is hidden until a touch or pen pointer is seen, so mouse users
 * never see it and never lose a click to it.
 */

import { INPUT_BIT, TOUCH } from '@voxelcraft/core-types'
import { el, setAttr, setHidden, toggleClass } from '../ui/dom'
import type { UiPanel, UiScreen, UiSnapshot } from '../ui/types'
import {
	createPressTracker,
	dragLookDelta,
	isTouchPointerType,
	joystickBits,
	joystickVector,
	TOUCH_BUTTONS,
	type LookDelta,
	type Vec2,
} from './touch'

/** Touch controls only make sense while the player is in the world. */
const TOUCH_SCREENS = new Set<UiScreen>(['playing'])

const KNOB_SIZE_PX = TOUCH.joystickRadiusPx
const STICK_SIZE_PX = TOUCH.joystickRadiusPx * 2

export interface TouchInputHost {
	/** The full INPUT_BIT mask. Only called when the mask actually changes. */
	onTouchInput?(bits: number): void
	/** Yaw/pitch deltas from a drag on the free look area, in radians. */
	onTouchLook?(delta: LookDelta): void
	/** A short tap on the free look area: use / place. */
	onTouchUse?(): void
	/** A long press on the free look area starts and stops continuous mining. */
	onTouchAttack?(active: boolean): void
	onPlaySound?(name: string): void
}

export interface TouchOverlayOptions {
	/** Injected clock, so tap vs long press stays deterministic in tests. */
	now?(): number
}

export interface TouchOverlayHandle extends UiPanel {
	dispose(): void
	/** True once a touch or pen pointer has been seen. A mouse never flips it. */
	isTouchMode(): boolean
	/** The mask most recently reported to the host. */
	bits(): number
}

/** The parts of PointerEvent this module reads; tests can pass plain events. */
interface PointerLike {
	pointerType?: string
	pointerId?: number
	clientX?: number
	clientY?: number
	preventDefault?(): void
}

function asPointer(event: Event): PointerLike {
	return event as unknown as PointerLike
}

function pointOf(pointer: PointerLike): Vec2 {
	return { x: pointer.clientX ?? 0, y: pointer.clientY ?? 0 }
}

function idOf(pointer: PointerLike): number {
	return pointer.pointerId ?? 0
}

function capturePointer(node: HTMLElement, pointerId: number): void {
	const target = node as HTMLElement & { setPointerCapture?(id: number): void }
	if (typeof target.setPointerCapture !== 'function') return
	try {
		target.setPointerCapture(pointerId)
	} catch (error) {
		// Synthetic pointers (jsdom, some browsers) refuse capture; dragging still works.
		void error
	}
}

function knobStyle(offset: Vec2): string {
	const size = `width:${KNOB_SIZE_PX}px;height:${KNOB_SIZE_PX}px`
	const x = (offset.x * TOUCH.joystickRadiusPx).toFixed(1)
	const y = (offset.y * TOUCH.joystickRadiusPx).toFixed(1)
	return `${size};transform:translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`
}

/**
 * Builds the touch overlay panel. Mount it inside the UI layer after the HUD so
 * it paints above the HUD but still below every full-screen menu.
 */
export function createTouchOverlay(
	doc: Document,
	host: TouchInputHost,
	options: TouchOverlayOptions = {},
): TouchOverlayHandle {
	const view = doc.defaultView
	const now = options.now ?? ((): number => Date.now())

	const knob = el(doc, 'div', {
		class: 'vc-touch-knob',
		'data-testid': 'touch-joystick-knob',
		style: knobStyle({ x: 0, y: 0 }),
	})
	const stick = el(
		doc,
		'div',
		{
			class: 'vc-touch-stick',
			'data-testid': 'touch-joystick',
			style: `width:${STICK_SIZE_PX}px;height:${STICK_SIZE_PX}px`,
		},
		[knob],
	)
	const look = el(doc, 'div', { class: 'vc-touch-look', 'data-testid': 'touch-look' })
	const buttons = el(doc, 'div', {
		class: 'vc-touch-buttons',
		'data-testid': 'touch-buttons',
		style: `gap:${TOUCH.buttonGapPx}px`,
	})
	const element = el(doc, 'div', { class: 'vc-touch', 'data-testid': 'touch-controls' }, [
		look,
		stick,
		buttons,
	])
	setHidden(element, true)

	let touchMode = false
	let onWorldScreen = false
	let visible = false
	let reported = 0
	let stickBits = 0
	let buttonBits = 0
	let mining = false
	let stickPointer: number | null = null
	let stickOrigin: Vec2 = { x: 0, y: 0 }
	let lookPointer: number | null = null
	let lookPoint: Vec2 = { x: 0, y: 0 }
	let holdTimer: number | null = null
	const press = createPressTracker()
	const buttonReleases: Array<() => void> = []

	const emit = (): void => {
		const next = stickBits | buttonBits | (mining ? INPUT_BIT.Attack : 0)
		if (next === reported) return
		reported = next
		host.onTouchInput?.(next)
	}

	const clearHoldTimer = (): void => {
		if (holdTimer === null) return
		view?.clearTimeout(holdTimer)
		holdTimer = null
	}

	const setMining = (active: boolean): void => {
		if (mining === active) return
		mining = active
		host.onTouchAttack?.(active)
		emit()
	}

	const resetStick = (): void => {
		stickPointer = null
		stickBits = 0
		setAttr(knob, 'style', knobStyle({ x: 0, y: 0 }))
		emit()
	}

	const releaseAll = (): void => {
		clearHoldTimer()
		press.cancel()
		lookPointer = null
		buttonBits = 0
		for (const release of buttonReleases) release()
		setMining(false)
		resetStick()
	}

	const syncVisibility = (): void => {
		const next = touchMode && onWorldScreen
		if (next === visible) return
		visible = next
		setHidden(element, !next)
		if (!next) releaseAll()
	}

	// A mouse never reaches this: the overlay only wakes up for touch and pen.
	const onActivatingPointerDown = (event: Event): void => {
		if (touchMode) return
		if (!isTouchPointerType(asPointer(event).pointerType)) return
		touchMode = true
		syncVisibility()
	}

	look.addEventListener('pointerdown', (event: Event): void => {
		const pointer = asPointer(event)
		if (!isTouchPointerType(pointer.pointerType) || lookPointer !== null) return
		pointer.preventDefault?.()
		lookPointer = idOf(pointer)
		lookPoint = pointOf(pointer)
		capturePointer(look, lookPointer)
		press.down(now())
		clearHoldTimer()
		holdTimer =
			view?.setTimeout(() => {
				holdTimer = null
				if (press.poll(now()) === 'holdStart') setMining(true)
			}, TOUCH.longPressMs) ?? null
	})

	look.addEventListener('pointermove', (event: Event): void => {
		const pointer = asPointer(event)
		if (lookPointer === null || idOf(pointer) !== lookPointer) return
		const point = pointOf(pointer)
		const delta = dragLookDelta(lookPoint, point)
		lookPoint = point
		if (delta.yaw !== 0 || delta.pitch !== 0) host.onTouchLook?.(delta)
	})

	look.addEventListener('pointerup', (event: Event): void => {
		const pointer = asPointer(event)
		if (lookPointer === null || idOf(pointer) !== lookPointer) return
		lookPointer = null
		clearHoldTimer()
		const result = press.up(now())
		if (result === 'tap') host.onTouchUse?.()
		if (result === 'holdEnd') setMining(false)
	})

	look.addEventListener('pointercancel', (event: Event): void => {
		const pointer = asPointer(event)
		if (lookPointer === null || idOf(pointer) !== lookPointer) return
		lookPointer = null
		clearHoldTimer()
		press.cancel()
		setMining(false)
	})

	stick.addEventListener('pointerdown', (event: Event): void => {
		const pointer = asPointer(event)
		if (!isTouchPointerType(pointer.pointerType) || stickPointer !== null) return
		pointer.preventDefault?.()
		stickPointer = idOf(pointer)
		// The landing point becomes the origin, so an imprecise first touch does
		// not bias the stick.
		stickOrigin = pointOf(pointer)
		capturePointer(stick, stickPointer)
	})

	stick.addEventListener('pointermove', (event: Event): void => {
		const pointer = asPointer(event)
		if (stickPointer === null || idOf(pointer) !== stickPointer) return
		const vector = joystickVector(stickOrigin, pointOf(pointer))
		setAttr(knob, 'style', knobStyle(vector))
		stickBits = joystickBits(vector)
		emit()
	})

	for (const type of ['pointerup', 'pointercancel']) {
		stick.addEventListener(type, (event: Event): void => {
			const pointer = asPointer(event)
			if (stickPointer === null || idOf(pointer) !== stickPointer) return
			resetStick()
		})
	}

	for (const def of TOUCH_BUTTONS) {
		const node = el(
			doc,
			'button',
			{
				type: 'button',
				class: 'vc-touch-button',
				'data-testid': def.testId,
				'data-button': def.id,
				'aria-label': def.label,
				style: `width:${TOUCH.buttonSizePx}px;height:${TOUCH.buttonSizePx}px`,
			},
			[def.label],
		)
		let held: number | null = null

		const release = (): void => {
			if (held === null) return
			held = null
			buttonBits &= ~def.bit
			toggleClass(node, 'is-active', false)
			emit()
		}

		node.addEventListener('pointerdown', (event: Event): void => {
			const pointer = asPointer(event)
			if (!isTouchPointerType(pointer.pointerType) || held !== null) return
			pointer.preventDefault?.()
			held = idOf(pointer)
			buttonBits |= def.bit
			toggleClass(node, 'is-active', true)
			host.onPlaySound?.('ui.click')
			emit()
		})

		for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
			node.addEventListener(type, (event: Event): void => {
				if (held !== null && idOf(asPointer(event)) !== held) return
				release()
			})
		}

		buttonReleases.push(release)
		buttons.appendChild(node)
	}

	view?.addEventListener('pointerdown', onActivatingPointerDown, true)

	return {
		element,
		update(snapshot: UiSnapshot): void {
			onWorldScreen = TOUCH_SCREENS.has(snapshot.screen)
			syncVisibility()
		},
		dispose(): void {
			view?.removeEventListener('pointerdown', onActivatingPointerDown, true)
			releaseAll()
			element.remove()
		},
		isTouchMode: (): boolean => touchMode,
		bits: (): number => reported,
	}
}
