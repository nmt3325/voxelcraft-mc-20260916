/**
 * Dimension transition acceptance tests.
 *
 * Covers every required behaviour of this subtree: Nether darkness with a still
 * working block light channel, travel firing on exactly the
 * `PORTAL.travelDelayTicks`-th tick of contact, cooldown rejection, contact
 * interruption, coordinate scaling in both directions, the terrain hook, the
 * frame builder and the `dimension.changed` / `portal.used` / `particle.spawn`
 * payloads.
 *
 * Every fixture stays inside chunk (0, 0): seeding one chunk already walks all
 * 65536 of its voxels.
 */
import { describe, expect, it } from 'vitest'
import {
	BLOCK,
	BLOCK_V2,
	CHUNK_Y,
	COMBAT,
	DIMENSION,
	DIMENSION_PARAMS,
	EVENT,
	EVENT_V2,
	MAX_LIGHT,
	PARTICLE,
	PORTAL,
} from '@voxelcraft/core-types'
import type { DimensionId, EntityId } from '@voxelcraft/core-types'
import { Health, Transform, spawnLivingEntity } from '../../ecs/components'
import { createEcsWorld } from '../../ecs/ecs'
import { lightPropsOf } from '../../shared/blockProps'
import type { SimVoxelWorld } from '../../shared/voxelWorld'
import { fillRegion } from '../../testing/flatWorld'
import { createRecordingEventBusV2, v2CountEvents, v2EventsNamed } from '../eventsV2'
import {
	DIM_LAVA_DAMAGE,
	DIM_LAVA_DAMAGE_INTERVAL_TICKS,
	DIM_LAVA_PARTICLE_COUNT,
	dimCreateLavaAmbient,
	dimCreateRegistry,
	dimIsDark,
	dimParamsOf,
} from './dimensionState'
import {
	DIM_PORTAL_PARTICLE_COUNT,
	portalTravelBuildFrame,
	portalTravelCreate,
	portalTravelFindPortal,
	portalTravelScaleAxis,
} from './portalTravel'
import type { PortalTravelInstance } from './portalTravel'
import type { DimTerrainAccess } from './terrainAccess'

const OVERWORLD = DIMENSION.Overworld
const NETHER = DIMENSION.Nether
const NETHER_SCALE = DIMENSION_PARAMS[NETHER].coordinateScale
const FLOOR_TOP = 64
/** Seeding one chunk per dimension is slow but far from pathological. */
const SLOW = 30000
/** Overworld portal voxel of every fixture, and the entity's feet voxel. */
const OW_PORTAL = { x: 8, y: FLOOR_TOP, z: 8 }
/** Nether twin of `OW_PORTAL`: `floor(8.5 / 8)` is 1 on both axes. */
const NT_PORTAL = { x: 1, y: FLOOR_TOP, z: 1 }
/** Centre of `OW_PORTAL` scaled into the Nether: 8.5 / 8. */
const SCALED = (OW_PORTAL.x + 0.5) / NETHER_SCALE
/** y the terrain double hands out when nothing links on the far side. */
const LANDING_Y = 70
/** A small radius keeps the "nothing links" searches cheap in an empty world. */
const SMALL_RADIUS = 4

interface Fixture {
	registry: ReturnType<typeof dimCreateRegistry>
	ecs: ReturnType<typeof createEcsWorld>
	events: ReturnType<typeof createRecordingEventBusV2>
	travel: PortalTravelInstance
	entity: EntityId
	ensured: { dimension: DimensionId; x: number; z: number }[]
}

const stoneFloor = (world: SimVoxelWorld, top: number): void => {
	world.ensureChunk(0, 0)
	fillRegion(world, 0, top - 4, 0, 15, top - 1, 15, BLOCK.STONE)
}

