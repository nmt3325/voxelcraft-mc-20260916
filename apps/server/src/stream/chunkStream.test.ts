import { NET } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import type { StreamTarget } from '../gameServer'
import { STREAM, createChunkStreamer, ringOrder } from './chunkStream'

const PLAYER = 7
const STRANGER = 404
const TICK_MS = 50

const keys = (targets: readonly StreamTarget[]): string[] =>
	targets.map((target) => `${target.cx},${target.cz}`)

describe('STREAM', () => {
	it('takes the radius and the rate from the frozen contract', () => {
		expect(STREAM.radius).toBe(NET.streamRadius)
		expect(STREAM.chunksPerSecond).toBe(NET.chunksPerSecondPerClient)
	})

	it('keeps a single burst below one whole second of budget', () => {
		expect(STREAM.maxBurst).toBeGreaterThan(0)
		expect(STREAM.maxBurst).toBeLessThan(STREAM.chunksPerSecond)
	})
})

describe('ringOrder', () => {
	it('covers the square (2r + 1)^2, corners included', () => {
		expect(ringOrder(0)).toEqual([{ cx: 0, cz: 0 }])
		expect(ringOrder(1)).toHaveLength(9)
		expect(ringOrder(2)).toHaveLength(25)
		expect(ringOrder(STREAM.radius)).toHaveLength((2 * STREAM.radius + 1) ** 2)
		// The corner proves the rule is max(|dx|, |dz|) <= r rather than a circle.
		expect(keys(ringOrder(2))).toContain('2,2')
	})

	it('orders nearest first with a cx then cz tie break', () => {
		expect(keys(ringOrder(1))).toEqual([
			'0,0',
			'-1,0',
			'0,-1',
			'0,1',
			'1,0',
			'-1,-1',
			'-1,1',
			'1,-1',
			'1,1',
		])
	})

	it('refuses a radius it cannot walk instead of guessing', () => {
		expect(ringOrder(-1)).toEqual([])
		expect(ringOrder(1.5)).toEqual([])
	})
})

