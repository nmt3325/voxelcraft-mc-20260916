import { BLOCK, CHUNK_VOLUME, blockIndex, hashBuffer, indexY } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { ORES, createWorldGenerator, generateRegion } from '../index'

const SEED = 1337
const LOGS: readonly number[] = [BLOCK.OAK_LOG, BLOCK.BIRCH_LOG, BLOCK.SPRUCE_LOG]
const LEAVES: readonly number[] = [BLOCK.OAK_LEAVES, BLOCK.BIRCH_LEAVES, BLOCK.SPRUCE_LEAVES]
const PLANTS: readonly number[] = [
	BLOCK.TALL_GRASS,
	BLOCK.DEAD_BUSH,
	BLOCK.FLOWER_RED,
	BLOCK.FLOWER_YELLOW,
	BLOCK.OAK_SAPLING,
	BLOCK.CACTUS,
]

describe('ore distribution', () => {
	const grid = generateRegion(createWorldGenerator(SEED), 0, 0, 4)
	const counts = new Map<number, number>()
	const sums = new Map<number, number>()
	const outOfRange: string[] = []

	for (const chunk of grid.all()) {
		for (let i = 0; i < CHUNK_VOLUME; i++) {
			const block = chunk.blocks[i]
			const ore = ORES.find((candidate) => candidate.block === block)
			if (ore === undefined) continue
			const y = indexY(i)
			counts.set(block, (counts.get(block) ?? 0) + 1)
			sums.set(block, (sums.get(block) ?? 0) + y)
			if (y < ore.minY || y > ore.maxY) outOfRange.push(`block ${block} at y=${y}`)
		}
	}

	it('places every ore type', () => {
		for (const ore of ORES) {
			expect(counts.get(ore.block) ?? 0, `ore block ${ore.block} count`).toBeGreaterThan(0)
		}
	})

	it('keeps every vein inside its declared depth band', () => {
		expect(outOfRange.slice(0, 5)).toEqual([])
	})

	it('puts the rare ores deeper than the common ones', () => {
		const meanY = (block: number): number => {
			const n = counts.get(block) ?? 0
			expect(n, `ore block ${block} count`).toBeGreaterThan(0)
			return (sums.get(block) ?? 0) / n
		}
		const diamond = meanY(BLOCK.DIAMOND_ORE)
		const iron = meanY(BLOCK.IRON_ORE)
		const coal = meanY(BLOCK.COAL_ORE)
		expect(diamond).toBeLessThan(iron)
		expect(iron).toBeLessThan(coal)
	})

	it('only replaces stone, never the surface or fluids', () => {
		const gen = createWorldGenerator(SEED)
		for (const chunk of grid.all()) {
			for (let z = 0; z < 16; z++) {
				for (let x = 0; x < 16; x++) {
					const sample = gen.sampleColumn(chunk.cx * 16 + x, chunk.cz * 16 + z)
					const surface = chunk.blocks[blockIndex(x, sample.surfaceY, z)]
					expect(ORES.some((ore) => ore.block === surface)).toBe(false)
				}
			}
		}
	})
})

describe('caves', () => {
	const grid = generateRegion(createWorldGenerator(SEED), -40, 24, 4)

	it('never carves away the surface block of a column', () => {
		const gen = createWorldGenerator(SEED)
		let openSurfaces = 0
		for (const chunk of grid.all()) {
			for (let z = 0; z < 16; z++) {
				for (let x = 0; x < 16; x++) {
					const sample = gen.sampleColumn(chunk.cx * 16 + x, chunk.cz * 16 + z)
					if (chunk.blocks[blockIndex(x, sample.surfaceY, z)] === BLOCK.AIR) openSurfaces++
				}
			}
		}
		expect(openSurfaces).toBe(0)
	})

	it('carves open space underground without hollowing out the world', () => {
		let airDeep = 0
		let deep = 0
		for (const chunk of grid.all()) {
			for (let i = 0; i < CHUNK_VOLUME; i++) {
				const y = indexY(i)
				if (y < 5 || y >= 64) continue
				deep++
				if (chunk.blocks[i] === BLOCK.AIR) airDeep++
			}
		}
		expect(deep).toBeGreaterThan(0)
		// Caves must exist, but must not turn the underground into a void.
		expect(airDeep / deep).toBeGreaterThan(0.001)
		expect(airDeep / deep).toBeLessThan(0.4)
	})

	it('leaves the bedrock floor intact', () => {
		for (const chunk of grid.all()) {
			for (let z = 0; z < 16; z++) {
				for (let x = 0; x < 16; x++) {
					expect(chunk.blocks[blockIndex(x, 0, z)]).toBe(BLOCK.BEDROCK)
				}
			}
		}
	})
})

