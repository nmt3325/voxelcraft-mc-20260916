/**
 * Simulation-side particle event emission.
 *
 * `packages/client` owns every particle: the pools, the integration of
 * `PARTICLE_BUDGET.gravity` / `drag` and the draw calls. The simulation only
 * publishes `EVENT_V2.ParticleSpawn` for the situations that need one and
 * enforces `PARTICLE_BUDGET.maxSpawnPerTick` for the tick that is open. Nothing
 * here calls `Math.random`, so a replayed tick emits exactly the same events.
 *
 * `ParticleSpawn.spread` is input only and advisory: the contract payload has no
 * `spread` field, so the client derives its own velocity distribution from it.
 */
import { EVENT_V2, FLUID, PARTICLE, PARTICLE_BUDGET } from '@voxelcraft/core-types'
import type {
	BlockId,
	EventBusV2,
	EventV2Payloads,
	ParticleId,
	ParticleSpawn,
	SystemFn,
} from '@voxelcraft/core-types'
import { simBlockProps } from '../../shared/blockProps'

/**
 * How many particles each situation asks for.
 *
 * LOCAL TUNING VALUES, not contract values: the contract freezes the budget, not
 * the per-situation counts. Exported so tests and a debug HUD can assert them
 * without repeating a bare literal.
 */
export const PARTICLE_SITUATION_COUNTS = {
	/** A solid voxel shatters into fragments. */
	blockBreakSolid: 12,
	/** A fluid only puffs: there is nothing to shatter. */
	blockBreakFluid: 6,
	lavaContact: 8,
	waterSplash: 10,
	portalTravel: 16,
	heart: 4,
	critHit: 6,
	smoke: 3,
} as const

/**
 * Advisory velocity spread per situation, in blocks per second. LOCAL TUNING
 * VALUES as well, and the client is free to interpret them.
 */
export const PARTICLE_SITUATION_SPREADS = {
	blockBreak: 2,
	lavaContact: 1,
	waterSplash: 2.5,
	portalTravel: 0.5,
	heart: 0.5,
	critHit: 1.5,
	smoke: 0.25,
} as const

/** Budget bookkeeping for the tick that is currently open. */
export interface ParticleEmitterCounters {
	/** Particles emitted this tick. */
	readonly spawned: number
	/** Particles the budget refused this tick, trimmed remainders included. */
	readonly dropped: number
	/** Requests the budget refused entirely this tick. */
	readonly droppedRequests: number
}

/**
 * Publishes `particle.spawn` and owns the per-tick spawn budget. A fresh emitter
 * starts with the full budget, so `particleBeginTick` is only needed between
 * ticks.
 */
export interface ParticleEmitter {
	/** Opens a new tick: clears the counters and restores the full budget. */
	particleBeginTick(): void
	/**
	 * Emits one `particle.spawn` clamped to what is left of the tick budget and
	 * returns the count actually published.
	 *
	 * A request that only partly fits is emitted with the reduced count; one that
	 * does not fit at all is dropped and counted. A request for nothing
	 * (`count <= 0`, or a non-finite count or coordinate) is ignored and is never
	 * counted as a drop.
	 */
	particleEmit(request: ParticleSpawn): number
	/** Snapshot of this tick's budget use. */
	particleCounters(): ParticleEmitterCounters
	/** Particles that still fit in this tick. */
	particleRemaining(): number
}

/** A request for nothing, or for nowhere, is ignored rather than dropped. */
function particleRequestIsUsable(request: ParticleSpawn): boolean {
	if (!Number.isFinite(request.count) || Math.floor(request.count) <= 0) return false
	return Number.isFinite(request.x) && Number.isFinite(request.y) && Number.isFinite(request.z)
}

/**
 * Creates an emitter. `bus` is optional: without one the budget is still
 * enforced and counted, so a headless sim run behaves like a wired build.
 */
export function particleCreateEmitter(bus?: EventBusV2): ParticleEmitter {
	let spawned = 0
	let dropped = 0
	let droppedRequests = 0

	function particleRemaining(): number {
		return Math.max(0, PARTICLE_BUDGET.maxSpawnPerTick - spawned)
	}

	return {
		particleBeginTick(): void {
			spawned = 0
			dropped = 0
			droppedRequests = 0
		},
		particleEmit(request: ParticleSpawn): number {
			if (!particleRequestIsUsable(request)) return 0
			const wanted = Math.floor(request.count)
			const room = particleRemaining()
			if (room === 0) {
				dropped += wanted
				droppedRequests += 1
				return 0
			}
			const emitted = Math.min(wanted, room)
			spawned += emitted
			dropped += wanted - emitted
			const payload: EventV2Payloads['particle.spawn'] = {
				kind: request.kind,
				x: request.x,
				y: request.y,
				z: request.z,
				count: emitted,
			}
			bus?.emit(EVENT_V2.ParticleSpawn, payload)
			return emitted
		},
		particleCounters(): ParticleEmitterCounters {
			return { spawned, dropped, droppedRequests }
		},
		particleRemaining,
	}
}

