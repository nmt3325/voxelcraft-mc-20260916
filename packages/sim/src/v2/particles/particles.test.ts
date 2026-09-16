import { describe, expect, it } from 'vitest'
import { BLOCK, EVENT_V2, PARTICLE, PARTICLE_BUDGET, PERF } from '@voxelcraft/core-types'
import type { EventV2Payloads, ParticleId, ParticleSpawn } from '@voxelcraft/core-types'
import { createEcsWorld } from '../../ecs'
import type { RecordingEventBusV2 } from '../eventsV2'
import { createRecordingEventBusV2, v2CountEvents, v2EventsNamed } from '../eventsV2'
import type { ParticleEmitter } from './particleEvents'
import {
	PARTICLE_SITUATION_COUNTS,
	particleCreateEmitter,
	particleCreateResetSystem,
	particleEmitBlockBreak,
	particleEmitCritHit,
	particleEmitHeart,
	particleEmitLavaContact,
	particleEmitPortalTravel,
	particleEmitSmoke,
	particleEmitWaterSplash,
} from './particleEvents'

const DT = 1 / PERF.simTickHz

function setup(): { bus: RecordingEventBusV2; emitter: ParticleEmitter } {
	const bus = createRecordingEventBusV2()
	return { bus, emitter: particleCreateEmitter(bus) }
}

/** Typed view of the recorded spawns, which also pins the contract payload type. */
function particleSpawns(bus: RecordingEventBusV2): EventV2Payloads['particle.spawn'][] {
	return v2EventsNamed(bus, EVENT_V2.ParticleSpawn)
}

/** One request at a fixed position, with no spread. */
function particleRequest(count: number, kind: ParticleId = PARTICLE.Smoke): ParticleSpawn {
	return { kind, x: 0, y: 64, z: 0, count, spread: 0 }
}

const SITUATIONS: readonly {
	readonly name: string
	readonly emit: (emitter: ParticleEmitter) => number
	readonly kind: ParticleId
	readonly count: number
}[] = [
	{
		name: 'block break on a solid block',
		emit: (emitter) => particleEmitBlockBreak(emitter, 1, 64, 2, BLOCK.STONE),
		kind: PARTICLE.BlockBreak,
		count: PARTICLE_SITUATION_COUNTS.blockBreakSolid,
	},
	{
		name: 'block break on a fluid block',
		emit: (emitter) => particleEmitBlockBreak(emitter, 1, 64, 2, BLOCK.WATER),
		kind: PARTICLE.BlockBreak,
		count: PARTICLE_SITUATION_COUNTS.blockBreakFluid,
	},
	{
		name: 'lava contact',
		emit: (emitter) => particleEmitLavaContact(emitter, 1, 64, 2),
		kind: PARTICLE.Lava,
		count: PARTICLE_SITUATION_COUNTS.lavaContact,
	},
	{
		name: 'water splash',
		emit: (emitter) => particleEmitWaterSplash(emitter, 1, 64, 2),
		kind: PARTICLE.Splash,
		count: PARTICLE_SITUATION_COUNTS.waterSplash,
	},
	{
		name: 'portal travel',
		emit: (emitter) => particleEmitPortalTravel(emitter, 1, 64, 2),
		kind: PARTICLE.Portal,
		count: PARTICLE_SITUATION_COUNTS.portalTravel,
	},
	{
		name: 'heart',
		emit: (emitter) => particleEmitHeart(emitter, 1, 64, 2),
		kind: PARTICLE.Heart,
		count: PARTICLE_SITUATION_COUNTS.heart,
	},
	{
		name: 'crit hit',
		emit: (emitter) => particleEmitCritHit(emitter, 1, 64, 2),
		kind: PARTICLE.Crit,
		count: PARTICLE_SITUATION_COUNTS.critHit,
	},
	{
		name: 'smoke',
		emit: (emitter) => particleEmitSmoke(emitter, 1, 64, 2),
		kind: PARTICLE.Smoke,
		count: PARTICLE_SITUATION_COUNTS.smoke,
	},
]

