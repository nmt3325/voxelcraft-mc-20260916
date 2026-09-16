/**
 * Per-dimension simulation state.
 *
 * Every `DimensionId` owns one `SimVoxelWorld` and one light engine, so the
 * Overworld and the Nether can never write into each other's voxels or light
 * bytes.
 *
 * Darkness is implemented at the light engine's `propsOf` injection point
 * instead of by patching the engine: when every block of a dimension with
 * `hasSky === false` reports `skyPassThrough: false`, the engine's column-top
 * scan stops at the first voxel it looks at, so no column is ever open, no sky
 * light is ever seeded and `getSkyLightAt` stays 0 throughout. Block light
 * (glowstone, lava, portal blocks) is untouched and still propagates normally.
 *
 * The ambient hazard tick lives here too: burning in lava is a property of the
 * dimension (`DimensionParams.ambientFluid`), not of the portal.
 */
import {
	BLOCK_V2,
	COMBAT,
	DIMENSION_PARAMS,
	EVENT,
	EVENT_V2,
	FLUID,
	PARTICLE,
	PERF,
	PORTAL,
} from '@voxelcraft/core-types'
import type {
	BlockId,
	DimensionId,
	DimensionParams,
	EcsWorld,
	EntityId,
	EventBusV2,
	LightProps,
} from '@voxelcraft/core-types'
import { lightPropsOf } from '../../shared/blockProps'
import { createSimVoxelWorld } from '../../shared/voxelWorld'
import type { SimVoxelWorld } from '../../shared/voxelWorld'
import { lightCreateEngine } from '../../light/lightEngine'
import type { LightEngineInstance } from '../../light/lightEngine'
import { Health, Transform } from '../../ecs/components'

/**
 * LOCAL tuning constant, not part of the contract: ticks between two ambient
 * lava hits. Derived from `PERF.simTickHz` so the cadence stays twice per
 * second whatever the tick rate becomes.
 */
export const DIM_LAVA_DAMAGE_INTERVAL_TICKS = Math.max(1, Math.round(PERF.simTickHz / 2))

/** LOCAL tuning constant, not part of the contract: half hearts per lava hit. */
export const DIM_LAVA_DAMAGE = 4

/** LOCAL tuning constant, not part of the contract: particles per lava hit. */
export const DIM_LAVA_PARTICLE_COUNT = 6

/**
 * Emission for the v2 block ids the frozen v1 `simBlockProps` table knows
 * nothing about. Only the contract value `PORTAL.lightLevel` is added here; no
 * v1 block is redefined.
 */
const DIM_V2_EMISSION: ReadonlyMap<BlockId, number> = new Map<BlockId, number>([
	[BLOCK_V2.NETHER_PORTAL, PORTAL.lightLevel],
])

/** Frozen parameters of `dimension`. */
export function dimParamsOf(dimension: DimensionId): DimensionParams {
	return DIMENSION_PARAMS[dimension]
}

/** True when the dimension has no sky, i.e. its sky light must stay 0. */
export function dimIsDark(dimension: DimensionId): boolean {
	return !DIMENSION_PARAMS[dimension].hasSky
}

/**
 * Optics used by the light engine of `dimension`.
 *
 * Wraps the shared `lightPropsOf`: v2 emissions are filled in and, in a
 * dimension without a sky, `skyPassThrough` is forced to `false` for every
 * block so no sky light is ever seeded. Results are memoised per block id, so
 * the BFS pays one table lookup per voxel visit.
 */
export function dimCreatePropsOf(dimension: DimensionId): (id: BlockId) => LightProps {
	const dark = dimIsDark(dimension)
	const cache = new Map<BlockId, LightProps>()
	return (id: BlockId): LightProps => {
		const cached = cache.get(id)
		if (cached) return cached
		const base = lightPropsOf(id)
		const props: LightProps = {
			opacity: base.opacity,
			emission: DIM_V2_EMISSION.get(id) ?? base.emission,
			skyPassThrough: dark ? false : base.skyPassThrough,
			skyFilter: base.skyFilter,
		}
		cache.set(id, props)
		return props
	}
}

/** Voxel world and light engine of one dimension. */
export interface DimRuntime {
	readonly id: DimensionId
	readonly params: DimensionParams
	readonly world: SimVoxelWorld
	readonly light: LightEngineInstance
}

/** Options for `dimCreateRegistry`. */
export interface DimRegistryOptions {
	/** Voxel world factory. Defaults to `createSimVoxelWorld`. */
	createWorld?: (dimension: DimensionId) => SimVoxelWorld
}