/**
 * `SystemFn`-shaped per-tick reset for `emitter`.
 *
 * The contract's `SYSTEM_ORDER` has no `particle` slot, so this is deliberately
 * a plain function instead of a `defineSystem` entry: the integrator calls it at
 * the start of a tick, before any system that may emit particles. `world`, `dt`
 * and `tick` are ignored because the emitter holds no per-entity state.
 */
export function particleCreateResetSystem(emitter: ParticleEmitter): SystemFn {
	return (_world, _dt, _tick) => {
		emitter.particleBeginTick()
	}
}

/** Shared shape of every situation helper: one clamped request, no randomness. */
function particleEmitSituation(
	emitter: ParticleEmitter,
	kind: ParticleId,
	x: number,
	y: number,
	z: number,
	count: number,
	spread: number,
): number {
	return emitter.particleEmit({ kind, x, y, z, count, spread })
}

/**
 * Fragments for a broken block. The count comes from `simBlockProps`, so a fluid
 * puffs while a solid shatters, instead of introducing a second block table.
 */
export function particleEmitBlockBreak(
	emitter: ParticleEmitter,
	x: number,
	y: number,
	z: number,
	block: BlockId,
): number {
	const count =
		simBlockProps(block).fluid === FLUID.None
			? PARTICLE_SITUATION_COUNTS.blockBreakSolid
			: PARTICLE_SITUATION_COUNTS.blockBreakFluid
	return particleEmitSituation(
		emitter,
		PARTICLE.BlockBreak,
		x,
		y,
		z,
		count,
		PARTICLE_SITUATION_SPREADS.blockBreak,
	)
}

/** Something touched lava: cinders at the contact point. */
export function particleEmitLavaContact(
	emitter: ParticleEmitter,
	x: number,
	y: number,
	z: number,
): number {
	return particleEmitSituation(
		emitter,
		PARTICLE.Lava,
		x,
		y,
		z,
		PARTICLE_SITUATION_COUNTS.lavaContact,
		PARTICLE_SITUATION_SPREADS.lavaContact,
	)
}

/** Something entered water. */
export function particleEmitWaterSplash(
	emitter: ParticleEmitter,
	x: number,
	y: number,
	z: number,
): number {
	return particleEmitSituation(
		emitter,
		PARTICLE.Splash,
		x,
		y,
		z,
		PARTICLE_SITUATION_COUNTS.waterSplash,
		PARTICLE_SITUATION_SPREADS.waterSplash,
	)
}

/** An entity travelled through a portal. */
export function particleEmitPortalTravel(
	emitter: ParticleEmitter,
	x: number,
	y: number,
	z: number,
): number {
	return particleEmitSituation(
		emitter,
		PARTICLE.Portal,
		x,
		y,
		z,
		PARTICLE_SITUATION_COUNTS.portalTravel,
		PARTICLE_SITUATION_SPREADS.portalTravel,
	)
}

/** Breeding feedback: love mode, and the moment a baby is born. */
export function particleEmitHeart(
	emitter: ParticleEmitter,
	x: number,
	y: number,
	z: number,
): number {
	return particleEmitSituation(
		emitter,
		PARTICLE.Heart,
		x,
		y,
		z,
		PARTICLE_SITUATION_COUNTS.heart,
		PARTICLE_SITUATION_SPREADS.heart,
	)
}

/** A critical hit landed. */
export function particleEmitCritHit(
	emitter: ParticleEmitter,
	x: number,
	y: number,
	z: number,
): number {
	return particleEmitSituation(
		emitter,
		PARTICLE.Crit,
		x,
		y,
		z,
		PARTICLE_SITUATION_COUNTS.critHit,
		PARTICLE_SITUATION_SPREADS.critHit,
	)
}

/** Generic smoke: an extinguished fire, a lit furnace, a cooling block. */
export function particleEmitSmoke(
	emitter: ParticleEmitter,
	x: number,
	y: number,
	z: number,
): number {
	return particleEmitSituation(
		emitter,
		PARTICLE.Smoke,
		x,
		y,
		z,
		PARTICLE_SITUATION_COUNTS.smoke,
		PARTICLE_SITUATION_SPREADS.smoke,
	)
}
