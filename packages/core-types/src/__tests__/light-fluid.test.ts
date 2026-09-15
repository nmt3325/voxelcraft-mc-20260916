import { describe, expect, it } from 'vitest'
import {
	MAX_LIGHT,
	getBlockLight,
	getSkyLight,
	lightKey,
	setBlockLight,
	setSkyLight,
} from '../light'
import { FLUID, FLUID_EMPTY, FLUID_MAX_LEVEL, packFluid, unpackFluid } from '../fluid'

describe('light nibbles', () => {
	it('stores sky and block light independently', () => {
		const light = new Uint8Array(4)
		for (let sky = 0; sky <= MAX_LIGHT; sky++) {
			for (let block = 0; block <= MAX_LIGHT; block++) {
				setSkyLight(light, 1, sky)
				setBlockLight(light, 1, block)
				expect(getSkyLight(light, 1)).toBe(sky)
				expect(getBlockLight(light, 1)).toBe(block)
			}
		}
		expect(light[0]).toBe(0)
	})

	it('changes lightKey only for optical changes', () => {
		const stone = { opacity: 15, emission: 0, skyPassThrough: false, skyFilter: 0 }
		const torch = { opacity: 0, emission: 14, skyPassThrough: true, skyFilter: 0 }
		expect(lightKey(stone)).toBe(lightKey({ ...stone }))
		expect(lightKey(stone)).not.toBe(lightKey(torch))
	})
})

describe('fluid packing', () => {
	it('round trips every state', () => {
		for (const kind of [FLUID.None, FLUID.Water, FLUID.Lava]) {
			for (let level = 0; level <= FLUID_MAX_LEVEL; level++) {
				for (const falling of [false, true]) {
					const packed = packFluid({ kind, level, falling })
					expect(packed).toBeGreaterThanOrEqual(0)
					expect(packed).toBeLessThanOrEqual(255)
					expect(unpackFluid(packed)).toEqual({ kind, level, falling })
				}
			}
		}
	})

	it('treats zero as empty', () => {
		expect(FLUID_EMPTY).toBe(0)
		expect(unpackFluid(FLUID_EMPTY)).toEqual({ kind: FLUID.None, level: 0, falling: false })
	})
})
