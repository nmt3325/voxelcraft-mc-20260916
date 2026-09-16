/**
 * Inbound rate limiting and the per tick work budget.
 *
 * Two different questions, both previously unanswered by the server:
 *
 * - How much may one client send? A token bucket per connection, in frames and
 *   in bytes. Over budget is a kick, not a pause: a peer that ignores the
 *   frozen cadence is either broken or hostile, and queueing its flood would
 *   only move the cost into the server's heap.
 * - How much may one tick cost the server? A work budget the tick loop spends,
 *   so a room full of clients cannot make a single tick encode a whole second
 *   of chunk columns.
 *
 * Both are derived from the frozen NET constants rather than invented, and both
 * are overridable so tests can widen or narrow them.
 */
import { NET } from '@voxelcraft/core-types'

export const INBOUND = {
	/**
	 * Frames per second one client may send. A well behaved client sends one
	 * Input per tick plus the odd edit, chat or pong, so four per tick is
	 * generous without leaving room for a flood.
	 */
	framesPerSecond: NET.tickHz * 4,
	/** Bucket depth, so a burst of buffered frames after a stall is not a kick. */
	frameBurst: NET.tickHz * 2,
	/** Payload bytes per second, from the frozen maximum message size. */
	bytesPerSecond: NET.maxMessageBytes,
	/** Two maximum sized messages back to back are still inside the budget. */
	byteBurst: NET.maxMessageBytes * 2,
} as const

export const WORK = {
	/**
	 * Chunk columns the whole server encodes in one tick. The frozen per client
	 * rate times maxPlayers, spread over the tick rate: the streamer's own token
	 * bucket already paces each client, so this only bites when several clients
	 * try to catch up in the same tick.
	 */
	chunkEncodesPerTick: Math.max(
		1,
		Math.ceil((NET.chunksPerSecondPerClient * NET.maxPlayers) / NET.tickHz),
	),
	/**
	 * Block edits one client may have applied in a single server tick. Placing
	 * or breaking four blocks inside 50 ms is already past human speed.
	 */
	editsPerTick: 4,
} as const

export interface InboundLimitOptions {
	readonly framesPerSecond?: number
	readonly frameBurst?: number
	readonly bytesPerSecond?: number
	readonly byteBurst?: number
}

export interface WorkBudgetOptions {
	readonly chunkEncodesPerTick?: number
	readonly editsPerTick?: number
}

export interface WorkBudget {
	readonly chunkEncodesPerTick: number
	readonly editsPerTick: number
}

/** A classic token bucket: `rate` tokens a second, never more than `burst`. */
export class TokenBucket {
	readonly ratePerSecond: number
	readonly burst: number
	private tokens: number
	private lastMs: number

	constructor(options: { ratePerSecond: number; burst: number; nowMs?: number }) {
		this.ratePerSecond = Math.max(0, options.ratePerSecond)
		this.burst = Math.max(0, options.burst)
		this.tokens = this.burst
		this.lastMs = options.nowMs ?? 0
	}

	/** Tokens available at the last time the bucket was asked. */
	get available(): number {
		return this.tokens
	}

	/** True when `cost` fitted the bucket. False means the peer is over budget. */
	take(cost: number, nowMs: number): boolean {
		this.refill(nowMs)
		if (!Number.isFinite(cost) || cost < 0) return false
		if (cost > this.tokens) return false
		this.tokens -= cost
		return true
	}

	private refill(nowMs: number): void {
		const elapsedMs = nowMs - this.lastMs
		this.lastMs = nowMs
		// A clock that went backwards must not mint tokens.
		if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return
		this.tokens = Math.min(this.burst, this.tokens + (elapsedMs / 1000) * this.ratePerSecond)
	}
}

/** The pair of buckets one connection is metered with. */
export interface InboundBuckets {
	readonly frames: TokenBucket
	readonly bytes: TokenBucket
}

export function createInboundBuckets(
	options: InboundLimitOptions = {},
	nowMs = 0,
): InboundBuckets {
	return {
		frames: new TokenBucket({
			ratePerSecond: options.framesPerSecond ?? INBOUND.framesPerSecond,
			burst: options.frameBurst ?? INBOUND.frameBurst,
			nowMs,
		}),
		bytes: new TokenBucket({
			ratePerSecond: options.bytesPerSecond ?? INBOUND.bytesPerSecond,
			burst: options.byteBurst ?? INBOUND.byteBurst,
			nowMs,
		}),
	}
}

export function resolveWorkBudget(options: WorkBudgetOptions = {}): WorkBudget {
	return {
		chunkEncodesPerTick: Math.max(
			1,
			Math.floor(options.chunkEncodesPerTick ?? WORK.chunkEncodesPerTick),
		),
		editsPerTick: Math.max(0, Math.floor(options.editsPerTick ?? WORK.editsPerTick)),
	}
}
