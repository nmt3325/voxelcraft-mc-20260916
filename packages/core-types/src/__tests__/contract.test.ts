import { describe, expect, it } from 'vitest'
import { BLOCK, BLOCK_EXPERIMENTAL_BASE, TOOL_CLASS, TOOL_TIER, breakTimeSeconds } from '../blocks'
import { ITEM, ITEM_NON_BLOCK_BASE, INVENTORY } from '../items'
import { EVENT } from '../events'
import { BENCH, PERF } from '../perf'
import { PADDED, PADDED_VOLUME, VERTEX_STRIDE_U16, paddedIndex } from '../mesh'
import { fallDamage } from '../physics'
import { CONTRACT_VERSION } from '../index'

function values(o: Record<string, number | string>): (number | string)[] {
	return Object.values(o)
}

describe('shared registry ids', () => {
	it('has unique block ids inside the reserved range', () => {
		const ids = values(BLOCK) as number[]
		expect(new Set(ids).size).toBe(ids.length)
		expect(BLOCK.AIR).toBe(0)
		for (const id of ids) expect(id).toBeLessThan(BLOCK_EXPERIMENTAL_BASE)
	})

	it('keeps non block item ids above the block range', () => {
		const ids = values(ITEM) as number[]
		expect(new Set(ids).size).toBe(ids.length)
		for (const id of ids) expect(id).toBeGreaterThanOrEqual(ITEM_NON_BLOCK_BASE)
	})

	it('has unique event names', () => {
		const names = values(EVENT) as string[]
		expect(new Set(names).size).toBe(names.length)
	})

	it('exposes the frozen inventory shape', () => {
		expect(INVENTORY.totalSlots).toBe(36)
		expect(INVENTORY.hotbarSlots).toBe(9)
		expect(INVENTORY.craftGrid3).toBe(9)
	})

	it('pins the contract version', () => {
		expect(CONTRACT_VERSION).toBe('1.1.0')
	})
})

describe('shared formulas', () => {
	it('rewards the correct tool and punishes the wrong one', () => {
		const stone = {
			id: BLOCK.STONE,
			name: 'stone',
			displayName: 'Stone',
			layer: 0 as const,
			solid: true,
			fullCube: true,
			replaceable: false,
			opacity: 15,
			emission: 0,
			skyPassThrough: false,
			skyFilter: 0,
			hardness: 1.5,
			toolClass: TOOL_CLASS.Pickaxe,
			minTier: TOOL_TIER.Wood,
			textures: { all: 'stone' },
			drops: [],
			fluid: 0 as const,
			blockEntity: null,
			gravity: false,
			flammable: false,
			redstone: null,
			soundGroup: 'stone' as const,
			itemId: BLOCK.COBBLESTONE,
		}
		const byHand = breakTimeSeconds(stone, TOOL_TIER.None, TOOL_CLASS.None)
		const byWood = breakTimeSeconds(stone, TOOL_TIER.Wood, TOOL_CLASS.Pickaxe)
		const byDiamond = breakTimeSeconds(stone, TOOL_TIER.Diamond, TOOL_CLASS.Pickaxe)
		expect(byHand).toBeGreaterThan(byWood)
		expect(byWood).toBeGreaterThan(byDiamond)
		expect(breakTimeSeconds({ ...stone, hardness: -1 }, TOOL_TIER.Diamond, TOOL_CLASS.Pickaxe)).toBe(
			Number.POSITIVE_INFINITY,
		)
	})

	it('gives the first three fall blocks for free', () => {
		expect(fallDamage(0)).toBe(0)
		expect(fallDamage(3)).toBe(0)
		expect(fallDamage(4)).toBe(1)
		expect(fallDamage(10.5)).toBe(7)
	})
})

describe('mesh and perf contract', () => {
	it('uses an 18 cubed padded neighbourhood', () => {
		expect(PADDED).toBe(18)
		expect(PADDED_VOLUME).toBe(5832)
		expect(VERTEX_STRIDE_U16).toBe(8)
		expect(paddedIndex(0, 0, 0)).toBe(1 + 18 * (1 + 18))
		const seen = new Set<number>()
		for (let y = -1; y <= 16; y++)
			for (let z = -1; z <= 16; z++)
				for (let x = -1; x <= 16; x++) seen.add(paddedIndex(x, y, z))
		expect(seen.size).toBe(PADDED_VOLUME)
	})

	it('keeps budgets consistent', () => {
		expect(PERF.simTickMs).toBe(1000 / PERF.simTickHz)
		expect(PERF.renderDistanceDefault).toBeLessThanOrEqual(PERF.renderDistanceMax)
		expect(BENCH.renderDistance).toBe(8)
		expect(BENCH.failFactor).toBeGreaterThan(1)
	})
})
