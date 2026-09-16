// @vitest-environment jsdom

import { INPUT_BIT, TOUCH } from '@voxelcraft/core-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultUiSnapshot } from '../../ui/snapshot'
import type { UiScreen, UiSnapshot } from '../../ui/types'
import { createTouchOverlay, type TouchInputHost, type TouchOverlayHandle } from '../overlay'
import type { LookDelta } from '../touch'

const R = TOUCH.joystickRadiusPx

function snapshotFor(screen: UiScreen): UiSnapshot {
	return { ...createDefaultUiSnapshot(), screen }
}

interface PointerInit {
	pointerType?: string
	pointerId?: number
	x?: number
	y?: number
}

/** jsdom has no PointerEvent, so tests synthesise only the fields we read. */
function pointerEvent(type: string, init: PointerInit = {}): Event {
	const event = new Event(type, { bubbles: true, cancelable: true })
	Object.defineProperties(event, {
		pointerType: { value: init.pointerType ?? 'touch' },
		pointerId: { value: init.pointerId ?? 1 },
		clientX: { value: init.x ?? 0 },
		clientY: { value: init.y ?? 0 },
	})
	return event
}

interface Recorder {
	host: TouchInputHost
	bits: number[]
	looks: LookDelta[]
	attacks: boolean[]
	sounds: string[]
	uses(): number
}

function createRecorder(): Recorder {
	const bits: number[] = []
	const looks: LookDelta[] = []
	const attacks: boolean[] = []
	const sounds: string[] = []
	let uses = 0
	return {
		bits,
		looks,
		attacks,
		sounds,
		uses: () => uses,
		host: {
			onTouchInput: (value) => {
				bits.push(value)
			},
			onTouchLook: (delta) => {
				looks.push(delta)
			},
			onTouchUse: () => {
				uses += 1
			},
			onTouchAttack: (active) => {
				attacks.push(active)
			},
			onPlaySound: (name) => {
				sounds.push(name)
			},
		},
	}
}

let recorder: Recorder
let overlay: TouchOverlayHandle
let root: HTMLElement
let clock = 0

function activateTouch(): void {
	window.dispatchEvent(pointerEvent('pointerdown'))
}

function find(testId: string): HTMLElement {
	const node = overlay.element.querySelector(`[data-testid="${testId}"]`)
	if (!(node instanceof HTMLElement)) throw new Error(`missing ${testId}`)
	return node
}

beforeEach(() => {
	vi.useFakeTimers()
	clock = 0
	document.body.innerHTML = ''
	recorder = createRecorder()
	root = document.createElement('div')
	document.body.appendChild(root)
	overlay = createTouchOverlay(document, recorder.host, { now: () => clock })
	root.appendChild(overlay.element)
	overlay.update(snapshotFor('playing'))
})

afterEach(() => {
	overlay.dispose()
	root.remove()
	vi.useRealTimers()
})

describe('touch overlay activation', () => {
	it('stays hidden until a touch pointer is seen', () => {
		expect(overlay.element.hidden).toBe(true)
		expect(overlay.isTouchMode()).toBe(false)
	})

	it('never appears for mouse pointers', () => {
		window.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse' }))
		expect(overlay.isTouchMode()).toBe(false)
		expect(overlay.element.hidden).toBe(true)
	})

	it('appears for a touch pointer while the player is in the world', () => {
		activateTouch()
		expect(overlay.isTouchMode()).toBe(true)
		expect(overlay.element.hidden).toBe(false)
	})

	it('appears for a pen pointer too', () => {
		window.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'pen' }))
		expect(overlay.element.hidden).toBe(false)
	})

	it('hides again on any non-playing screen', () => {
		activateTouch()
		overlay.update(snapshotFor('pause'))
		expect(overlay.element.hidden).toBe(true)
		overlay.update(snapshotFor('playing'))
		expect(overlay.element.hidden).toBe(false)
	})

	it('sizes the controls from the TOUCH contract', () => {
		expect(find('touch-joystick').getAttribute('style')).toBe(`width:${R * 2}px;height:${R * 2}px`)
		expect(find('touch-buttons').getAttribute('style')).toBe(`gap:${TOUCH.buttonGapPx}px`)
		expect(find('touch-button-jump').getAttribute('style')).toBe(
			`width:${TOUCH.buttonSizePx}px;height:${TOUCH.buttonSizePx}px`,
		)
	})
})

