import { describe, expect, it } from 'vitest'
import { BLOCK } from '../blocks'
import { ITEM } from '../items'
import { EVENT } from '../events'
import { MOB } from '../mob'
import { CONTRACT_VERSION } from '../index'
import {
	BLOCK_V2,
	BLOCK_V2_BASE,
	BLOCK_V2_MAX,
	BREEDING,
	BREED_FOOD,
	CONTRACT_V2_VERSION,
	CROP,
	CROP_STAGES,
	DIMENSION,
	DIMENSION_COUNT,
	DIMENSION_PARAMS,
	ENCHANTMENT,
	ENCHANT_APPLIES_TO,
	ENCHANT_MAX_LEVEL,
	EVENT_V2,
	ITEM_V2,
	ITEM_V2_BASE,
	ITEM_V2_MAX,
	NET,
	NET_HEADER_BYTES,
	NET_OPCODE,
	PARTICLE,
	PARTICLE_BUDGET,
	PORTAL,
	VILLAGE,
	XP,
	decodeFrameHeader,
	encodeFrameHeader,
	enchantLevelCost,
	isCompatibleProtocol,
	levelFromXp,
	xpForLevel,
} from '../v2'

function nums(o: Record<string, number>): number[] {
	return Object.values(o)
}

describe('v2 registry ids stay additive', () => {
	it('keeps v2 blocks unique, in range and disjoint from v1', () => {
		const v2 = nums(BLOCK_V2)
		expect(new Set(v2).size).toBe(v2.length)
		for (const id of v2) {
			expect(id).toBeGreaterThanOrEqual(BLOCK_V2_BASE)
			expect(id).toBeLessThanOrEqual(BLOCK_V2_MAX)
		}
		const v1 = new Set(nums(BLOCK as unknown as Record<string, number>))
		for (const id of v2) expect(v1.has(id)).toBe(false)
	})

	it('keeps v2 items unique, in range and disjoint from v1', () => {
		const v2 = nums(ITEM_V2)
		expect(new Set(v2).size).toBe(v2.length)
		for (const id of v2) {
			expect(id).toBeGreaterThanOrEqual(ITEM_V2_BASE)
			expect(id).toBeLessThanOrEqual(ITEM_V2_MAX)
		}
		const v1 = new Set(nums(ITEM as unknown as Record<string, number>))
		for (const id of v2) expect(v1.has(id)).toBe(false)
	})

	it('adds event names without shadowing v1 names', () => {
		const v2 = Object.values(EVENT_V2) as string[]
		expect(new Set(v2).size).toBe(v2.length)
		const v1 = new Set(Object.values(EVENT) as string[])
		for (const name of v2) expect(v1.has(name)).toBe(false)
	})

	it('pins both contract versions', () => {
		expect(CONTRACT_VERSION).toBe('1.1.0')
		expect(CONTRACT_V2_VERSION).toBe('1.1.0')
	})

	it('keeps particle ids unique and inside the budget shape', () => {
		const ids = nums(PARTICLE)
		expect(new Set(ids).size).toBe(ids.length)
		expect(PARTICLE_BUDGET.maxSpawnPerTick).toBeLessThanOrEqual(PARTICLE_BUDGET.maxAlive)
		expect(PARTICLE_BUDGET.floatsPerParticle).toBeGreaterThan(0)
	})
})

describe('dimensions and structures', () => {
	it('describes every dimension exactly once', () => {
		const ids = nums(DIMENSION)
		expect(ids.length).toBe(DIMENSION_COUNT)
		for (const id of ids) {
			const params = DIMENSION_PARAMS[id as 0 | 1]
			expect(params).toBeDefined()
			expect(params.id).toBe(id)
			expect(params.ceilingY).toBeLessThanOrEqual(255)
			expect(params.skyLight).toBeGreaterThanOrEqual(0)
			expect(params.skyLight).toBeLessThanOrEqual(15)
		}
		const keys = ids.map((id) => DIMENSION_PARAMS[id as 0 | 1].dimensionKey)
		expect(new Set(keys).size).toBe(keys.length)
	})

	it('keeps the nether dark, lava filled and eight times smaller', () => {
		const nether = DIMENSION_PARAMS[DIMENSION.Nether]
		expect(nether.hasSky).toBe(false)
		expect(nether.skyLight).toBe(0)
		expect(nether.coordinateScale).toBe(8)
		expect(nether.ambientFluid).toBe('lava')
	})

	it('keeps portal frames buildable and lit', () => {
		expect(PORTAL.minInnerWidth).toBeGreaterThanOrEqual(2)
		expect(PORTAL.minInnerHeight).toBeGreaterThanOrEqual(3)
		expect(PORTAL.maxInnerWidth).toBeGreaterThanOrEqual(PORTAL.minInnerWidth)
		expect(PORTAL.lightLevel).toBeGreaterThan(0)
		expect(PORTAL.lightLevel).toBeLessThanOrEqual(15)
	})

	it('spaces villages apart and restricts them to biomes', () => {
		expect(VILLAGE.jitterChunks).toBeLessThan(VILLAGE.regionChunks)
		expect(VILLAGE.minBuildings).toBeLessThanOrEqual(VILLAGE.maxBuildings)
		expect(VILLAGE.allowedBiomes.length).toBeGreaterThan(0)
		expect(VILLAGE.spawnChancePercent).toBeGreaterThan(0)
		expect(VILLAGE.spawnChancePercent).toBeLessThanOrEqual(100)
	})
})

