/**
 * Per client chunk streaming queue.
 *
 * Free of sockets, clocks and timers on purpose: GameServer owns the wire
 * format and hands this module the timestamp it already took for the tick, so
 * every rule below can be exercised with plain numbers.
 */
import { NET, chunkKey, type EntityId } from '@voxelcraft/core-types'
import type { ChunkStreamer, StreamTarget } from '../gameServer'

/**
 * Streaming budget.
 *
 * radius and chunksPerSecond are the frozen contract values. maxBurst is local
 * policy: half a second of budget, so a runner that stalled for two seconds
 * catches up over a few ticks instead of encoding 48 columns inside one tick.
 */
export const STREAM = {
	radius: NET.streamRadius,
	chunksPerSecond: NET.chunksPerSecondPerClient,
	maxBurst: Math.max(1, Math.round(NET.chunksPerSecondPerClient / 2)),
} as const

export interface ChunkStreamerOptions {
	readonly radius?: number
	readonly chunksPerSecond?: number
	readonly maxBurst?: number
}

/** Shared answer for "nothing this tick". Readonly, so no caller can fill it. */
const NOTHING: readonly StreamTarget[] = []

interface ClientQueue {
	cx: number
	cz: number
	/** Still to send, nearest first from the current centre. */
	queue: StreamTarget[]
	/**
	 * Columns already shipped, by chunk key. A recentre must not resend one that
	 * is still in range, and must forget one that left it: a client drops a
	 * column it can no longer see, so a session long set would permanently
	 * starve a player who walks out and back again.
	 */
	readonly sent: Map<string, StreamTarget>
	/** Whole plus fractional tokens; only the whole ones may be spent. */
	tokens: number
	/** null until the first next(): track() is never given a clock. */
	lastRefillMs: number | null
}

function distanceSquared(target: StreamTarget): number {
	return target.cx * target.cx + target.cz * target.cz
}

/**
 * Nearest first, with cx then cz as the tie break, so the order is a fact a
 * test can assert rather than whatever the iteration happened to produce.
 */
function byDistanceThenCoords(a: StreamTarget, b: StreamTarget): number {
	const byDistance = distanceSquared(a) - distanceSquared(b)
	if (byDistance !== 0) return byDistance
	if (a.cx !== b.cx) return a.cx - b.cx
	return a.cz - b.cz
}

/**
 * Offsets around the centre column, nearest first. Index 0 is always 0,0: the
 * column the player is standing in ships before anything else.
 *
 * In range is the square rule, max(|dx|, |dz|) <= radius, which is exactly
 * (2r + 1)^2 columns and includes the corners. A circle would stream fewer
 * columns but leave the diagonal view distance short of the frozen radius.
 */
export function ringOrder(radius: number): StreamTarget[] {
	// A fractional or negative radius is a caller bug, not a smaller world.
	if (!Number.isInteger(radius) || radius < 0) return []
	const targets: StreamTarget[] = []
	// Counting up and subtracting keeps the centre a positive zero: starting at
	// -radius yields -0 when radius is 0, which then leaks into every consumer.
	const span = 2 * radius
	for (let ix = 0; ix <= span; ix++) {
		for (let iz = 0; iz <= span; iz++) targets.push({ cx: ix - radius, cz: iz - radius })
	}
	return targets.sort(byDistanceThenCoords)
}

export function createChunkStreamer(options: ChunkStreamerOptions = {}): ChunkStreamer {
	const radius = options.radius ?? STREAM.radius
	const chunksPerSecond = options.chunksPerSecond ?? STREAM.chunksPerSecond
	const maxBurst = options.maxBurst ?? STREAM.maxBurst
	const offsets = ringOrder(radius)
	const clients = new Map<EntityId, ClientQueue>()

	/** The same square rule ringOrder() uses, applied to an absolute column. */
	function inRange(state: ClientQueue, target: StreamTarget): boolean {
		return Math.max(Math.abs(target.cx - state.cx), Math.abs(target.cz - state.cz)) <= radius
	}

	/** In-range columns around the centre that are not on the client yet. */
	function pending(state: ClientQueue): StreamTarget[] {
		const targets: StreamTarget[] = []
		for (const offset of offsets) {
			const cx = state.cx + offset.cx
			const cz = state.cz + offset.cz
			if (!state.sent.has(chunkKey(cx, cz))) targets.push({ cx, cz })
		}
		return targets
	}

	/** Forgets the columns the new centre pushed out of the stream radius. */
	function forgetOutOfRange(state: ClientQueue): void {
		for (const [key, target] of state.sent) {
			if (!inRange(state, target)) state.sent.delete(key)
		}
	}

	function refill(state: ClientQueue, nowMs: number): void {
		if (state.lastRefillMs === null) {
			// First sighting of the clock: prime it and let the next tick pay out.
			state.lastRefillMs = nowMs
			return
		}
		const elapsedMs = nowMs - state.lastRefillMs
		state.lastRefillMs = nowMs
		if (elapsedMs <= 0) return
		// next() runs at 20 Hz, so one tick is worth a fraction of a token. Keeping
		// the fraction is what makes the average come out at chunksPerSecond.
		state.tokens = Math.min(maxBurst, state.tokens + (elapsedMs / 1000) * chunksPerSecond)
	}

	return {
		track(playerId: EntityId, cx: number, cz: number): void {
			const state: ClientQueue = {
				cx,
				cz,
				queue: [],
				sent: new Map<string, StreamTarget>(),
				tokens: 0,
				lastRefillMs: null,
			}
			state.queue = pending(state)
			clients.set(playerId, state)
		},

		recenter(playerId: EntityId, cx: number, cz: number): void {
			const state = clients.get(playerId)
			if (state === undefined) return
			state.cx = cx
			state.cz = cz
			// A column that is still in range stays sent; one that left is forgotten
			// so it can be streamed again when the player comes back.
			forgetOutOfRange(state)
			// The rest is re-ordered around the new centre, newly in-range columns
			// join it, and what fell out of range is dropped from the queue.
			state.queue = pending(state)
		},

		forget(playerId: EntityId): void {
			clients.delete(playerId)
		},

		next(
			playerId: EntityId,
			nowMs: number,
			limit = Number.POSITIVE_INFINITY,
		): readonly StreamTarget[] {
			const state = clients.get(playerId)
			// A tick can race a disconnect, so an unknown player is normal here.
			if (state === undefined) return NOTHING
			refill(state, nowMs)
			// `limit` is the caller's remaining per tick work budget. Only what is
			// actually handed over costs a token and is marked sent, so a column the
			// server had no room for stays queued instead of being lost.
			const allowed = Number.isFinite(limit)
				? Math.max(0, Math.floor(limit))
				: state.queue.length
			const budget = Math.min(Math.floor(state.tokens), state.queue.length, allowed)
			if (budget <= 0) return NOTHING
			state.tokens -= budget
			const targets = state.queue.splice(0, budget)
			for (const target of targets) state.sent.set(chunkKey(target.cx, target.cz), target)
			return targets
		},
	}
}
