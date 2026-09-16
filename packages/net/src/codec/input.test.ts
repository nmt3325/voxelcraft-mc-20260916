import { INPUT_BIT } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import {
	clampYawPitch,
	describeInput,
	hasInput,
	inputBitsFrom,
	setInput,
	type InputFlags,
	type InputName,
} from './input'

const NAMES = Object.keys(INPUT_BIT) as InputName[]

const ALL_FLAGS: InputFlags = {}
for (const name of NAMES) ALL_FLAGS[name] = true

describe('input bitfield', () => {
	it('sets and clears every bit independently', () => {
		for (const name of NAMES) {
			const bit = INPUT_BIT[name]
			const set = setInput(0, bit, true)
			expect(hasInput(set, bit)).toBe(true)
			expect(setInput(set, bit, true)).toBe(set)
			for (const other of NAMES) {
				if (other === name) continue
				expect(hasInput(set, INPUT_BIT[other])).toBe(false)
			}
			expect(setInput(set, bit, false)).toBe(0)
		}
	})

	it('builds bits from flags', () => {
		expect(inputBitsFrom({})).toBe(0)
		expect(inputBitsFrom({ Forward: false })).toBe(0)
		expect(inputBitsFrom({ Forward: true, Attack: true })).toBe(
			INPUT_BIT.Forward | INPUT_BIT.Attack,
		)
		const all = inputBitsFrom(ALL_FLAGS)
		for (const name of NAMES) expect(hasInput(all, INPUT_BIT[name])).toBe(true)
	})

	it('describes the set bits in declaration order', () => {
		expect(describeInput(0)).toEqual([])
		expect(describeInput(INPUT_BIT.Sneak | INPUT_BIT.Forward)).toEqual(['Forward', 'Sneak'])
		expect(describeInput(inputBitsFrom(ALL_FLAGS))).toEqual(NAMES)
	})
})

describe('clampYawPitch', () => {
	it('wraps yaw into [-PI, PI)', () => {
		expect(clampYawPitch(0, 0).yaw).toBe(0)
		expect(clampYawPitch(Math.PI, 0).yaw).toBeCloseTo(-Math.PI, 2)
		expect(clampYawPitch(-Math.PI, 0).yaw).toBeCloseTo(-Math.PI, 2)
		expect(clampYawPitch(3 * Math.PI, 0).yaw).toBeCloseTo(-Math.PI, 2)
		expect(clampYawPitch(-Math.PI - 1, 0).yaw).toBeCloseTo(Math.PI - 1, 2)
		expect(clampYawPitch(Math.PI - 0.01, 0).yaw).toBeCloseTo(Math.PI - 0.01, 2)
		expect(clampYawPitch(2 * Math.PI, 0).yaw).toBeCloseTo(0, 2)
	})

	it('clamps pitch into [-PI/2, PI/2]', () => {
		expect(clampYawPitch(0, Math.PI).pitch).toBeCloseTo(Math.PI / 2, 2)
		expect(clampYawPitch(0, -Math.PI).pitch).toBeCloseTo(-Math.PI / 2, 2)
		expect(clampYawPitch(0, Math.PI / 2).pitch).toBeCloseTo(Math.PI / 2, 2)
		expect(clampYawPitch(0, -Math.PI / 2).pitch).toBeCloseTo(-Math.PI / 2, 2)
		expect(clampYawPitch(0, 0.5).pitch).toBeCloseTo(0.5, 2)
	})

	it('collapses a non-finite angle instead of spreading NaN', () => {
		expect(clampYawPitch(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ yaw: 0, pitch: 0 })
	})
})
