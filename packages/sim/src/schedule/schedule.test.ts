import { PERF, SYSTEM_ORDER } from '@voxelcraft/core-types'
import type { EcsWorld } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { SIM_DT, createSchedule, createTickRunner, defineSystem } from './index'

function stubWorld(onFlush: () => void): EcsWorld {
	return {
		create: () => 0,
		destroy: () => undefined,
		alive: () => false,
		add: () => undefined,
		get: () => undefined,
		has: () => false,
		remove: () => undefined,
		query: () => [],
		flush: onFlush,
		entityCount: 0,
	}
}

describe('createSchedule', () => {
	it('sorts systems into SYSTEM_ORDER regardless of registration order', () => {
		const schedule = createSchedule([
			defineSystem('combat', () => undefined),
			defineSystem('input', () => undefined),
			defineSystem('physics', () => undefined),
			defineSystem('light', () => undefined),
		])
		expect(schedule.systems.map((system) => system.name)).toEqual([
			'input',
			'light',
			'physics',
			'combat',
		])
	})

	it('rejects system names that are not in the contract order', () => {
		expect(() => defineSystem('renderChunks', () => undefined)).toThrow()
		expect(() => createSchedule([{ name: 'renderChunks', fn: () => undefined }])).toThrow()
	})

	it('covers only names the contract knows', () => {
		for (const name of SYSTEM_ORDER) {
			expect(() => defineSystem(name, () => undefined)).not.toThrow()
		}
	})
})

describe('createTickRunner', () => {
	it('runs systems in order with a fixed dt and flushes after each one', () => {
		const calls: string[] = []
		const world = stubWorld(() => calls.push('flush'))
		const schedule = createSchedule([
			defineSystem('physics', (_world, dt, tick) => calls.push(`physics:${dt}:${tick}`)),
			defineSystem('input', (_world, dt, tick) => calls.push(`input:${dt}:${tick}`)),
		])
		const runner = createTickRunner(world, schedule)
		expect(runner.runTick()).toBe(0)
		expect(runner.tick).toBe(1)
		expect(calls).toEqual([
			`input:${SIM_DT}:0`,
			'flush',
			`physics:${SIM_DT}:0`,
			'flush',
		])
		expect(SIM_DT).toBe(PERF.simTickMs / 1000)
	})

	it('runs one tick per simTickMs of real time', () => {
		let ticks = 0
		const world = stubWorld(() => undefined)
		const schedule = createSchedule([defineSystem('input', () => ticks++)])
		const runner = createTickRunner(world, schedule)
		expect(runner.advance(PERF.simTickMs)).toBe(1)
		expect(runner.advance(PERF.simTickMs / 2)).toBe(0)
		expect(runner.advance(PERF.simTickMs / 2)).toBe(1)
		expect(ticks).toBe(2)
		expect(runner.accumulatorMs).toBe(0)
		expect(runner.alpha).toBe(0)
	})

	it('clamps catch-up work to the accumulator clamp', () => {
		let ticks = 0
		const world = stubWorld(() => undefined)
		const schedule = createSchedule([defineSystem('input', () => ticks++)])
		const runner = createTickRunner(world, schedule)
		const ran = runner.advance(10_000)
		expect(ran).toBe(PERF.accumulatorClampMs / PERF.simTickMs)
		expect(ticks).toBe(ran)
		expect(runner.tick).toBe(ran)
	})

	it('ignores non-positive and non-finite time steps', () => {
		const world = stubWorld(() => undefined)
		const schedule = createSchedule([defineSystem('input', () => undefined)])
		const runner = createTickRunner(world, schedule)
		expect(runner.advance(0)).toBe(0)
		expect(runner.advance(-100)).toBe(0)
		expect(runner.advance(Number.NaN)).toBe(0)
		expect(runner.tick).toBe(0)
	})
})