describe('particle situation helpers', () => {
	for (const situation of SITUATIONS) {
		it(`emits the expected kind and count for ${situation.name}`, () => {
			const { bus, emitter } = setup()
			expect(situation.emit(emitter)).toBe(situation.count)
			const payloads = particleSpawns(bus)
			expect(payloads).toHaveLength(1)
			expect(payloads[0].kind).toBe(situation.kind)
			expect(payloads[0].count).toBe(situation.count)
			expect(emitter.particleCounters()).toEqual({
				spawned: situation.count,
				dropped: 0,
				droppedRequests: 0,
			})
		})
	}

	it('emits exactly the contract payload shape, with no spread field', () => {
		const { bus, emitter } = setup()
		particleEmitWaterSplash(emitter, 1.5, 64.25, -2.5)
		const payloads = particleSpawns(bus)
		expect(payloads).toHaveLength(1)
		const payload: EventV2Payloads['particle.spawn'] = payloads[0]
		expect(Object.keys(payload).sort()).toEqual(['count', 'kind', 'x', 'y', 'z'])
		expect(payload).toEqual({
			kind: PARTICLE.Splash,
			x: 1.5,
			y: 64.25,
			z: -2.5,
			count: PARTICLE_SITUATION_COUNTS.waterSplash,
		})
	})

	it('is deterministic: identical calls record identical payloads', () => {
		const first = setup()
		const second = setup()
		for (const situation of SITUATIONS) {
			situation.emit(first.emitter)
			situation.emit(second.emitter)
		}
		expect(particleSpawns(first.bus)).toHaveLength(SITUATIONS.length)
		expect(particleSpawns(first.bus)).toEqual(particleSpawns(second.bus))
	})
})