describe('touch buttons', () => {
	it('maps every button to its input bit while held', () => {
		activateTouch()
		const cases: Array<[string, number]> = [
			['touch-button-jump', INPUT_BIT.Jump],
			['touch-button-sneak', INPUT_BIT.Sneak],
			['touch-button-attack', INPUT_BIT.Attack],
			['touch-button-use', INPUT_BIT.UseItem],
		]
		for (const [testId, bit] of cases) {
			const node = find(testId)
			node.dispatchEvent(pointerEvent('pointerdown'))
			expect(overlay.bits()).toBe(bit)
			node.dispatchEvent(pointerEvent('pointerup'))
			expect(overlay.bits()).toBe(0)
		}
		expect(recorder.sounds).toEqual(['ui.click', 'ui.click', 'ui.click', 'ui.click'])
	})

	it('ignores mouse presses on the buttons', () => {
		activateTouch()
		find('touch-button-jump').dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse' }))
		expect(recorder.bits).toEqual([])
		expect(overlay.bits()).toBe(0)
	})

	it('releases held buttons when the overlay hides', () => {
		activateTouch()
		find('touch-button-jump').dispatchEvent(pointerEvent('pointerdown'))
		expect(overlay.bits()).toBe(INPUT_BIT.Jump)
		overlay.update(snapshotFor('pause'))
		expect(overlay.bits()).toBe(0)
	})
})

describe('virtual joystick', () => {
	it('maps a drag to movement bits and clears them on release', () => {
		activateTouch()
		const stick = find('touch-joystick')
		stick.dispatchEvent(pointerEvent('pointerdown', { x: 100, y: 300 }))
		stick.dispatchEvent(pointerEvent('pointermove', { x: 100, y: 300 - R / 2 }))
		expect(overlay.bits()).toBe(INPUT_BIT.Forward)
		stick.dispatchEvent(pointerEvent('pointermove', { x: 100, y: 300 - R }))
		expect(overlay.bits()).toBe(INPUT_BIT.Forward | INPUT_BIT.Sprint)
		stick.dispatchEvent(pointerEvent('pointerup', { x: 100, y: 300 - R }))
		expect(overlay.bits()).toBe(0)
	})

	it('stays neutral inside the dead zone', () => {
		activateTouch()
		const stick = find('touch-joystick')
		stick.dispatchEvent(pointerEvent('pointerdown', { x: 100, y: 300 }))
		const inside = R * TOUCH.joystickDeadZone * 0.5
		stick.dispatchEvent(pointerEvent('pointermove', { x: 100, y: 300 - inside }))
		expect(overlay.bits()).toBe(0)
		expect(recorder.bits).toEqual([])
	})

	it('moves the knob with the stick and recentres it on release', () => {
		activateTouch()
		const stick = find('touch-joystick')
		const knob = find('touch-joystick-knob')
		stick.dispatchEvent(pointerEvent('pointerdown', { x: 100, y: 300 }))
		stick.dispatchEvent(pointerEvent('pointermove', { x: 100 + R, y: 300 }))
		expect(knob.getAttribute('style')).toContain(`calc(-50% + ${R.toFixed(1)}px)`)
		stick.dispatchEvent(pointerEvent('pointerup', { x: 100 + R, y: 300 }))
		expect(knob.getAttribute('style')).toContain('calc(-50% + 0.0px)')
	})

	it('combines the stick with a held button', () => {
		activateTouch()
		const stick = find('touch-joystick')
		stick.dispatchEvent(pointerEvent('pointerdown', { x: 0, y: 0 }))
		stick.dispatchEvent(pointerEvent('pointermove', { x: 0, y: -R / 2 }))
		find('touch-button-jump').dispatchEvent(pointerEvent('pointerdown', { pointerId: 2 }))
		expect(overlay.bits()).toBe(INPUT_BIT.Forward | INPUT_BIT.Jump)
	})

	it('ignores mouse drags on the stick', () => {
		activateTouch()
		const stick = find('touch-joystick')
		stick.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse', x: 0, y: 0 }))
		stick.dispatchEvent(pointerEvent('pointermove', { pointerType: 'mouse', x: 0, y: -R }))
		expect(recorder.bits).toEqual([])
	})
})