describe('createChunkStreamer', () => {
	it('sends the column the player stands in first, then outwards', () => {
		const streamer = createChunkStreamer({ radius: 1, chunksPerSecond: 1000, maxBurst: 9 })
		streamer.track(PLAYER, 5, -3)
		// The bucket starts empty: the first call only learns what time it is.
		expect(streamer.next(PLAYER, 0)).toEqual([])
		expect(keys(streamer.next(PLAYER, 1000))).toEqual([
			'5,-3',
			'4,-3',
			'5,-4',
			'5,-2',
			'6,-3',
			'4,-4',
			'4,-2',
			'6,-4',
			'6,-2',
		])
	})

	it('averages chunksPerSecond over a simulated second of 20 Hz ticks', () => {
		const streamer = createChunkStreamer()
		streamer.track(PLAYER, 0, 0)
		streamer.next(PLAYER, 0)
		let sent = 0
		let widest = 0
		for (let nowMs = TICK_MS; nowMs <= 1000; nowMs += TICK_MS) {
			const batch = streamer.next(PLAYER, nowMs)
			sent += batch.length
			widest = Math.max(widest, batch.length)
		}
		// One second of budget, not twenty of them. Float drift can defer one.
		expect(sent).toBeGreaterThanOrEqual(STREAM.chunksPerSecond - 1)
		expect(sent).toBeLessThanOrEqual(STREAM.chunksPerSecond)
		// 24 columns over 20 ticks is one or two per tick, never a whole second.
		expect(widest).toBeLessThanOrEqual(2)
	})

	it('caps the catch up after a stall at maxBurst', () => {
		const streamer = createChunkStreamer()
		streamer.track(PLAYER, 0, 0)
		streamer.next(PLAYER, 0)
		expect(streamer.next(PLAYER, 10_000)).toHaveLength(STREAM.maxBurst)
	})

	it('never sends the same column twice', () => {
		const streamer = createChunkStreamer({ radius: 2, chunksPerSecond: 1000, maxBurst: 25 })
		streamer.track(PLAYER, 0, 0)
		streamer.next(PLAYER, 0)
		const batch = keys(streamer.next(PLAYER, 1000))
		expect(batch).toHaveLength(25)
		expect(new Set(batch).size).toBe(25)
		// Nothing is pending now, and asking again does not reopen the queue.
		expect(streamer.next(PLAYER, 2000)).toEqual([])
		expect(streamer.next(PLAYER, 3000)).toEqual([])
	})

	it('enqueues only the columns a recentre brings into range', () => {
		const streamer = createChunkStreamer({ radius: 1, chunksPerSecond: 1000, maxBurst: 9 })
		streamer.track(PLAYER, 0, 0)
		streamer.next(PLAYER, 0)
		expect(streamer.next(PLAYER, 1000)).toHaveLength(9)
		streamer.recenter(PLAYER, 1, 0)
		// Six of the nine columns around 1,0 are already on the client.
		expect(keys(streamer.next(PLAYER, 2000))).toEqual(['2,0', '2,-1', '2,1'])
	})

	it('drops the pending columns a recentre left behind', () => {
		const streamer = createChunkStreamer({ radius: 1, chunksPerSecond: 20, maxBurst: 1 })
		streamer.track(PLAYER, 0, 0)
		streamer.next(PLAYER, 0)
		expect(keys(streamer.next(PLAYER, TICK_MS))).toEqual(['0,0'])
		streamer.recenter(PLAYER, 100, 100)
		expect(keys(streamer.next(PLAYER, 2 * TICK_MS))).toEqual(['100,100'])
	})

	it('re-sends a column the player walked away from and came back to', () => {
		const streamer = createChunkStreamer({ radius: 0, chunksPerSecond: 1000, maxBurst: 4 })
		streamer.track(PLAYER, 0, 0)
		streamer.next(PLAYER, 0)
		expect(keys(streamer.next(PLAYER, 1000))).toEqual(['0,0'])
		// Out of range: the client is free to drop the column, so the server must
		// forget it rather than block the re-send for the whole session.
		streamer.recenter(PLAYER, 5, 0)
		expect(keys(streamer.next(PLAYER, 2000))).toEqual(['5,0'])
		streamer.recenter(PLAYER, 0, 0)
		expect(keys(streamer.next(PLAYER, 3000))).toEqual(['0,0'])
	})

	it('forgets only the columns that actually left the radius', () => {
		const streamer = createChunkStreamer({ radius: 1, chunksPerSecond: 1000, maxBurst: 9 })
		streamer.track(PLAYER, 0, 0)
		streamer.next(PLAYER, 0)
		expect(streamer.next(PLAYER, 1000)).toHaveLength(9)
		streamer.recenter(PLAYER, 1, 0)
		expect(keys(streamer.next(PLAYER, 2000))).toEqual(['2,0', '2,-1', '2,1'])
		// Walking back only re-sends the three columns the step above dropped.
		streamer.recenter(PLAYER, 0, 0)
		expect(keys(streamer.next(PLAYER, 3000))).toEqual(['-1,0', '-1,-1', '-1,1'])
	})

	it('never hands over more than the work budget it was given', () => {
		const streamer = createChunkStreamer({ radius: 1, chunksPerSecond: 1000, maxBurst: 9 })
		streamer.track(PLAYER, 0, 0)
		streamer.next(PLAYER, 0)
		expect(keys(streamer.next(PLAYER, 1000, 2))).toEqual(['0,0', '-1,0'])
		expect(streamer.next(PLAYER, 1000, 0)).toEqual([])
		// The deferred columns are still queued: a budget is not a loss.
		expect(streamer.next(PLAYER, 2000, 100)).toHaveLength(7)
	})

	it('forgets everything it knew about a player', () => {
		const streamer = createChunkStreamer({ radius: 1, chunksPerSecond: 1000, maxBurst: 9 })
		streamer.track(PLAYER, 0, 0)
		streamer.next(PLAYER, 0)
		expect(streamer.next(PLAYER, 1000)).toHaveLength(9)
		streamer.forget(PLAYER)
		expect(streamer.next(PLAYER, 2000)).toEqual([])
		// A rejoin is a fresh client: the sent set left with the old state.
		streamer.track(PLAYER, 0, 0)
		streamer.next(PLAYER, 3000)
		expect(keys(streamer.next(PLAYER, 4000))[0]).toBe('0,0')
	})

	it('tolerates a player it has never seen', () => {
		const streamer = createChunkStreamer()
		expect(streamer.next(STRANGER, 0)).toEqual([])
		expect(() => streamer.recenter(STRANGER, 1, 1)).not.toThrow()
		expect(() => streamer.forget(STRANGER)).not.toThrow()
		expect(streamer.next(STRANGER, 1000)).toEqual([])
	})
})
