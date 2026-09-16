import { INPUT_BIT, TOUCH } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import {
	createPressTracker,
	dragLookDelta,
	isLongPress,
	isTap,
	isTouchPointerType,
	joystickBits,
	joystickMagnitude,
	joystickVector,
	JOYSTICK_SPRINT_AT,
	TOUCH_BUTTONS,
	touchButtonBit,
} from '../touch'

const R = TOUCH.joystickRadiusPx
const CENTER = { x: 300, y: 500 }

describe('joystickVector', () => {
	it('measures the offset in radius units', () => {
		expect(joystickVector(CENTER, CENTER)).toEqual({ x: 0, y: 0 })
		expect(joystickVector(CENTER, { x: CENTER.x, y: CENTER.y - R })).toEqual({ x: 0, y: -1 })
		expect(joystickVector(CENTER, { x: CENTER.x + R / 2, y: CENTER.y })).toEqual({ x: 0.5, y: 0 })
	})

	it('clamps a drag past the edge to the unit circle', () => {
		const vector = joystickVector(CENTER, { x: CENTER.x + R * 4, y: CENTER.y + R * 4 })
		expect(joystickMagnitude(vector)).toBeCloseTo(1, 10)
		expect(vector.x).toBeCloseTo(Math.SQRT1_2, 10)
		expect(vector.y).toBeCloseTo(Math.SQRT1_2, 10)
	})

	it('is neutral for a non-positive radius', () => {
		expect(joystickVector(CENTER, { x: CENTER.x + 10, y: CENTER.y }, 0)).toEqual({ x: 0, y: 0 })
	})
})

describe('joystickBits dead zone', () => {
	it('reports nothing at or inside the dead zone', () => {
		expect(joystickBits({ x: 0, y: 0 })).toBe(0)
		expect(joystickBits({ x: 0, y: -TOUCH.joystickDeadZone })).toBe(0)
		expect(joystickBits({ x: TOUCH.joystickDeadZone, y: 0 })).toBe(0)
		expect(joystickBits({ x: 0, y: -(TOUCH.joystickDeadZone - 0.001) })).toBe(0)
	})

	it('reports movement just outside the dead zone', () => {
		const justOut = TOUCH.joystickDeadZone + 0.001
		expect(joystickBits({ x: 0, y: -justOut })).toBe(INPUT_BIT.Forward)
		expect(joystickBits({ x: 0, y: justOut })).toBe(INPUT_BIT.Back)
		expect(joystickBits({ x: -justOut, y: 0 })).toBe(INPUT_BIT.Left)
		expect(joystickBits({ x: justOut, y: 0 })).toBe(INPUT_BIT.Right)
	})

	it('honours a custom dead zone', () => {
		expect(joystickBits({ x: 0, y: -0.4 }, { deadZone: 0.5 })).toBe(0)
		expect(joystickBits({ x: 0, y: -0.6 }, { deadZone: 0.5 })).toBe(INPUT_BIT.Forward)
	})
})

describe('joystickBits directions', () => {
	it('maps the four cardinal directions', () => {
		expect(joystickBits({ x: 0, y: -0.5 })).toBe(INPUT_BIT.Forward)
		expect(joystickBits({ x: 0, y: 0.5 })).toBe(INPUT_BIT.Back)
		expect(joystickBits({ x: -0.5, y: 0 })).toBe(INPUT_BIT.Left)
		expect(joystickBits({ x: 0.5, y: 0 })).toBe(INPUT_BIT.Right)
	})

	it('maps diagonals to two movement bits', () => {
		expect(joystickBits({ x: 0.4, y: -0.4 })).toBe(INPUT_BIT.Forward | INPUT_BIT.Right)
		expect(joystickBits({ x: -0.4, y: 0.4 })).toBe(INPUT_BIT.Back | INPUT_BIT.Left)
	})

	it('adds Sprint only when the stick reaches the outer edge', () => {
		expect(joystickBits({ x: 0, y: -(JOYSTICK_SPRINT_AT - 0.01) })).toBe(INPUT_BIT.Forward)
		expect(joystickBits({ x: 0, y: -JOYSTICK_SPRINT_AT })).toBe(
			INPUT_BIT.Forward | INPUT_BIT.Sprint,
		)
		expect(joystickBits({ x: 0, y: -1 })).toBe(INPUT_BIT.Forward | INPUT_BIT.Sprint)
	})
})

describe('touch buttons', () => {
	it('exposes one button per action', () => {
		expect(TOUCH_BUTTONS.map((entry) => entry.id)).toEqual(['use', 'attack', 'jump', 'sneak'])
	})

	it('maps every button to its input bit', () => {
		expect(touchButtonBit('jump')).toBe(INPUT_BIT.Jump)
		expect(touchButtonBit('sneak')).toBe(INPUT_BIT.Sneak)
		expect(touchButtonBit('attack')).toBe(INPUT_BIT.Attack)
		expect(touchButtonBit('use')).toBe(INPUT_BIT.UseItem)
		for (const entry of TOUCH_BUTTONS) expect(entry.bit).toBe(touchButtonBit(entry.id))
	})
})

