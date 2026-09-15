/**
 * Fixed 20 Hz tick scheduler.
 *
 * `PERF.simTickMs` (50 ms) is the only tick length, `PERF.accumulatorClampMs`
 * (250 ms) bounds catch-up work after a stall, and execution order is always
 * the contract's `SYSTEM_ORDER`: a schedule is sorted into that order instead
 * of trusting the order systems were registered in.
 *
 * `world.flush()` runs after every system so the next system sees a consistent
 * world, and structural changes made while iterating are never applied mid
 * query.
 */
import { PERF, SYSTEM_ORDER } from '@voxelcraft/core-types'
import type { EcsWorld, Schedule, SystemEntry, SystemFn, Tick } from '@voxelcraft/core-types'

export const SIM_TICK_HZ = PERF.simTickHz
export const SIM_TICK_MS = PERF.simTickMs
/** Seconds per tick, handed to every system as `dt`. */
export const SIM_DT = PERF.simTickMs / 1000

export function systemOrderIndex(name: string): number {
	return SYSTEM_ORDER.indexOf(name)
}

export function defineSystem(name: string, fn: SystemFn): SystemEntry {
	if (systemOrderIndex(name) < 0) {
		throw new Error(`Unknown system "${name}". SYSTEM_ORDER is ${SYSTEM_ORDER.join(', ')}`)
	}
	return { name, fn }
}

/** Validates every name and sorts the entries into SYSTEM_ORDER. */
export function createSchedule(entries: readonly SystemEntry[]): Schedule {
	const systems = entries.map((entry) => {
		if (systemOrderIndex(entry.name) < 0) {
			throw new Error(`Unknown system "${entry.name}". SYSTEM_ORDER is ${SYSTEM_ORDER.join(', ')}`)
		}
		return entry
	})
	systems.sort((a, b) => systemOrderIndex(a.name) - systemOrderIndex(b.name))
	return { systems }
}

export interface TickRunner {
	readonly schedule: Schedule
	/** Number of ticks already simulated. */
	readonly tick: Tick
	readonly accumulatorMs: number
	/** 0..1 progress into the next tick, for render interpolation. */
	readonly alpha: number
	/** Runs exactly one fixed tick and returns the tick that just ran. */
	runTick(): Tick
	/** Feeds elapsed real time and runs as many fixed ticks as fit. */
	advance(realDeltaMs: number): number
	reset(tick?: Tick): void
}

export function createTickRunner(
	world: EcsWorld,
	schedule: Schedule,
	startTick: Tick = 0,
): TickRunner {
	let tick = startTick
	let accumulatorMs = 0

	const runner: TickRunner = {
		schedule,
		get tick(): Tick {
			return tick
		},
		get accumulatorMs(): number {
			return accumulatorMs
		},
		get alpha(): number {
			return accumulatorMs / PERF.simTickMs
		},
		runTick(): Tick {
			const current = tick
			for (const system of schedule.systems) {
				system.fn(world, SIM_DT, current)
				world.flush()
			}
			tick = current + 1
			return current
		},
		advance(realDeltaMs: number): number {
			if (!Number.isFinite(realDeltaMs) || realDeltaMs <= 0) return 0
			accumulatorMs += realDeltaMs
			// Catch-up is bounded, so a long stall never turns into a tick storm.
			if (accumulatorMs > PERF.accumulatorClampMs) accumulatorMs = PERF.accumulatorClampMs
			let ran = 0
			while (accumulatorMs >= PERF.simTickMs) {
				accumulatorMs -= PERF.simTickMs
				runner.runTick()
				ran++
			}
			return ran
		},
		reset(next: Tick = 0): void {
			tick = next
			accumulatorMs = 0
		},
	}
	return runner
}
