import { NET } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { INBOUND, TokenBucket, WORK, createInboundBuckets, resolveWorkBudget } from './rateLimit'

describe('INBOUND and WORK', () => {
	it('derive every limit from the frozen contract', () => {
		expect(INBOUND.framesPerSecond).toBe(NET.tickHz * 4)
		expect(INBOUND.frameBurst).toBe(NET.tickHz * 2)
		expect(INBOUND.bytesPerSecond).toBe(NET.maxMessageBytes)
		expect(WORK.chunkEncodesPerTick).toBe(
			Math.ceil((NET.chunksPerSecondPerClient * NET.maxPlayers) / NET.tickHz),
		)
	})

	it('leaves a well behaved client plenty of room', () => {
		// One Input per tick is the cadence; the budget is several times that.
		expect(INBOUND.framesPerSecond).toBeGreaterThan(NET.tickHz)
		expect(INBOUND.frameBurst).toBeGreaterThan(NET.inputBufferTicks)
		expect(WORK.editsPerTick).toBeGreaterThan(0)
	})
})

describe('TokenBucket', () => {
	it('starts full and spends down to empty', () => {
		const bucket = new TokenBucket({ ratePerSecond: 10, burst: 5, nowMs: 0 })
		expect(bucket.available).toBe(5)
		for (let i = 0; i < 5; i++) expect(bucket.take(1, 0)).toBe(true)
		expect(bucket.take(1, 0)).toBe(false)
	})

	it('refills at the rate it was given and never past the burst', () => {
		const bucket = new TokenBucket({ ratePerSecond: 10, burst: 5, nowMs: 0 })
		expect(bucket.take(5, 0)).toBe(true)
		// 100 ms at 10 per second is exactly one token.
		expect(bucket.take(1, 100)).toBe(true)
		expect(bucket.take(1, 100)).toBe(false)
		// A ten second stall is still worth one burst, not ten seconds of them.
		expect(bucket.take(5, 10_000)).toBe(true)
		expect(bucket.take(1, 10_000)).toBe(false)
	})

	it('refuses a cost it can never afford and a clock that went backwards', () => {
		const bucket = new TokenBucket({ ratePerSecond: 10, burst: 5, nowMs: 1000 })
		expect(bucket.take(6, 1000)).toBe(false)
		expect(bucket.take(Number.NaN, 1000)).toBe(false)
		expect(bucket.take(-1, 1000)).toBe(false)
		// Time travel must not mint tokens.
		expect(bucket.take(5, 0)).toBe(true)
		expect(bucket.take(1, 0)).toBe(false)
	})
})

describe('createInboundBuckets', () => {
	it('honours an override and otherwise takes the defaults', () => {
		const tight = createInboundBuckets({ framesPerSecond: 1, frameBurst: 1 }, 0)
		expect(tight.frames.take(1, 0)).toBe(true)
		expect(tight.frames.take(1, 0)).toBe(false)
		const loose = createInboundBuckets({}, 0)
		expect(loose.frames.burst).toBe(INBOUND.frameBurst)
		expect(loose.frames.ratePerSecond).toBe(INBOUND.framesPerSecond)
		expect(loose.bytes.ratePerSecond).toBe(INBOUND.bytesPerSecond)
	})
})

describe('resolveWorkBudget', () => {
	it('falls back to the frozen budget', () => {
		expect(resolveWorkBudget()).toEqual({
			chunkEncodesPerTick: WORK.chunkEncodesPerTick,
			editsPerTick: WORK.editsPerTick,
		})
	})

	it('keeps the budget whole, and keeps at least one column per tick', () => {
		expect(resolveWorkBudget({ chunkEncodesPerTick: 0, editsPerTick: 2.9 })).toEqual({
			chunkEncodesPerTick: 1,
			editsPerTick: 2,
		})
		expect(resolveWorkBudget({ chunkEncodesPerTick: -4, editsPerTick: -1 })).toEqual({
			chunkEncodesPerTick: 1,
			editsPerTick: 0,
		})
	})
})