describe('dragLookDelta', () => {
	it('scales the drag by dragSensitivity', () => {
		const delta = dragLookDelta({ x: 10, y: 20 }, { x: 40, y: 0 })
		expect(delta.yaw).toBeCloseTo(30 * TOUCH.dragSensitivity, 12)
		expect(delta.pitch).toBeCloseTo(20 * TOUCH.dragSensitivity, 12)
	})

	it('turns right when dragging right and looks down when dragging down', () => {
		expect(dragLookDelta({ x: 0, y: 0 }, { x: 5, y: 0 }).yaw).toBeGreaterThan(0)
		expect(dragLookDelta({ x: 0, y: 0 }, { x: -5, y: 0 }).yaw).toBeLessThan(0)
		expect(dragLookDelta({ x: 0, y: 0 }, { x: 0, y: 5 }).pitch).toBeLessThan(0)
		expect(dragLookDelta({ x: 0, y: 0 }, { x: 0, y: -5 }).pitch).toBeGreaterThan(0)
	})

	it('accepts an explicit sensitivity', () => {
		expect(dragLookDelta({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.01).yaw).toBeCloseTo(1, 12)
	})

	it('is zero when the pointer does not move', () => {
		const delta = dragLookDelta({ x: 7, y: 9 }, { x: 7, y: 9 })
		expect(delta.yaw).toBeCloseTo(0, 12)
		expect(delta.pitch).toBeCloseTo(0, 12)
	})
})

describe('tap and long-press thresholds', () => {
	it('treats a release strictly under tapMaxMs as a tap', () => {
		expect(isTap(1000, 1000)).toBe(true)
		expect(isTap(1000, 1000 + TOUCH.tapMaxMs - 1)).toBe(true)
		expect(isTap(1000, 1000 + TOUCH.tapMaxMs)).toBe(false)
	})

	it('treats longPressMs or more as a long press', () => {
		expect(isLongPress(1000, 1000 + TOUCH.longPressMs - 1)).toBe(false)
		expect(isLongPress(1000, 1000 + TOUCH.longPressMs)).toBe(true)
	})
})

describe('createPressTracker', () => {
	it('reports a tap just inside the tap window', () => {
		const press = createPressTracker()
		press.down(0)
		expect(press.poll(TOUCH.tapMaxMs - 1)).toBe('none')
		expect(press.up(TOUCH.tapMaxMs - 1)).toBe('tap')
		expect(press.phase()).toBe('idle')
	})

	it('reports nothing for a release exactly at tapMaxMs', () => {
		const press = createPressTracker()
		press.down(0)
		expect(press.up(TOUCH.tapMaxMs)).toBe('none')
	})

	it('reports nothing between the tap and long-press windows', () => {
		const press = createPressTracker()
		press.down(0)
		expect(press.up(TOUCH.longPressMs - 1)).toBe('none')
	})

	it('starts a hold exactly at longPressMs and ends it on release', () => {
		const press = createPressTracker()
		press.down(500)
		expect(press.poll(500 + TOUCH.longPressMs - 1)).toBe('none')
		expect(press.phase()).toBe('pending')
		expect(press.poll(500 + TOUCH.longPressMs)).toBe('holdStart')
		expect(press.phase()).toBe('holding')
		expect(press.poll(500 + TOUCH.longPressMs + 100)).toBe('none')
		expect(press.up(500 + TOUCH.longPressMs + 100)).toBe('holdEnd')
		expect(press.phase()).toBe('idle')
	})

	it('cancels without reporting a tap', () => {
		const press = createPressTracker()
		press.down(0)
		expect(press.cancel()).toBe('none')
		expect(press.up(10)).toBe('none')
	})

	it('ends a running hold on cancel', () => {
		const press = createPressTracker()
		press.down(0)
		expect(press.poll(TOUCH.longPressMs)).toBe('holdStart')
		expect(press.cancel()).toBe('holdEnd')
	})

	it('honours injected thresholds', () => {
		const press = createPressTracker({ tapMaxMs: 50, longPressMs: 100 })
		press.down(0)
		expect(press.up(49)).toBe('tap')
		press.down(0)
		expect(press.poll(100)).toBe('holdStart')
	})
})

describe('isTouchPointerType', () => {
	it('accepts only the pointer types from the contract', () => {
		expect(TOUCH.touchPointerTypes).toEqual(['touch', 'pen'])
		expect(isTouchPointerType('touch')).toBe(true)
		expect(isTouchPointerType('pen')).toBe(true)
		expect(isTouchPointerType('mouse')).toBe(false)
		expect(isTouchPointerType('')).toBe(false)
		expect(isTouchPointerType(undefined)).toBe(false)
		expect(isTouchPointerType(null)).toBe(false)
	})
})
