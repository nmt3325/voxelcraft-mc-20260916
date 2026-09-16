import { describe, expect, it } from 'vitest'
import {
	BLOCK,
	BLOCK_V2,
	CROP,
	CROP_STAGES,
	EVENT_V2,
	FARMING,
	type BlockId,
	type EventBusV2,
	type ItemStack,
} from '@voxelcraft/core-types'
import {
	createTrampleTracker,
	farmPosKey,
	isHydrated,
	tillSoil,
	trampleFarmland,
	updateFarmland,
	type FarmWorld,
} from './farmland'
import {
	createCropField,
	cropPosKey,
	cropStageAt,
	harvestCrop,
	isMature,
	plantCrop,
	randomTickCrops,
	removeCrop,
	type CropField,
	type RandomTickOptions,
} from './crops'

const MAX_STAGE = CROP_STAGES - 1
const CROP_X = 0
const SOIL_Y = 64
const CROP_Y = 65
const CROP_Z = 0
const HOE: ItemStack = { item: FARMING.hoeItem, count: 1, damage: 0 }

interface FakeWorld extends FarmWorld {
	place(x: number, y: number, z: number, id: BlockId): void
}

/** Sparse in-test world: everything not placed is air. */
function createFakeWorld(): FakeWorld {
	const blocks = new Map<string, BlockId>()
	return {
		getBlock(x, y, z) {
			return blocks.get(farmPosKey(x, y, z)) ?? BLOCK.AIR
		},
		setBlock(x, y, z, id) {
			blocks.set(farmPosKey(x, y, z), id)
		},
		place(x, y, z, id) {
			blocks.set(farmPosKey(x, y, z), id)
		},
	}
}

interface RecordedEvent {
	name: string
	payload: unknown
}

function recordingBus(): { bus: EventBusV2; events: RecordedEvent[] } {
	const events: RecordedEvent[] = []
	const bus = {
		on: () => () => {},
		emit: (name: string, payload: unknown) => {
			events.push({ name, payload })
		},
		clear: () => {
			events.length = 0
		},
	} as unknown as EventBusV2
	return { bus, events }
}

/** One wheat crop planted on wet or dry farmland at the shared test position. */
function plantedField(wet: boolean): { field: CropField; world: FakeWorld } {
	const world = createFakeWorld()
	world.place(CROP_X, SOIL_Y, CROP_Z, wet ? BLOCK_V2.FARMLAND_WET : BLOCK_V2.FARMLAND)
	const field = createCropField()
	expect(plantCrop(field, world, CROP_X, CROP_Y, CROP_Z, CROP.wheat.seed)).toBe(true)
	return { field, world }
}

function tickStages(
	field: CropField,
	world: FarmWorld,
	seed: number,
	ticks: number,
	lightAt?: (x: number, y: number, z: number) => number,
	bus?: EventBusV2,
): number[] {
	const stages: number[] = []
	for (let tick = 1; tick <= ticks; tick++) {
		const options: RandomTickOptions = { seed, tick }
		if (lightAt !== undefined) options.lightAt = lightAt
		if (bus !== undefined) options.bus = bus
		randomTickCrops(field, world, options)
		stages.push(cropStageAt(field, CROP_X, CROP_Y, CROP_Z))
	}
	return stages
}

