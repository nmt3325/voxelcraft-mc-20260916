import { NET } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import {
	SNAPSHOT_MS,
	TICKS_PER_SNAPSHOT,
	TICK_MS,
	TickLoop,
	isSnapshotTick,
} from './tick'

describe('tick cadence', () => {
	it('derives every number from the frozen NET constants', () => {
		expect(TICK_MS).toBe(50)
		expect(SNAPSHOT_MS).toBe(100)
		expect(TICKS_PER_SNAPSHOT).toBe(2)
		expect(NET.tickHz / NET.snapshotHz).toBe(TICKS_PER_SNAPSHOT)
	})

	it('snapshots on every other tick', () => {
		expect([1, 2, 3, 4, 5].map(isSnapshotTick)).toEqual([false, true, false, true, false])
	})
})

describe('TickLoop', () => {
	it('runs one tick per interval of wall clock time', () => {
		const ticks: number[] = []
		const loop = new TickLoop({
			onTick: (tick) => ticks.push(tick),
			intervalMs: 50,
			now: () => 0,
		})
		loop.start(1000)
		expect(loop.advanceTo(1049)).toBe(0)
		expect(loop.advanceTo(1050)).toBe(1)
		expect(loop.advanceTo(1150)).toBe(2)
		expect(ticks).toEqual([1, 2, 3])
		expect(loop.tick).toBe(3)
		loop.stop()
	})

	it('passes the current wall clock to the handler', () => {
		const seen: number[] = []
		const loop = new TickLoop({
			onTick: (_tick, nowMs) => seen.push(nowMs),
			intervalMs: 50,
			now: () => 0,
		})
		loop.start(0)
		loop.advanceTo(120)
		expect(seen).toEqual([120, 120])
		loop.stop()
	})

	it('caps a catch-up burst and then resynchronises', () => {
		let ran = 0
		const loop = new TickLoop({
			onTick: () => {
				ran += 1
			},
			intervalMs: 50,
			now: () => 0,
			maxCatchUp: 3,
		})
		loop.start(0)
		// Ten intervals of stall, but a burst may only run three ticks.
		expect(loop.advanceTo(500)).toBe(3)
		expect(ran).toBe(3)
		// The remaining backlog was dropped rather than replayed forever.
		expect(loop.advanceTo(500)).toBe(0)
		expect(loop.advanceTo(550)).toBe(1)
		loop.stop()
	})

	it('defaults to the frozen tick interval', () => {
		const loop = new TickLoop({ onTick: () => undefined })
		expect(loop.intervalMs).toBe(TICK_MS)
		expect(loop.tick).toBe(0)
	})

	it('starts once and stops cleanly', () => {
		const loop = new TickLoop({ onTick: () => undefined, now: () => 0 })
		expect(loop.running).toBe(false)
		loop.start(0)
		expect(loop.running).toBe(true)
		// Starting twice must not schedule a second timer.
		loop.start(0)
		expect(loop.running).toBe(true)
		loop.stop()
		expect(loop.running).toBe(false)
		// Stopping twice is a no-op.
		loop.stop()
		expect(loop.running).toBe(false)
	})
})
