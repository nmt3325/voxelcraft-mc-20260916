/**
 * Pure touch-control logic: no DOM, no timers and no `Date.now()`. Every
 * function takes the numbers it needs, so the overlay stays a thin adapter and
 * all of the behaviour below is testable under vitest's `environment: node`.
 *
 * Geometry and thresholds come from the frozen `TOUCH` contract; the defaults
 * are only overridable so tests can pin an exact boundary.
 */

import { INPUT_BIT, TOUCH } from '@voxelcraft/core-types'

export interface Vec2 {
	readonly x: number
	readonly y: number
}

/** Camera deltas in radians, to be added to the caller's own yaw/pitch. */
export interface LookDelta {
	readonly yaw: number
	readonly pitch: number
}

export type TouchButtonId = 'jump' | 'sneak' | 'attack' | 'use'

export interface TouchButtonDef {
	readonly id: TouchButtonId
	readonly label: string
	readonly bit: number
	readonly testId: string
}

/** Rendered as a 2x2 cluster in this order: use, attack, jump, sneak. */
export const TOUCH_BUTTONS: readonly TouchButtonDef[] = [
	{ id: 'use', label: 'Use', bit: INPUT_BIT.UseItem, testId: 'touch-button-use' },
	{ id: 'attack', label: 'Hit', bit: INPUT_BIT.Attack, testId: 'touch-button-attack' },
	{ id: 'jump', label: 'Jump', bit: INPUT_BIT.Jump, testId: 'touch-button-jump' },
	{ id: 'sneak', label: 'Sneak', bit: INPUT_BIT.Sneak, testId: 'touch-button-sneak' },
]

const BUTTON_BITS: Readonly<Record<TouchButtonId, number>> = {
	use: INPUT_BIT.UseItem,
	attack: INPUT_BIT.Attack,
	jump: INPUT_BIT.Jump,
	sneak: INPUT_BIT.Sneak,
}

export function touchButtonBit(id: TouchButtonId): number {
	return BUTTON_BITS[id]
}

/** sin(22.5deg): half-width of one of the eight joystick sectors. */
export const JOYSTICK_SECTOR = Math.sin(Math.PI / 8)

/** Stick magnitude (0..1) that counts as "pushed to the outer edge". */
export const JOYSTICK_SPRINT_AT = 0.9

export function isTouchPointerType(pointerType: string | null | undefined): boolean {
	return typeof pointerType === 'string' && TOUCH.touchPointerTypes.includes(pointerType)
}

/**
 * Stick offset in radius units, clamped to the unit circle. `+x` is right and
 * `+y` is down, matching client (screen) coordinates.
 */
export function joystickVector(
	center: Vec2,
	point: Vec2,
	radius: number = TOUCH.joystickRadiusPx,
): Vec2 {
	if (!(radius > 0)) return { x: 0, y: 0 }
	const x = (point.x - center.x) / radius
	const y = (point.y - center.y) / radius
	const magnitude = Math.hypot(x, y)
	if (!(magnitude > 1)) return { x, y }
	return { x: x / magnitude, y: y / magnitude }
}

export function joystickMagnitude(vector: Vec2): number {
	return Math.hypot(vector.x, vector.y)
}

export interface JoystickOptions {
	readonly deadZone?: number
	readonly sprintAt?: number
}

/**
 * Maps a stick vector to movement bits. Inside (or exactly on) the dead zone
 * the stick is neutral; outside it the direction is quantised into eight
 * sectors, and the outer edge adds Sprint.
 */
export function joystickBits(vector: Vec2, options: JoystickOptions = {}): number {
	const deadZone = options.deadZone ?? TOUCH.joystickDeadZone
	const sprintAt = options.sprintAt ?? JOYSTICK_SPRINT_AT
	const magnitude = joystickMagnitude(vector)
	if (!(magnitude > deadZone)) return 0

	const ux = vector.x / magnitude
	const uy = vector.y / magnitude
	let bits = 0
	if (uy <= -JOYSTICK_SECTOR) bits |= INPUT_BIT.Forward
	else if (uy >= JOYSTICK_SECTOR) bits |= INPUT_BIT.Back
	if (ux <= -JOYSTICK_SECTOR) bits |= INPUT_BIT.Left
	else if (ux >= JOYSTICK_SECTOR) bits |= INPUT_BIT.Right
	if (magnitude >= sprintAt) bits |= INPUT_BIT.Sprint
	return bits
}

/**
 * Look delta for a drag from `from` to `to`. Dragging right turns right and
 * dragging up looks up, so the screen-space dy is inverted.
 */
export function dragLookDelta(
	from: Vec2,
	to: Vec2,
	sensitivity: number = TOUCH.dragSensitivity,
): LookDelta {
	return { yaw: (to.x - from.x) * sensitivity, pitch: -(to.y - from.y) * sensitivity }
}

/** A release strictly under `tapMaxMs` is a tap. */
export function isTap(downMs: number, upMs: number, tapMaxMs: number = TOUCH.tapMaxMs): boolean {
	const held = upMs - downMs
	return held >= 0 && held < tapMaxMs
}

/** Holding for `longPressMs` or more is a long press. */
export function isLongPress(
	downMs: number,
	nowMs: number,
	longPressMs: number = TOUCH.longPressMs,
): boolean {
	return nowMs - downMs >= longPressMs
}

export type PressPhase = 'idle' | 'pending' | 'holding'
export type PressPollResult = 'holdStart' | 'none'
export type PressReleaseResult = 'tap' | 'holdEnd' | 'none'

export interface PressTracker {
	phase(): PressPhase
	down(nowMs: number): void
	/** Returns 'holdStart' exactly once, the first poll past the threshold. */
	poll(nowMs: number): PressPollResult
	up(nowMs: number): PressReleaseResult
	cancel(): PressReleaseResult
}

export interface PressTrackerOptions {
	readonly tapMaxMs?: number
	readonly longPressMs?: number
}

/**
 * Tap vs long-press state machine. Timestamps are injected by the caller, so
 * the same sequence always produces the same result.
 */
export function createPressTracker(options: PressTrackerOptions = {}): PressTracker {
	const tapMaxMs = options.tapMaxMs ?? TOUCH.tapMaxMs
	const longPressMs = options.longPressMs ?? TOUCH.longPressMs
	let phase: PressPhase = 'idle'
	let downAt = 0

	return {
		phase: () => phase,
		down(nowMs: number): void {
			phase = 'pending'
			downAt = nowMs
		},
		poll(nowMs: number): PressPollResult {
			if (phase !== 'pending') return 'none'
			if (!isLongPress(downAt, nowMs, longPressMs)) return 'none'
			phase = 'holding'
			return 'holdStart'
		},
		up(nowMs: number): PressReleaseResult {
			const wasHolding = phase === 'holding'
			const wasPending = phase === 'pending'
			phase = 'idle'
			if (wasHolding) return 'holdEnd'
			if (wasPending && isTap(downAt, nowMs, tapMaxMs)) return 'tap'
			return 'none'
		},
		cancel(): PressReleaseResult {
			const wasHolding = phase === 'holding'
			phase = 'idle'
			return wasHolding ? 'holdEnd' : 'none'
		},
	}
}