describe('experience and enchanting formulas', () => {
	it('keeps xp monotonic and round trips levels', () => {
		for (let level = 0; level < XP.maxLevel; level++) {
			expect(xpForLevel(level + 1)).toBeGreaterThan(xpForLevel(level))
			expect(levelFromXp(xpForLevel(level))).toBe(level)
			expect(levelFromXp(xpForLevel(level + 1) - 1)).toBe(level)
		}
		expect(xpForLevel(-5)).toBe(0)
		expect(levelFromXp(-5)).toBe(0)
	})

	it('never offers a cost above the level cap and rewards bookshelves', () => {
		for (let slot = 0; slot < 3; slot++) {
			expect(enchantLevelCost(0, slot)).toBeGreaterThanOrEqual(1)
			expect(enchantLevelCost(99, slot)).toBeLessThanOrEqual(XP.maxLevel)
			expect(enchantLevelCost(15, slot)).toBeGreaterThanOrEqual(enchantLevelCost(0, slot))
		}
		expect(enchantLevelCost(15, 2)).toBeGreaterThan(enchantLevelCost(15, 0))
	})

	it('gives every enchantment a level cap and target list', () => {
		for (const id of nums(ENCHANTMENT)) {
			const max = ENCHANT_MAX_LEVEL[id as 0]
			expect(max).toBeGreaterThanOrEqual(1)
			expect(ENCHANT_APPLIES_TO[id as 0]).toBeDefined()
		}
		expect(ENCHANT_MAX_LEVEL[ENCHANTMENT.SilkTouch]).toBe(1)
	})
})

describe('farming and breeding', () => {
	it('plants, grows and harvests with sane numbers', () => {
		expect(CROP_STAGES).toBe(8)
		for (const crop of Object.values(CROP)) {
			expect(crop.growChanceWet).toBeGreaterThan(crop.growChanceDry)
			expect(crop.growChanceWet).toBeLessThanOrEqual(1)
			expect(crop.minProduct).toBeLessThanOrEqual(crop.maxProduct)
			expect(crop.block).toBeGreaterThanOrEqual(BLOCK_V2_BASE)
		}
	})

	it('feeds every passive mob and keeps babies slower to mature than love', () => {
		for (const mob of [MOB.Pig, MOB.Cow, MOB.Sheep, MOB.Chicken]) {
			const food = BREED_FOOD[mob]
			expect(food).toBeDefined()
			expect((food ?? []).length).toBeGreaterThan(0)
		}
		expect(BREEDING.babyGrowTicks).toBeGreaterThan(BREEDING.loveTicks)
		expect(BREEDING.cooldownTicks).toBeGreaterThan(BREEDING.loveTicks)
		expect(BREEDING.babyScale).toBeLessThan(1)
	})
})

describe('net framing', () => {
	it('round trips a header for every opcode', () => {
		const buf = new ArrayBuffer(NET_HEADER_BYTES)
		const view = new DataView(buf)
		for (const opcode of nums(NET_OPCODE)) {
			const next = encodeFrameHeader(view, 0, opcode as 1, 1234)
			expect(next).toBe(NET_HEADER_BYTES)
			const header = decodeFrameHeader(view, 0)
			expect(header.opcode).toBe(opcode)
			expect(header.payloadLength).toBe(1234)
			expect(isCompatibleProtocol(header.version)).toBe(true)
		}
	})

	it('rejects bad magic, truncation and oversized payloads', () => {
		const view = new DataView(new ArrayBuffer(NET_HEADER_BYTES))
		view.setUint16(0, 0x1234, true)
		expect(() => decodeFrameHeader(view, 0)).toThrow(/bad magic/)
		const short = new DataView(new ArrayBuffer(4))
		expect(() => decodeFrameHeader(short, 0)).toThrow(/truncated/)
		expect(() => encodeFrameHeader(view, 0, NET_OPCODE.Input, NET.maxMessageBytes + 1)).toThrow()
		expect(isCompatibleProtocol(NET.protocolVersion + 1)).toBe(false)
	})

	it('keeps client and server opcode ranges apart', () => {
		const clientBound = [NET_OPCODE.Hello, NET_OPCODE.Input, NET_OPCODE.BlockEdit, NET_OPCODE.Chat]
		const serverBound = [NET_OPCODE.Welcome, NET_OPCODE.Snapshot, NET_OPCODE.ChunkData]
		for (const op of clientBound) expect(op).toBeLessThan(64)
		for (const op of serverBound) expect(op).toBeGreaterThanOrEqual(64)
		expect(NET.snapshotHz).toBeLessThanOrEqual(NET.tickHz)
		expect(NET.maxPlayers).toBeGreaterThan(1)
	})
})
