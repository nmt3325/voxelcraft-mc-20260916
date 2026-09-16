import { NET } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { Heartbeat } from './heartbeat'

describe('Heartbeat', () => {
	it('starts quiet: no ping due, nothing timed out', () => {
		const hb = new Heartbeat(1_000)
		expect(hb.shouldPing(1_000)).toBe(false)
		expect(hb.isTimedOut(1_000)).toBe(false)
		expect(hb.pendingNonce).toBeNull()
		expect(hb.rttMs).toBeNull()
		expect(hb.lastSeenMs).toBe(1_000)
	})

	it('wants a ping once heartbeatMs has elapsed', () => {
		const hb = new Heartbeat(0)
		expect(hb.shouldPing(NET.heartbeatMs - 1)).toBe(false)
		expect(hb.shouldPing(NET.heartbeatMs)).toBe(true)
	})

	it('issues increasing nonces and clears the ping schedule', () => {
		const hb = new Heartbeat(0)
		expect(hb.nextPing(NET.heartbeatMs)).toBe(1)
		expect(hb.pendingNonce).toBe(1)
		expect(hb.shouldPing(NET.heartbeatMs)).toBe(false)
		expect(hb.nextPing(NET.heartbeatMs * 2)).toBe(2)
	})

	it('measures rtt from the matching pong', () => {
		const hb = new Heartbeat(0)
		const nonce = hb.nextPing(1_000)
		expect(hb.onPong(nonce, 1_040)).toBe(true)
		expect(hb.rttMs).toBe(40)
		expect(hb.pendingNonce).toBeNull()
	})

	it('ignores an unknown pong nonce but still counts it as traffic', () => {
		const hb = new Heartbeat(0)
		hb.nextPing(1_000)
		expect(hb.onPong(999, 1_200)).toBe(false)
		expect(hb.rttMs).toBeNull()
		expect(hb.lastSeenMs).toBe(1_200)
	})

	it('times out after timeoutMs of silence, and markSeen resets it', () => {
		const hb = new Heartbeat(0)
		expect(hb.isTimedOut(NET.timeoutMs - 1)).toBe(false)
		expect(hb.msUntilTimeout(NET.timeoutMs - 1)).toBe(1)
		expect(hb.isTimedOut(NET.timeoutMs)).toBe(true)
		expect(hb.msUntilTimeout(NET.timeoutMs + 5_000)).toBe(0)
		hb.markSeen(NET.timeoutMs)
		expect(hb.isTimedOut(NET.timeoutMs)).toBe(false)
	})

	it('an unanswered ping is replaced rather than accumulating', () => {
		const hb = new Heartbeat(0)
		hb.nextPing(1_000)
		const second = hb.nextPing(3_000)
		expect(hb.pendingNonce).toBe(second)
		// The stale nonce no longer matches, so it cannot set a bogus rtt.
		expect(hb.onPong(1, 3_010)).toBe(false)
		expect(hb.rttMs).toBeNull()
	})

	it('snapshot reports the bookkeeping', () => {
		const hb = new Heartbeat(0)
		const nonce = hb.nextPing(500)
		hb.onPong(nonce, 520)
		expect(hb.snapshot()).toEqual({
			lastSeenMs: 520,
			lastPingMs: 500,
			pendingNonce: null,
			rttMs: 20,
		})
	})
})
