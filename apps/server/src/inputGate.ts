/**
 * Per client input admission.
 *
 * The authority here is the server tick, not the packet. onInput used to apply
 * one movement step per Input frame and only rejected a tick older than the
 * last one it saw, so a client that sent 200 frames carrying the same tick got
 * 200 movement steps: a speed multiplier that scaled with its packet rate.
 *
 * This gate accepts one input per server tick per client, plus the frozen
 * NET.inputBufferTicks of slack so real jitter still lands, and hands back the
 * horizontal distance that is left inside this tick's PHYSICS budget. Extra
 * frames can therefore buy extra latency tolerance but never extra ground.
 *
 * No clock and no socket in here: the caller passes the server tick it is
 * already on, which keeps every rule testable with plain numbers.
 */
import { NET } from '@voxelcraft/core-types'
import { speedFor } from './movement'

export const INPUT_GATE = {
	/** Inputs applied per server tick before the jitter slack is spent. */
	perTick: 1,
	/** Extra inputs one tick may absorb, from the frozen jitter buffer depth. */
	slack: NET.inputBufferTicks,
	/**
	 * Rejected inputs inside one tick that mean the peer is flooding rather than
	 * jittering. A whole tick rate worth of rubbish in a single tick is not a
	 * network hiccup, so the caller is told it may hang up.
	 */
	floodRejects: NET.tickHz,
	/** Float slop, so an exact one tick step is never rubber banded. */
	epsilon: 1e-9,
} as const

/** Only the two fields the gate judges, so tests do not need a whole frame. */
export interface GatedInput {
	readonly tick: number
	readonly bits: number
}

export type InputRejection =
	/** The client tick did not move forward: a replay, a reorder or a duplicate. */
	| 'replay'
	/** This server tick has already applied as many inputs as it will. */
	| 'tick_budget'

export type InputVerdict =
	| {
			readonly ok: true
			/** Horizontal blocks the server may still grant this tick. */
			readonly horizontalBudget: number
	  }
	| {
			readonly ok: false
			readonly reason: InputRejection
			/** True once the rejections in this tick stop looking like jitter. */
			readonly flooding: boolean
	  }

export class InputGate {
	private tick = -1
	private applied = 0
	private rejected = 0
	private spent = 0
	private clientTick: number | null = null

	/** Inputs applied during the server tick the gate is currently on. */
	get appliedThisTick(): number {
		return this.applied
	}

	/** Inputs rejected during the server tick the gate is currently on. */
	get rejectedThisTick(): number {
		return this.rejected
	}

	/** Horizontal blocks already granted during this server tick. */
	get spentThisTick(): number {
		return this.spent
	}

	/** Highest client tick the gate has accepted, or null before the first. */
	get lastClientTick(): number | null {
		return this.clientTick
	}

	/**
	 * Judges one input against the server tick it arrived in. On success the
	 * caller must report what it actually moved with `spend`, so the next input
	 * inside the same tick sees a smaller budget.
	 */
	admit(input: GatedInput, serverTick: number): InputVerdict {
		this.rollOver(serverTick)
		// Client ticks must climb: a repeat is not new intent, it is a replay.
		if (this.clientTick !== null && input.tick <= this.clientTick) return this.reject('replay')
		if (this.applied >= INPUT_GATE.perTick + INPUT_GATE.slack) return this.reject('tick_budget')
		this.applied += 1
		this.clientTick = input.tick
		// The walk or sprint budget for one tick, shared by every input in it.
		const budget = speedFor(input.bits) + INPUT_GATE.epsilon
		return { ok: true, horizontalBudget: Math.max(0, budget - this.spent) }
	}

	/** Books the horizontal distance the server granted for an accepted input. */
	spend(blocks: number): void {
		if (!Number.isFinite(blocks) || blocks <= 0) return
		this.spent += blocks
	}

	private rollOver(serverTick: number): void {
		if (serverTick === this.tick) return
		this.tick = serverTick
		this.applied = 0
		this.rejected = 0
		this.spent = 0
	}

	private reject(reason: InputRejection): InputVerdict {
		this.rejected += 1
		return { ok: false, reason, flooding: this.rejected > INPUT_GATE.floodRejects }
	}
}
