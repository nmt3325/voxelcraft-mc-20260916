import { INPUT_BIT, NET } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { INPUT_GATE, InputGate, type GatedInput } from './inputGate'
import { SPRINT_SPEED, WALK_SPEED, speedFor } from './movement'

function input(tick: number, bits = 0): GatedInput {
	return { tick, bits }
}

describe('INPUT_GATE', () => {
	it('takes its slack and its flood threshold from the frozen contract', () => {
		expect(INPUT_GATE.perTick).toBe(1)
		expect(INPUT_GATE.slack).toBe(NET.inputBufferTicks)
		expect(INPUT_GATE.floodRejects).toBe(NET.tickHz)
	})
})

describe('InputGate', () => {
	it('applies one input per tick plus the frozen jitter slack', () => {
		const gate = new InputGate()
		let applied = 0
		for (let i = 0; i < 50; i++) {
			if (gate.admit(input(i), 7).ok) applied += 1
		}
		expect(applied).toBe(INPUT_GATE.perTick + INPUT_GATE.slack)
		expect(gate.rejectedThisTick).toBe(50 - applied)
	})

	it('pays out a fresh budget on the next server tick', () => {
		const gate = new InputGate()
		for (let i = 0; i < 50; i++) gate.admit(input(i), 7)
		const next = gate.admit(input(100), 8)
		expect(next.ok).toBe(true)
		if (!next.ok) return
		expect(next.horizontalBudget).toBeCloseTo(WALK_SPEED, 6)
		expect(gate.appliedThisTick).toBe(1)
		expect(gate.spentThisTick).toBe(0)
	})

	it('refuses a client tick that does not move forward', () => {
		const gate = new InputGate()
		expect(gate.admit(input(5), 1).ok).toBe(true)
		expect(gate.lastClientTick).toBe(5)
		// A duplicate and a reorder are both replays, in a later tick as well.
		expect(gate.admit(input(5), 2)).toEqual({ ok: false, reason: 'replay', flooding: false })
		expect(gate.admit(input(4), 2)).toEqual({ ok: false, reason: 'replay', flooding: false })
		expect(gate.admit(input(6), 2).ok).toBe(true)
	})

	it('shares one walk budget between every input inside a tick', () => {
		const gate = new InputGate()
		const first = gate.admit(input(1), 3)
		expect(first.ok).toBe(true)
		if (!first.ok) return
		expect(first.horizontalBudget).toBeCloseTo(WALK_SPEED, 6)
		gate.spend(WALK_SPEED)
		const second = gate.admit(input(2), 3)
		expect(second.ok).toBe(true)
		if (!second.ok) return
		// The tick is spent: the second input may look around but not travel.
		expect(second.horizontalBudget).toBeCloseTo(0, 6)
	})

	it('budgets a sprint at the frozen sprint speed', () => {
		const gate = new InputGate()
		const verdict = gate.admit(input(1, INPUT_BIT.Sprint), 1)
		expect(verdict.ok).toBe(true)
		if (!verdict.ok) return
		expect(verdict.horizontalBudget).toBeCloseTo(SPRINT_SPEED, 6)
		expect(verdict.horizontalBudget).toBeCloseTo(speedFor(INPUT_BIT.Sprint), 6)
	})

	it('ignores a spend that is not a real distance', () => {
		const gate = new InputGate()
		gate.admit(input(1), 1)
		gate.spend(Number.NaN)
		gate.spend(-5)
		expect(gate.spentThisTick).toBe(0)
	})

	it('reports a flood once the rejections stop looking like jitter', () => {
		const gate = new InputGate()
		let flooding = false
		for (let i = 0; i < 200; i++) {
			const verdict = gate.admit(input(1), 4)
			if (!verdict.ok) flooding = verdict.flooding
		}
		expect(flooding).toBe(true)
	})

	// The regression: 200 inputs inside one server tick used to be 200 movement
	// steps. Whatever the gate grants now, it adds up to a single tick of walk.
	it('never lets a burst of inputs beat one tick of travel', () => {
		const gate = new InputGate()
		let granted = 0
		for (let i = 0; i < 200; i++) {
			const verdict = gate.admit(input(i), 9)
			if (!verdict.ok) continue
			// The server never grants more than the input asked for, either.
			const step = Math.min(verdict.horizontalBudget, WALK_SPEED)
			granted += step
			gate.spend(step)
		}
		expect(granted).toBeLessThanOrEqual(WALK_SPEED + 1e-6)
		expect(granted).toBeGreaterThan(0)
	})
})