describe('farmland', () => {
	it('tills dirt and grass with the hoe only', () => {
		const world = createFakeWorld()
		world.place(0, SOIL_Y, 0, BLOCK.DIRT)
		world.place(1, SOIL_Y, 0, BLOCK.GRASS_BLOCK)
		world.place(2, SOIL_Y, 0, BLOCK.DIRT)
		world.place(3, SOIL_Y, 0, BLOCK.DIRT)
		world.place(3, SOIL_Y + 1, 0, BLOCK.STONE)

		expect(tillSoil(world, 0, SOIL_Y, 0, HOE)).toBe(true)
		expect(world.getBlock(0, SOIL_Y, 0)).toBe(BLOCK_V2.FARMLAND)
		expect(tillSoil(world, 1, SOIL_Y, 0, HOE)).toBe(true)
		expect(world.getBlock(1, SOIL_Y, 0)).toBe(BLOCK_V2.FARMLAND)

		expect(tillSoil(world, 2, SOIL_Y, 0, null)).toBe(false)
		expect(world.getBlock(2, SOIL_Y, 0)).toBe(BLOCK.DIRT)
		expect(tillSoil(world, 3, SOIL_Y, 0, HOE)).toBe(false)
		expect(world.getBlock(3, SOIL_Y, 0)).toBe(BLOCK.DIRT)
	})

	it('clears a replaceable cover block while tilling', () => {
		const world = createFakeWorld()
		world.place(0, SOIL_Y, 0, BLOCK.GRASS_BLOCK)
		world.place(0, SOIL_Y + 1, 0, BLOCK.TALL_GRASS)
		expect(tillSoil(world, 0, SOIL_Y, 0, HOE)).toBe(true)
		expect(world.getBlock(0, SOIL_Y + 1, 0)).toBe(BLOCK.AIR)
	})

	it('hydrates from water at radius 4 but not at radius 5', () => {
		const near = createFakeWorld()
		near.place(0, SOIL_Y, 0, BLOCK_V2.FARMLAND)
		near.place(FARMING.hydrationRadius, SOIL_Y, 0, BLOCK.WATER)
		expect(isHydrated(near, 0, SOIL_Y, 0)).toBe(true)

		const far = createFakeWorld()
		far.place(0, SOIL_Y, 0, BLOCK_V2.FARMLAND)
		far.place(FARMING.hydrationRadius + 1, SOIL_Y, 0, BLOCK.WATER)
		expect(isHydrated(far, 0, SOIL_Y, 0)).toBe(false)

		const above = createFakeWorld()
		above.place(0, SOIL_Y, 0, BLOCK_V2.FARMLAND)
		above.place(0, SOIL_Y + 1, FARMING.hydrationRadius, BLOCK.WATER_FLOWING)
		expect(isHydrated(above, 0, SOIL_Y, 0)).toBe(true)

		const below = createFakeWorld()
		below.place(0, SOIL_Y, 0, BLOCK_V2.FARMLAND)
		below.place(0, SOIL_Y - 1, 0, BLOCK.WATER)
		expect(isHydrated(below, 0, SOIL_Y, 0)).toBe(false)
	})

	it('switches farmland between dry and wet', () => {
		const world = createFakeWorld()
		world.place(0, SOIL_Y, 0, BLOCK_V2.FARMLAND)
		expect(updateFarmland(world, 0, SOIL_Y, 0)).toBe(false)

		world.place(2, SOIL_Y, 0, BLOCK.WATER)
		expect(updateFarmland(world, 0, SOIL_Y, 0)).toBe(true)
		expect(world.getBlock(0, SOIL_Y, 0)).toBe(BLOCK_V2.FARMLAND_WET)

		world.place(2, SOIL_Y, 0, BLOCK.AIR)
		expect(updateFarmland(world, 0, SOIL_Y, 0)).toBe(true)
		expect(world.getBlock(0, SOIL_Y, 0)).toBe(BLOCK_V2.FARMLAND)

		expect(updateFarmland(world, 9, SOIL_Y, 0)).toBe(false)
	})

	it('reverts to dirt after trampleFalls impacts and removes the crop above', () => {
		const { field, world } = plantedField(false)
		const tracker = createTrampleTracker()
		const cleared: string[] = []
		let reverted = false
		for (let i = 0; i < FARMING.trampleFalls; i++) {
			reverted = trampleFarmland(world, CROP_X, SOIL_Y, CROP_Z, 1, {
				tracker,
				onCropCleared: (x, y, z) => {
					cleared.push(cropPosKey(x, y, z))
					removeCrop(field, x, y, z)
				},
			}).reverted
		}

		expect(reverted).toBe(true)
		expect(world.getBlock(CROP_X, SOIL_Y, CROP_Z)).toBe(BLOCK.DIRT)
		expect(world.getBlock(CROP_X, CROP_Y, CROP_Z)).toBe(BLOCK.AIR)
		expect(cleared).toEqual([cropPosKey(CROP_X, CROP_Y, CROP_Z)])
		expect(cropStageAt(field, CROP_X, CROP_Y, CROP_Z)).toBe(-1)
		expect(tracker.impacts.size).toBe(0)
	})
})