/** Two floored worlds and an entity standing in the Overworld portal voxel. */
const dimFixture = (
	options: { netherPortal?: boolean; y?: number; radius?: number; terrain?: boolean } = {},
): Fixture => {
	const registry = dimCreateRegistry()
	const ecs = createEcsWorld()
	const events = createRecordingEventBusV2()
	const y = options.y ?? FLOOR_TOP
	for (const id of registry.ids) stoneFloor(registry.worldOf(id), FLOOR_TOP)
	registry.worldOf(OVERWORLD).setBlock(OW_PORTAL.x, y, OW_PORTAL.z, BLOCK_V2.NETHER_PORTAL)
	if (options.netherPortal) {
		registry
			.worldOf(NETHER)
			.setBlock(NT_PORTAL.x, NT_PORTAL.y, NT_PORTAL.z, BLOCK_V2.NETHER_PORTAL)
	}
	const ensured: { dimension: DimensionId; x: number; z: number }[] = []
	const terrain: DimTerrainAccess = {
		ensureColumn(dimension, x, z) {
			ensured.push({ dimension, x, z })
		},
		safeLandingY: () => LANDING_Y,
	}
	const travel = portalTravelCreate({
		registry,
		ecs,
		events,
		terrain: options.terrain === false ? undefined : terrain,
		linkSearchRadius: options.radius,
	})
	const entity = spawnLivingEntity(ecs, { x: OW_PORTAL.x + 0.5, y, z: OW_PORTAL.z + 0.5 })
	travel.place(entity, OVERWORLD)
	return { registry, ecs, events, travel, entity, ensured }
}

/** Ticks `count` times, asserting that nothing travelled. */
const tickQuiet = (travel: PortalTravelInstance, count: number): void => {
	for (let i = 0; i < count; i++) expect(travel.tick()).toEqual([])
}

/** Ticks up to the last tick before the travel deadline. */
const tickToDeadline = (travel: PortalTravelInstance): void => {
	tickQuiet(travel, PORTAL.travelDelayTicks - 1)
}

describe('dimension state', () => {
	it(
		'keeps the Nether dark while block light still propagates',
		() => {
			expect(dimIsDark(NETHER)).toBe(true)
			expect(dimIsDark(OVERWORLD)).toBe(false)
			expect(DIMENSION_PARAMS[NETHER].skyLight).toBe(0)
			const registry = dimCreateRegistry()
			for (const id of registry.ids) {
				const world = registry.worldOf(id)
				stoneFloor(world, FLOOR_TOP)
				world.setBlock(4, FLOOR_TOP, 4, BLOCK.GLOWSTONE)
			}
			const nether = registry.worldOf(NETHER)
			nether.setBlock(10, FLOOR_TOP, 10, BLOCK_V2.NETHER_PORTAL)
			registry.seedAll()
			// The Overworld still lights its open columns...
			expect(registry.worldOf(OVERWORLD).getSkyLightAt(8, FLOOR_TOP + 6, 8)).toBe(MAX_LIGHT)
			// ...while no Nether column is ever open, at any height.
			for (let y = 0; y < CHUNK_Y; y += 16) {
				expect(nether.getSkyLightAt(8, y, 8)).toBe(0)
				expect(nether.getSkyLightAt(4, y, 4)).toBe(0)
			}
			// Block light is untouched: the lamp still loses one level per voxel.
			const glow = lightPropsOf(BLOCK.GLOWSTONE).emission
			expect(glow).toBeGreaterThan(0)
			expect(nether.getBlockLightAt(4, FLOOR_TOP, 4)).toBe(glow)
			expect(nether.getBlockLightAt(5, FLOOR_TOP, 4)).toBe(glow - 1)
			expect(nether.getBlockLightAt(6, FLOOR_TOP, 4)).toBe(glow - 2)
			// A portal voxel lights itself with the contract's light level.
			expect(nether.getBlockLightAt(10, FLOOR_TOP, 10)).toBe(PORTAL.lightLevel)
		},
		SLOW,
	)

	it('burns entities in lava only where the ambient fluid is lava', () => {
		expect(dimParamsOf(NETHER).ambientFluid).toBe('lava')
		expect(dimParamsOf(OVERWORLD).ambientFluid).not.toBe('lava')
		const registry = dimCreateRegistry()
		const ecs = createEcsWorld()
		const events = createRecordingEventBusV2()
		for (const id of registry.ids) {
			const world = registry.worldOf(id)
			world.ensureChunk(0, 0)
			fillRegion(world, 0, FLOOR_TOP - 2, 0, 15, FLOOR_TOP, 15, BLOCK.LAVA)
		}
		const entity = spawnLivingEntity(ecs, { x: 4.5, y: FLOOR_TOP, z: 4.5 })
		const health = ecs.get(entity, Health)
		const ambientOf = (dimension: DimensionId) =>
			dimCreateLavaAmbient({ registry, ecs, events, dimensionOf: () => dimension })
		// Lava in a dimension whose ambient fluid is water is harmless.
		expect(ambientOf(OVERWORLD).tick(0)).toEqual([])
		expect(health?.current).toBe(COMBAT.playerMaxHealth)
		const ambient = ambientOf(NETHER)
		expect(ambient.tick(0)).toEqual([entity])
		expect(health?.current).toBe(COMBAT.playerMaxHealth - DIM_LAVA_DAMAGE)
		expect(health?.invulnerableTicks).toBe(COMBAT.invulnerableTicks)
		// The window is only read here, so the next cadence tick is refused...
		expect(ambient.tick(DIM_LAVA_DAMAGE_INTERVAL_TICKS)).toEqual([])
		if (health) health.invulnerableTicks = 0
		// ...and ticks off the cadence never hurt either.
		expect(ambient.tick(DIM_LAVA_DAMAGE_INTERVAL_TICKS + 1)).toEqual([])
		expect(ambient.tick(DIM_LAVA_DAMAGE_INTERVAL_TICKS * 2)).toEqual([entity])
		expect(health?.current).toBe(COMBAT.playerMaxHealth - 2 * DIM_LAVA_DAMAGE)
		const hit = { entity, amount: DIM_LAVA_DAMAGE, source: null }
		expect(v2EventsNamed(events, EVENT.EntityDamaged)).toEqual([hit, hit])
		const particle = {
			kind: PARTICLE.Lava,
			x: 4.5,
			y: FLOOR_TOP,
			z: 4.5,
			count: DIM_LAVA_PARTICLE_COUNT,
		}
		expect(v2EventsNamed(events, EVENT_V2.ParticleSpawn)).toEqual([particle, particle])
		expect(v2CountEvents(events, EVENT.EntityDamaged)).toBe(2)
	})
})