/** Every dimension's runtime, keyed by `DimensionId`. */
export interface DimRegistry {
	/** Known dimension ids, ascending. */
	readonly ids: readonly DimensionId[]
	get(dimension: DimensionId): DimRuntime
	worldOf(dimension: DimensionId): SimVoxelWorld
	lightOf(dimension: DimensionId): LightEngineInstance
	/** `seedAll` on every dimension, in ascending id order. */
	seedAll(passes?: number): void
}

/**
 * Builds one world and one light engine per dimension declared in
 * `DIMENSION_PARAMS`, each with the optics of that dimension.
 */
export function dimCreateRegistry(options: DimRegistryOptions = {}): DimRegistry {
	const ids = Object.keys(DIMENSION_PARAMS)
		.map((key) => Number(key) as DimensionId)
		.sort((a, b) => a - b)
	const runtimes = new Map<DimensionId, DimRuntime>()
	for (const id of ids) {
		const world = options.createWorld ? options.createWorld(id) : createSimVoxelWorld()
		const light = lightCreateEngine({ world, propsOf: dimCreatePropsOf(id) })
		runtimes.set(id, { id, params: DIMENSION_PARAMS[id], world, light })
	}
	const get = (dimension: DimensionId): DimRuntime => {
		const runtime = runtimes.get(dimension)
		if (!runtime) throw new Error(`unknown dimension: ${String(dimension)}`)
		return runtime
	}
	return {
		ids,
		get,
		worldOf: (dimension) => get(dimension).world,
		lightOf: (dimension) => get(dimension).light,
		seedAll: (passes) => {
			for (const id of ids) get(id).light.seedAll(passes)
		},
	}
}

/** Options for `dimCreateLavaAmbient`. */
export interface DimLavaAmbientOptions {
	registry: DimRegistry
	ecs: EcsWorld
	events: EventBusV2
	/** Dimension an entity is currently simulated in. */
	dimensionOf: (entity: EntityId) => DimensionId
	/** Half hearts per hit. Defaults to `DIM_LAVA_DAMAGE`. */
	damage?: number
	/** Ticks between two hits. Defaults to `DIM_LAVA_DAMAGE_INTERVAL_TICKS`. */
	intervalTicks?: number
}

/** Ambient hazard ticker for dimensions whose `ambientFluid` is lava. */
export interface DimLavaAmbientInstance {
	/**
	 * Runs one simulation tick and returns the entities hurt, ascending. Hits
	 * only land on ticks that are a multiple of the interval, so the cadence is a
	 * pure function of the tick number.
	 */
	tick(tick: number): EntityId[]
}

/**
 * Ambient lava damage.
 *
 * An entity whose feet voxel holds lava, in a dimension whose `ambientFluid`
 * is `'lava'`, loses `damage` health on the fixed cadence and starts a fresh
 * `COMBAT.invulnerableTicks` window. The window is only read here: counting it
 * down stays the combat system's job. `entity.damaged` and a `PARTICLE.Lava`
 * `particle.spawn` are emitted for every hit that lands.
 */
export function dimCreateLavaAmbient(options: DimLavaAmbientOptions): DimLavaAmbientInstance {
	const damage = options.damage ?? DIM_LAVA_DAMAGE
	const interval = Math.max(1, Math.floor(options.intervalTicks ?? DIM_LAVA_DAMAGE_INTERVAL_TICKS))
	return {
		tick(tick: number): EntityId[] {
			const hurt: EntityId[] = []
			if (tick % interval !== 0) return hurt
			for (const entity of options.ecs.query([Transform, Health])) {
				const dimension = options.dimensionOf(entity)
				if (dimParamsOf(dimension).ambientFluid !== 'lava') continue
				const transform = options.ecs.get(entity, Transform)
				const health = options.ecs.get(entity, Health)
				if (!transform || !health) continue
				if (health.current <= 0 || health.invulnerableTicks > 0) continue
				const world = options.registry.worldOf(dimension)
				const x = Math.floor(transform.x)
				const y = Math.floor(transform.y)
				const z = Math.floor(transform.z)
				if (world.fluidStateAt(x, y, z).kind !== FLUID.Lava) continue
				health.current = Math.max(0, health.current - damage)
				health.invulnerableTicks = COMBAT.invulnerableTicks
				options.events.emit(EVENT.EntityDamaged, { entity, amount: damage, source: null })
				options.events.emit(EVENT_V2.ParticleSpawn, {
					kind: PARTICLE.Lava,
					x: transform.x,
					y: transform.y,
					z: transform.z,
					count: DIM_LAVA_PARTICLE_COUNT,
				})
				hurt.push(entity)
			}
			return hurt
		},
	}
}
