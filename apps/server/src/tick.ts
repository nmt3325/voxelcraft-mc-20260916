/**
 * Fixed rate tick scheduler.
 *
 * Driven by the wall clock rather than "one tick per timer callback": a busy
 * runner delays timers, and the simulation must not silently slow down when it
 * happens. Catch-up is capped so one long stall cannot turn into a burst that
 * causes the next stall.
 */
import { clearInterval, setInterval } from 'node:timers'
import { NET } from '@voxelcraft/core-types'

export const TICK_MS = 1000 / NET.tickHz
export const SNAPSHOT_MS = 1000 / NET.snapshotHz
/** 20 Hz simulation against 10 Hz snapshots: one snapshot every other tick. */
export const TICKS_PER_SNAPSHOT = Math.round(NET.tickHz / NET.snapshotHz)
/** Ticks a single catch-up burst may run. */
export const MAX_CATCH_UP_TICKS = 5

export function isSnapshotTick(tick: number): boolean {
	return tick % TICKS_PER_SNAPSHOT === 0
}

export interface TickLoopOptions {
	onTick(tick: number, nowMs: number): void
	readonly intervalMs?: number
	readonly now?: () => number
	readonly maxCatchUp?: number
}

export class TickLoop {
	readonly intervalMs: number
	private readonly options: TickLoopOptions
	private timer: ReturnType<typeof setInterval> | null = null
	private currentTick = 0
	private dueAtMs = 0

	constructor(options: TickLoopOptions) {
		this.options = options
		this.intervalMs = options.intervalMs ?? TICK_MS
	}

	get tick(): number {
		return this.currentTick
	}

	get running(): boolean {
		return this.timer !== null
	}

	start(nowMs: number = this.now()): void {
		if (this.timer !== null) return
		this.dueAtMs = nowMs + this.intervalMs
		this.timer = setInterval(() => this.advanceTo(this.now()), this.intervalMs)
		// The listening http server is what keeps the process alive, not this.
		this.timer.unref()
	}

	stop(): void {
		if (this.timer === null) return
		clearInterval(this.timer)
		this.timer = null
	}

	/** Runs every tick already due at nowMs and returns how many ran. */
	advanceTo(nowMs: number): number {
		const budget = this.options.maxCatchUp ?? MAX_CATCH_UP_TICKS
		let ran = 0
		while (nowMs >= this.dueAtMs && ran < budget) {
			this.currentTick += 1
			this.dueAtMs += this.intervalMs
			ran += 1
			this.options.onTick(this.currentTick, nowMs)
		}
		if (nowMs >= this.dueAtMs) {
			// Too far behind to catch up; resynchronise instead of spiralling.
			this.dueAtMs = nowMs + this.intervalMs
		}
		return ran
	}

	private now(): number {
		return this.options.now?.() ?? Date.now()
	}
}