describe('portal travel', () => {
	it('travels on the tick the contact counter reaches travelDelayTicks', () => {
		const fx = dimFixture({ netherPortal: true })
		tickToDeadline(fx.travel)
		expect(fx.travel.stateOf(fx.entity)?.contactTicks).toBe(PORTAL.travelDelayTicks - 1)
		expect(fx.travel.dimensionOf(fx.entity)).toBe(OVERWORLD)
		const at = { x: NT_PORTAL.x + 0.5, y: FLOOR_TOP, z: NT_PORTAL.z + 0.5 }
		expect(fx.travel.tick()).toEqual([
			{ entity: fx.entity, from: OVERWORLD, to: NETHER, at, portal: OW_PORTAL, link: NT_PORTAL },
		])
		expect(fx.travel.dimensionOf(fx.entity)).toBe(NETHER)
		expect(fx.travel.stateOf(fx.entity)?.contactTicks).toBe(0)
		expect(fx.travel.stateOf(fx.entity)?.cooldownTicks).toBe(PORTAL.cooldownTicks)
		expect(fx.ecs.get(fx.entity, Transform)).toMatchObject(at)
		expect(fx.ensured).toEqual([{ dimension: NETHER, x: NT_PORTAL.x, z: NT_PORTAL.z }])
		expect(v2EventsNamed(fx.events, EVENT_V2.PortalUsed)).toEqual([
			{ entity: fx.entity, at: OW_PORTAL },
		])
		expect(v2EventsNamed(fx.events, EVENT_V2.DimensionChanged)).toEqual([
			{ entity: fx.entity, from: OVERWORLD, to: NETHER, at },
		])
		expect(v2EventsNamed(fx.events, EVENT_V2.ParticleSpawn)).toEqual([
			{ kind: PARTICLE.Portal, x: at.x, y: at.y, z: at.z, count: DIM_PORTAL_PARTICLE_COUNT },
		])
		expect(v2CountEvents(fx.events, EVENT_V2.PortalUsed)).toBe(1)
		expect(v2CountEvents(fx.events, EVENT_V2.DimensionChanged)).toBe(1)
	})

	it('rejects travel during the cooldown and scales back on the return trip', () => {
		const fx = dimFixture({ netherPortal: true })
		tickToDeadline(fx.travel)
		expect(fx.travel.tick()).toHaveLength(1)
		// Contact never breaks here, so only the cooldown can hold the entity back.
		tickQuiet(fx.travel, PORTAL.cooldownTicks)
		expect(fx.travel.stateOf(fx.entity)?.cooldownTicks).toBe(0)
		expect(fx.travel.stateOf(fx.entity)?.contactTicks).toBe(PORTAL.cooldownTicks)
		expect(fx.travel.tick()).toEqual([
			{
				entity: fx.entity,
				from: NETHER,
				to: OVERWORLD,
				at: { x: OW_PORTAL.x + 0.5, y: FLOOR_TOP, z: OW_PORTAL.z + 0.5 },
				portal: NT_PORTAL,
				link: OW_PORTAL,
			},
		])
		expect(fx.travel.dimensionOf(fx.entity)).toBe(OVERWORLD)
		expect(v2CountEvents(fx.events, EVENT_V2.PortalUsed)).toBe(2)
	})

	it('resets the contact counter the moment contact breaks', () => {
		const fx = dimFixture({ netherPortal: true })
		const transform = fx.ecs.get(fx.entity, Transform)
		tickQuiet(fx.travel, PORTAL.travelDelayTicks - 10)
		if (transform) transform.x = 0.5
		tickQuiet(fx.travel, 1)
		expect(fx.travel.stateOf(fx.entity)?.contactTicks).toBe(0)
		if (transform) transform.x = OW_PORTAL.x + 0.5
		// The deadline of the interrupted run passes without a travel.
		tickQuiet(fx.travel, 10)
		expect(fx.travel.stateOf(fx.entity)?.contactTicks).toBe(10)
		expect(fx.travel.dimensionOf(fx.entity)).toBe(OVERWORLD)
		expect(v2CountEvents(fx.events, EVENT_V2.DimensionChanged)).toBe(0)
	})

	it('scales x and z in both directions and clamps y into the destination', () => {
		expect(portalTravelScaleAxis(OVERWORLD, NETHER, 64)).toBe(64 / NETHER_SCALE)
		expect(portalTravelScaleAxis(NETHER, OVERWORLD, 8)).toBe(8 * NETHER_SCALE)
		expect(portalTravelScaleAxis(OVERWORLD, NETHER, -64)).toBe(-64 / NETHER_SCALE)
		const there = portalTravelScaleAxis(OVERWORLD, NETHER, 123)
		expect(portalTravelScaleAxis(NETHER, OVERWORLD, there)).toBe(123)
		// End to end, from above the Nether ceiling and with nothing to link to.
		const high = 200
		const fx = dimFixture({ y: high, radius: SMALL_RADIUS, terrain: false })
		tickToDeadline(fx.travel)
		expect(fx.travel.tick()).toEqual([
			{
				entity: fx.entity,
				from: OVERWORLD,
				to: NETHER,
				at: { x: SCALED, y: DIMENSION_PARAMS[NETHER].ceilingY, z: SCALED },
				portal: { x: OW_PORTAL.x, y: high, z: OW_PORTAL.z },
				link: null,
			},
		])
	})

	it('asks terrain for a landing spot when nothing links on the far side', () => {
		const fx = dimFixture({ radius: SMALL_RADIUS })
		tickToDeadline(fx.travel)
		expect(fx.travel.tick()).toEqual([
			{
				entity: fx.entity,
				from: OVERWORLD,
				to: NETHER,
				at: { x: SCALED, y: LANDING_Y, z: SCALED },
				portal: OW_PORTAL,
				link: null,
			},
		])
		expect(fx.ensured).toEqual([
			{ dimension: NETHER, x: Math.floor(SCALED), z: Math.floor(SCALED) },
		])
	})

	it('builds a minimal frame and links the nearest portal deterministically', () => {
		const world = dimCreateRegistry().worldOf(NETHER)
		world.ensureChunk(0, 0)
		const frame = portalTravelBuildFrame(world, { x: 2, y: FLOOR_TOP, z: 2 })
		expect(frame.anchor).toEqual({ x: 2, y: FLOOR_TOP, z: 2 })
		expect(frame.inner).toHaveLength(PORTAL.minInnerWidth * PORTAL.minInnerHeight)
		expect(world.getBlock(2, FLOOR_TOP, 2)).toBe(BLOCK_V2.NETHER_PORTAL)
		expect(world.getBlock(1, FLOOR_TOP, 2)).toBe(PORTAL.frameBlock)
		expect(world.getBlock(2, FLOOR_TOP - 1, 2)).toBe(PORTAL.frameBlock)
		expect(world.getBlock(2, FLOOR_TOP + PORTAL.minInnerHeight, 2)).toBe(PORTAL.frameBlock)
		const origin = { x: 2, y: FLOOR_TOP, z: 8 }
		expect(portalTravelFindPortal(world, origin, { radius: 8 })).toEqual({
			x: 2,
			y: FLOOR_TOP,
			z: 2,
		})
		expect(portalTravelFindPortal(world, origin, { radius: 2 })).toBeNull()
	})
})