describe('decoration', () => {
	const decorated = (seed: number, cx0: number, cz0: number, size: number) => {
		const gen = createWorldGenerator(seed)
		const grid = generateRegion(gen, cx0, cz0, size)
		for (const chunk of grid.all()) gen.decorate(chunk.cx, chunk.cz, grid)
		return grid
	}

	it('is deterministic, including the parts that cross chunk borders', () => {
		const first = decorated(SEED, -40, 24, 5)
		const second = decorated(SEED, -40, 24, 5)
		for (const chunk of first.all()) {
			const mirror = second.chunk(chunk.cx, chunk.cz)
			if (mirror === undefined) throw new Error(`missing chunk ${chunk.cx},${chunk.cz}`)
			expect(hashBuffer(mirror.blocks), `chunk ${chunk.cx},${chunk.cz}`).toBe(
				hashBuffer(chunk.blocks),
			)
		}
	})

	it('grows trees with trunks and canopies', () => {
		const grid = decorated(SEED, -40, 24, 5)
		let logs = 0
		let leaves = 0
		for (const chunk of grid.all()) {
			for (let i = 0; i < CHUNK_VOLUME; i++) {
				const block = chunk.blocks[i]
				if (LOGS.indexOf(block) >= 0) logs++
				else if (LEAVES.indexOf(block) >= 0) leaves++
			}
		}
		expect(logs).toBeGreaterThan(0)
		// Every tree carries more canopy than trunk.
		expect(leaves).toBeGreaterThan(logs)
	})

	it('roots every trunk and plant on solid ground', () => {
		const grid = decorated(SEED, -40, 24, 5)
		let checkedLogs = 0
		let checkedPlants = 0
		for (const chunk of grid.all()) {
			for (let i = 0; i < CHUNK_VOLUME; i++) {
				const block = chunk.blocks[i]
				const isLog = LOGS.indexOf(block) >= 0
				const isPlant = PLANTS.indexOf(block) >= 0
				if (!isLog && !isPlant) continue
				const y = indexY(i)
				expect(y).toBeGreaterThan(0)
				const below = chunk.blocks[i - 256]
				if (isLog) {
					checkedLogs++
					expect(below).not.toBe(BLOCK.AIR)
					expect(below).not.toBe(BLOCK.WATER)
				} else {
					checkedPlants++
					// A plant either sits on the ground or stacks on a cactus below it.
					expect(below).not.toBe(BLOCK.AIR)
				}
			}
		}
		expect(checkedLogs).toBeGreaterThan(0)
		expect(checkedPlants).toBeGreaterThan(0)
	})

	it('does not disturb the generated terrain below the surface', () => {
		const gen = createWorldGenerator(SEED)
		const plain = generateRegion(gen, -40, 24, 3)
		const grid = decorated(SEED, -40, 24, 3)
		for (const chunk of plain.all()) {
			const mirror = grid.chunk(chunk.cx, chunk.cz)
			if (mirror === undefined) throw new Error(`missing chunk ${chunk.cx},${chunk.cz}`)
			for (let i = 0; i < CHUNK_VOLUME; i++) {
				if (chunk.blocks[i] === BLOCK.AIR) continue
				expect(mirror.blocks[i], `overwrote solid voxel ${i} of ${chunk.cx},${chunk.cz}`).toBe(
					chunk.blocks[i],
				)
			}
		}
	})
})