describe('crops', () => {
	it('rejects planting when the block below is not farmland', () => {
		const world = createFakeWorld()
		world.place(CROP_X, SOIL_Y, CROP_Z, BLOCK.DIRT)
		const field = createCropField()
		expect(plantCrop(field, world, CROP_X, CROP_Y, CROP_Z, CROP.wheat.seed)).toBe(false)
		expect(world.getBlock(CROP_X, CROP_Y, CROP_Z)).toBe(BLOCK.AIR)
		expect(cropStageAt(field, CROP_X, CROP_Y, CROP_Z)).toBe(-1)
	})

	it('plants stage 0 on farmland and rejects an occupied target', () => {
		const { field, world } = plantedField(true)
		expect(world.getBlock(CROP_X, CROP_Y, CROP_Z)).toBe(CROP.wheat.block)
		expect(cropStageAt(field, CROP_X, CROP_Y, CROP_Z)).toBe(0)
		expect(plantCrop(field, world, CROP_X, CROP_Y, CROP_Z, CROP.wheat.seed)).toBe(false)
	})

	it('walks wheat to the last stage, stops there and replays per seed', () => {
		const first = plantedField(true)
		const { bus, events } = recordingBus()
		const stagesA = tickStages(first.field, first.world, 0x51ee, 240, undefined, bus)

		expect(stagesA[stagesA.length - 1]).toBe(MAX_STAGE)
		expect(Math.max(...stagesA)).toBe(MAX_STAGE)
		for (let i = 1; i < stagesA.length; i++) {
			expect(stagesA[i]).toBeGreaterThanOrEqual(stagesA[i - 1])
			expect(stagesA[i] - stagesA[i - 1]).toBeLessThanOrEqual(1)
		}

		const growths = events.filter((event) => event.name === EVENT_V2.CropGrown)
		expect(growths).toHaveLength(MAX_STAGE)
		expect(growths[0].payload).toEqual({ x: CROP_X, y: CROP_Y, z: CROP_Z, stage: 1 })

		const second = plantedField(true)
		const stagesB = tickStages(second.field, second.world, 0x51ee, 240)
		expect(stagesB).toEqual(stagesA)
	})

	it('blocks growth below the minimum light level', () => {
		const dark = plantedField(true)
		const darkStages = tickStages(dark.field, dark.world, 0x51ee, 240, () => FARMING.minLight - 1)
		expect(darkStages[darkStages.length - 1]).toBe(0)

		const lit = plantedField(true)
		const litStages = tickStages(lit.field, lit.world, 0x51ee, 240, () => FARMING.minLight)
		expect(litStages[litStages.length - 1]).toBe(MAX_STAGE)
	})

	it('grows faster on wet farmland than on dry farmland', () => {
		const ticks = 20
		const wet = plantedField(true)
		const dry = plantedField(false)
		const wetStages = tickStages(wet.field, wet.world, 0x7777, ticks)
		const dryStages = tickStages(dry.field, dry.world, 0x7777, ticks)
		expect(wetStages[ticks - 1]).toBeGreaterThan(dryStages[ticks - 1])
	})

	it('drops product plus exactly one seed when mature', () => {
		const { field, world } = plantedField(true)
		tickStages(field, world, 0x51ee, 240)
		expect(isMature(field, CROP_X, CROP_Y, CROP_Z)).toBe(true)

		const harvest = harvestCrop(field, world, CROP_X, CROP_Y, CROP_Z)
		expect(harvest).not.toBeNull()
		expect(harvest!.mature).toBe(true)
		expect(harvest!.product).toBeGreaterThanOrEqual(CROP.wheat.minProduct)
		expect(harvest!.product).toBeLessThanOrEqual(CROP.wheat.maxProduct)
		expect(harvest!.drops).toEqual([
			{ item: CROP.wheat.product, count: harvest!.product, damage: 0 },
			{ item: CROP.wheat.seed, count: 1, damage: 0 },
		])
		expect(world.getBlock(CROP_X, CROP_Y, CROP_Z)).toBe(BLOCK.AIR)
		expect(cropStageAt(field, CROP_X, CROP_Y, CROP_Z)).toBe(-1)
		expect(harvestCrop(field, world, CROP_X, CROP_Y, CROP_Z)).toBeNull()
	})

	it('adds a fortune bonus on top of the base product roll', () => {
		const plain = plantedField(true)
		tickStages(plain.field, plain.world, 0x51ee, 240)
		const base = harvestCrop(plain.field, plain.world, CROP_X, CROP_Y, CROP_Z, 0)

		const lucky = plantedField(true)
		tickStages(lucky.field, lucky.world, 0x51ee, 240)
		const bonus = harvestCrop(lucky.field, lucky.world, CROP_X, CROP_Y, CROP_Z, 3)

		expect(bonus!.product).toBeGreaterThan(base!.product)
		expect(bonus!.product).toBeLessThanOrEqual(CROP.wheat.maxProduct + 3)
		expect(bonus!.drops[0]).toEqual({ item: CROP.wheat.product, count: bonus!.product, damage: 0 })
	})

	it('drops only the seed for an immature crop', () => {
		const { field, world } = plantedField(true)
		expect(isMature(field, CROP_X, CROP_Y, CROP_Z)).toBe(false)

		const harvest = harvestCrop(field, world, CROP_X, CROP_Y, CROP_Z, 3)
		expect(harvest!.mature).toBe(false)
		expect(harvest!.product).toBe(0)
		expect(harvest!.drops).toEqual([{ item: CROP.wheat.seed, count: 1, damage: 0 }])
		expect(world.getBlock(CROP_X, CROP_Y, CROP_Z)).toBe(BLOCK.AIR)
		expect(cropStageAt(field, CROP_X, CROP_Y, CROP_Z)).toBe(-1)
	})
})