describe('drag look', () => {
	it('reports yaw and pitch deltas scaled by dragSensitivity', () => {
		activateTouch()
		const look = find('touch-look')
		look.dispatchEvent(pointerEvent('pointerdown', { x: 10, y: 10 }))
		look.dispatchEvent(pointerEvent('pointermove', { x: 40, y: 10 }))
		look.dispatchEvent(pointerEvent('pointermove', { x: 40, y: 30 }))
		expect(recorder.looks.length).toBe(2)
		expect(Number(recorder.looks[0]?.yaw)).toBeCloseTo(30 * TOUCH.dragSensitivity, 12)
		expect(Number(recorder.looks[0]?.pitch)).toBeCloseTo(0, 12)
		expect(Number(recorder.looks[1]?.yaw)).toBeCloseTo(0, 12)
		expect(Number(recorder.looks[1]?.pitch)).toBeCloseTo(-20 * TOUCH.dragSensitivity, 12)
	})

	it('ignores drags from a mouse', () => {
		activateTouch()
		const look = find('touch-look')
		look.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse', x: 0, y: 0 }))
		look.dispatchEvent(pointerEvent('pointermove', { pointerType: 'mouse', x: 50, y: 0 }))
		expect(recorder.looks).toEqual([])
	})
})

describe('tap and long press on the free area', () => {
	it('treats a release under tapMaxMs as a use', () => {
		activateTouch()
		const look = find('touch-look')
		look.dispatchEvent(pointerEvent('pointerdown', { x: 5, y: 5 }))
		clock += TOUCH.tapMaxMs - 1
		vi.advanceTimersByTime(TOUCH.tapMaxMs - 1)
		look.dispatchEvent(pointerEvent('pointerup', { x: 5, y: 5 }))
		expect(recorder.uses()).toBe(1)
		expect(recorder.attacks).toEqual([])
		expect(overlay.bits()).toBe(0)
	})

	it('does not use on a release exactly at tapMaxMs', () => {
		activateTouch()
		const look = find('touch-look')
		look.dispatchEvent(pointerEvent('pointerdown'))
		clock += TOUCH.tapMaxMs
		vi.advanceTimersByTime(TOUCH.tapMaxMs)
		look.dispatchEvent(pointerEvent('pointerup'))
		expect(recorder.uses()).toBe(0)
		expect(recorder.attacks).toEqual([])
	})

	it('starts continuous mining exactly at longPressMs', () => {
		activateTouch()
		const look = find('touch-look')
		look.dispatchEvent(pointerEvent('pointerdown'))
		clock += TOUCH.longPressMs - 1
		vi.advanceTimersByTime(TOUCH.longPressMs - 1)
		expect(recorder.attacks).toEqual([])
		clock += 1
		vi.advanceTimersByTime(1)
		expect(recorder.attacks).toEqual([true])
		expect(overlay.bits()).toBe(INPUT_BIT.Attack)
		look.dispatchEvent(pointerEvent('pointerup'))
		expect(recorder.attacks).toEqual([true, false])
		expect(recorder.uses()).toBe(0)
		expect(overlay.bits()).toBe(0)
	})

	it('stops mining when the touch is cancelled', () => {
		activateTouch()
		const look = find('touch-look')
		look.dispatchEvent(pointerEvent('pointerdown'))
		clock += TOUCH.longPressMs
		vi.advanceTimersByTime(TOUCH.longPressMs)
		look.dispatchEvent(pointerEvent('pointercancel'))
		expect(recorder.attacks).toEqual([true, false])
		expect(overlay.bits()).toBe(0)
	})
})

describe('dispose', () => {
	it('removes the overlay and stops listening for touch pointers', () => {
		overlay.dispose()
		expect(overlay.element.parentElement).toBe(null)
		activateTouch()
		expect(overlay.isTouchMode()).toBe(false)
		expect(overlay.element.hidden).toBe(true)
	})
})
