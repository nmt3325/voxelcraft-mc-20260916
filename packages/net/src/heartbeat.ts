/**
 * Heartbeat bookkeeping, driven entirely by the frozen NET timings.
 *
 * The clock is injected on every call instead of read from Date.now inside the
 * class, so tests can step time deterministically and the server can reuse the
 * single timestamp it already took for the tick.
 */
import { NET } from '@voxelcraft/core-types'

export interface HeartbeatSnapshot {
	readonly lastSeenMs: number
	readonly lastPingMs: number
	readonly pendingNonce: number | null
	readonly rttMs: number | null
}

export class Heartbeat {
	private lastSeen: number
	private lastPing: number
	private pending: number | null = null
	private pendingSentMs = 0
	private rtt: number | null = null
	private nonceSeq = 0

	constructor(nowMs: number) {
		this.lastSeen = nowMs
		// Counts as if a ping just went out, so a fresh session is not pinged on
		// its very first tick.
		this.lastPing = nowMs
	}

	get lastSeenMs(): number {
		return this.lastSeen
	}

	get rttMs(): number | null {
		return this.rtt
	}

	get pendingNonce(): number | null {
		return this.pending
	}

	snapshot(): HeartbeatSnapshot {
		return {
			lastSeenMs: this.lastSeen,
			lastPingMs: this.lastPing,
			pendingNonce: this.pending,
			rttMs: this.rtt,
		}
	}

	/** Any inbound traffic proves the peer is alive, not just a pong. */
	markSeen(nowMs: number): void {
		this.lastSeen = nowMs
	}

	shouldPing(nowMs: number): boolean {
		return nowMs - this.lastPing >= NET.heartbeatMs
	}

	/**
	 * Claims the next nonce to put on the wire. An unanswered nonce is simply
	 * replaced: the timeout, not the pong, is what closes a dead session.
	 */
	nextPing(nowMs: number): number {
		this.nonceSeq = (this.nonceSeq + 1) >>> 0
		if (this.nonceSeq === 0) this.nonceSeq = 1
		this.pending = this.nonceSeq
		this.pendingSentMs = nowMs
		this.lastPing = nowMs
		return this.nonceSeq
	}

	/** False for a nonce we never sent, which the caller may treat as noise. */
	onPong(nonce: number, nowMs: number): boolean {
		this.markSeen(nowMs)
		if (this.pending === null || nonce !== this.pending) return false
		this.rtt = Math.max(0, nowMs - this.pendingSentMs)
		this.pending = null
		return true
	}

	isTimedOut(nowMs: number): boolean {
		return nowMs - this.lastSeen >= NET.timeoutMs
	}

	/** Milliseconds until this session would time out, floored at 0. */
	msUntilTimeout(nowMs: number): number {
		return Math.max(0, NET.timeoutMs - (nowMs - this.lastSeen))
	}
}