describe('particle per-tick budget', () => {
	it('clamps the tick at PARTICLE_BUDGET.maxSpawnPerTick', () => {
		const { bus, emitter } = setup()
		const perRequest = 10
		const requests = 100
		let emitted = 0
		for (let i = 0; i < requests; i += 1) {
			emitted += emitter.particleEmit(particleRequest(perRequest))
		}
		expect(emitted).toBe(PARTICLE_BUDGET.maxSpawnPerTick)
		const published = particleSpawns(bus).reduce((sum, payload) => sum + payload.count, 0)
		expect(published).toBe(PARTICLE_BUDGET.maxSpawnPerTick)

		const fullRequests = Math.floor(PARTICLE_BUDGET.maxSpawnPerTick / perRequest)
		const reducedRequests = PARTICLE_BUDGET.maxSpawnPerTick % perRequest > 0 ? 1 : 0
		expect(v2CountEvents(bus, EVENT_V2.ParticleSpawn)).toBe(fullRequests + reducedRequests)
		expect(emitter.particleCounters()).toEqual({
			spawned: PARTICLE_BUDGET.maxSpawnPerTick,
			dropped: requests * perRequest - PARTICLE_BUDGET.maxSpawnPerTick,
			droppedRequests: requests - fullRequests - reducedRequests,
		})
		expect(emitter.particleRemaining()).toBe(0)
	})

	it('reduces a request that only partly fits', () => {
		const { bus, emitter } = setup()
		const head = PARTICLE_BUDGET.maxSpawnPerTick - 5
		expect(emitter.particleEmit(particleRequest(head))).toBe(head)
		expect(emitter.particleRemaining()).toBe(5)
		expect(emitter.particleEmit(particleRequest(9))).toBe(5)

		const payloads = particleSpawns(bus)
		expect(payloads).toHaveLength(2)
		expect(payloads[1].count).toBe(5)
		expect(emitter.particleCounters()).toEqual({
			spawned: PARTICLE_BUDGET.maxSpawnPerTick,
			dropped: 4,
			droppedRequests: 0,
		})
	})

	it('drops a request that does not fit at all and counts it', () => {
		const { bus, emitter } = setup()
		emitter.particleEmit(particleRequest(PARTICLE_BUDGET.maxSpawnPerTick))
		expect(emitter.particleEmit(particleRequest(7))).toBe(0)
		expect(v2CountEvents(bus, EVENT_V2.ParticleSpawn)).toBe(1)
		expect(emitter.particleCounters()).toEqual({
			spawned: PARTICLE_BUDGET.maxSpawnPerTick,
			dropped: 7,
			droppedRequests: 1,
		})
	})

	it('restores the full budget when the next tick begins', () => {
		const { bus, emitter } = setup()
		emitter.particleEmit(particleRequest(PARTICLE_BUDGET.maxSpawnPerTick + 20))
		expect(emitter.particleRemaining()).toBe(0)

		emitter.particleBeginTick()
		expect(emitter.particleRemaining()).toBe(PARTICLE_BUDGET.maxSpawnPerTick)
		expect(emitter.particleCounters()).toEqual({ spawned: 0, dropped: 0, droppedRequests: 0 })
		expect(emitter.particleEmit(particleRequest(PARTICLE_BUDGET.maxSpawnPerTick))).toBe(
			PARTICLE_BUDGET.maxSpawnPerTick,
		)
		expect(v2CountEvents(bus, EVENT_V2.ParticleSpawn)).toBe(2)
	})

	it('resets through the SystemFn-shaped tick hook', () => {
		const { emitter } = setup()
		const particleResetTick = particleCreateResetSystem(emitter)
		emitter.particleEmit(particleRequest(PARTICLE_BUDGET.maxSpawnPerTick + 1))
		expect(emitter.particleCounters().dropped).toBe(1)

		particleResetTick(createEcsWorld(), DT, 7)
		expect(emitter.particleRemaining()).toBe(PARTICLE_BUDGET.maxSpawnPerTick)
		expect(emitter.particleCounters()).toEqual({ spawned: 0, dropped: 0, droppedRequests: 0 })
	})

	it('enforces the budget without an event bus', () => {
		const emitter = particleCreateEmitter()
		expect(emitter.particleEmit(particleRequest(PARTICLE_BUDGET.maxSpawnPerTick + 10))).toBe(
			PARTICLE_BUDGET.maxSpawnPerTick,
		)
		expect(emitter.particleCounters()).toEqual({
			spawned: PARTICLE_BUDGET.maxSpawnPerTick,
			dropped: 10,
			droppedRequests: 0,
		})
	})
})

describe('particle request validation', () => {
	const IGNORED: readonly { readonly name: string; readonly spawn: ParticleSpawn }[] = [
		{ name: 'zero count', spawn: particleRequest(0) },
		{ name: 'negative count', spawn: particleRequest(-12) },
		{ name: 'fractional count below one', spawn: particleRequest(0.5) },
		{ name: 'NaN count', spawn: particleRequest(Number.NaN) },
		{ name: 'infinite count', spawn: particleRequest(Number.POSITIVE_INFINITY) },
		{
			name: 'NaN coordinate',
			spawn: { kind: PARTICLE.Smoke, x: Number.NaN, y: 64, z: 0, count: 4, spread: 0 },
		},
		{
			name: 'infinite coordinate',
			spawn: { kind: PARTICLE.Smoke, x: 0, y: Number.POSITIVE_INFINITY, z: 0, count: 4, spread: 0 },
		},
	]

	for (const candidate of IGNORED) {
		it(`ignores a ${candidate.name} without counting a drop`, () => {
			const { bus, emitter } = setup()
			expect(emitter.particleEmit(candidate.spawn)).toBe(0)
			expect(v2CountEvents(bus, EVENT_V2.ParticleSpawn)).toBe(0)
			expect(emitter.particleCounters()).toEqual({ spawned: 0, dropped: 0, droppedRequests: 0 })
			expect(emitter.particleRemaining()).toBe(PARTICLE_BUDGET.maxSpawnPerTick)
		})
	}
})
