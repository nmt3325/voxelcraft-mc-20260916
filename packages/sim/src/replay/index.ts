/**
 * Deterministic replay harness.
 *
 * A replay is fully described by a seed, a tick count and an entity count: the
 * input stream is derived from the seed with `hashU32`, so the same seed always
 * produces the same input sequence without storing it. `hashSimState` then
 * folds the voxel hash together with the exact bit patterns of every entity's
 * transform, velocity and flags, in ascending entity order.
 *
 * No `Math.random`, `Date.now` or `Math.sin` anywhere in this path: the only
 * randomness is the contract's pure hashes, and trigonometry goes through
 * `simSin` / `simCos`.
 */
import { hashU32 } from '@voxelcraft/core-types'
import type { EcsWorld, EntityId, Schedule, Tick } from '@voxelcraft/core-types'
import {
	Collider,
	Health,
	Intent,
	PhysicsState,
	Transform,
	Velocity,
	createEcsWorld,
} from '../ecs'
import type { IntentComp } from '../ecs'
import { createPhysicsSystem } from '../physics'
import { createSchedule, createTickRunner, defineSystem } from '../schedule'
import { SIM_TAU } from '../shared'
import { createTestArena } from '../testing'
import type { TestArena } from '../testing'

/** Anything that can summarise its voxels, i.e. `SimVoxelWorld`. */
export interface HashableVoxels {
	hash(): number
}

const F64 = new Float64Array(1)
const U32 = new Uint32Array(F64.buffer)

function mixU32(h: number, value: number): number {
	const x = (h ^ (value >>> 0)) >>> 0
	return Math.imul(x, 0x01000193) >>> 0
}

/** Mixes the exact IEEE-754 bits, so a replay cannot drift silently. */
function mixFloat(h: number, value: number): number {
	F64[0] = value
	return mixU32(mixU32(h, U32[0]), U32[1])
}

function mixFlag(h: number, value: boolean): number {
	return mixU32(h, value ? 0x9e3779b9 : 0x85ebca6b)
}

export function hashSimState(world: EcsWorld, voxels: HashableVoxels, tick: Tick): number {
	let h = 0x811c9dc5 >>> 0
	h = mixU32(h, tick >>> 0)
	h = mixU32(h, voxels.hash())
	h = mixU32(h, world.entityCount >>> 0)
	// query() is ascending and stable, which is what makes this reproducible.
	for (const entity of world.query([Transform])) {
		h = mixU32(h, entity >>> 0)
		const transform = world.get(entity, Transform)
		if (transform) {
			h = mixFloat(h, transform.x)
			h = mixFloat(h, transform.y)
			h = mixFloat(h, transform.z)
			h = mixFloat(h, transform.yaw)
			h = mixFloat(h, transform.pitch)
		}
		const velocity = world.get(entity, Velocity)
		if (velocity) {
			h = mixFloat(h, velocity.x)
			h = mixFloat(h, velocity.y)
			h = mixFloat(h, velocity.z)
		}
		const physics = world.get(entity, PhysicsState)
		if (physics) {
			h = mixFlag(h, physics.onGround)
			h = mixFlag(h, physics.inWater)
			h = mixFlag(h, physics.inLava)
			h = mixFlag(h, physics.steppedUp)
			h = mixFloat(h, physics.fallDistance)
			h = mixU32(h, physics.pendingFallDamage >>> 0)
		}
		const health = world.get(entity, Health)
		if (health) {
			h = mixFloat(h, health.current)
			h = mixFloat(h, health.max)
			h = mixU32(h, health.invulnerableTicks >>> 0)
		}
	}
	return h >>> 0
}

const AXIS: readonly number[] = [-1, 0, 1, 0]

/** Pure function of (seed, entity, tick): no stored input log needed. */
export function replayIntentAt(seed: number, entity: EntityId, tick: Tick): IntentComp {
	const h = hashU32(seed, 0x1a7, entity, tick)
	return {
		forward: AXIS[h & 3],
		strafe: AXIS[(h >>> 2) & 3],
		jump: ((h >>> 4) & 7) === 0,
		sprint: ((h >>> 7) & 1) === 1,
		sneak: ((h >>> 8) & 7) === 0,
		yaw: (((h >>> 11) & 0xff) / 256) * SIM_TAU,
	}
}

export interface ReplayOptions {
	seed: number
	ticks: number
	/** Entities driven by the generated input stream. Defaults to 4. */
	entities?: number
	/** Reuse an arena to compare two runs over identical geometry. */
	arena?: TestArena
}

export interface ReplaySample {
	entity: EntityId
	x: number
	y: number
	z: number
}

export interface ReplayResult {
	hash: number
	ticks: number
	entityCount: number
	samples: ReplaySample[]
	world: EcsWorld
	arena: TestArena
	schedule: Schedule
}

/** Spawns the replay entities at deterministic positions above the floor. */
function spawnReplayEntities(world: EcsWorld, seed: number, count: number, floorTop: number): EntityId[] {
	const ids: EntityId[] = []
	for (let i = 0; i < count; i++) {
		const h = hashU32(seed, 0x5eed, i)
		const entity = world.create()
		world.add(entity, Transform, {
			...Transform.create(),
			x: ((h & 15) - 8) * 0.5,
			y: floorTop + 1 + ((h >>> 4) & 3),
			z: (((h >>> 6) & 15) - 8) * 0.5,
		})
		world.add(entity, Velocity, Velocity.create())
		world.add(entity, Collider, Collider.create())
		world.add(entity, PhysicsState, PhysicsState.create())
		world.add(entity, Intent, Intent.create())
		ids.push(entity)
	}
	world.flush()
	return ids
}

export function runReplay(options: ReplayOptions): ReplayResult {
	const { seed } = options
	const ticks = Math.max(0, Math.floor(options.ticks))
	const entityCount = Math.max(0, Math.floor(options.entities ?? 4))
	const arena = options.arena ?? createTestArena()
	const world = createEcsWorld()
	const entities = spawnReplayEntities(world, seed, entityCount, arena.floorTop)

	const input = defineSystem('input', (ecs, _dt, tick) => {
		for (const entity of ecs.query([Intent])) {
			const intent = ecs.get(entity, Intent)
			if (!intent) continue
			const next = replayIntentAt(seed, entity, tick)
			intent.forward = next.forward
			intent.strafe = next.strafe
			intent.jump = next.jump
			intent.sprint = next.sprint
			intent.sneak = next.sneak
			intent.yaw = next.yaw
		}
	})
	const physics = defineSystem('physics', createPhysicsSystem(arena.world))
	const schedule = createSchedule([physics, input])
	const runner = createTickRunner(world, schedule)
	for (let i = 0; i < ticks; i++) runner.runTick()

	const samples: ReplaySample[] = []
	for (const entity of entities) {
		const transform = world.get(entity, Transform)
		if (!transform) continue
		samples.push({ entity, x: transform.x, y: transform.y, z: transform.z })
	}

	return {
		hash: hashSimState(world, arena.world, runner.tick),
		ticks: runner.tick,
		entityCount: world.entityCount,
		samples,
		world,
		arena,
		schedule,
	}
}
