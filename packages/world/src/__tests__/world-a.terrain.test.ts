import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	BEDROCK_LAYERS,
	BENCH,
	BIOME,
	BLOCK,
	CHUNK_VOLUME,
	CHUNK_Y,
	PERF,
	SEA_LEVEL,
	WORLD_GEN_VERSION,
	blockIndex,
	hashBuffer,
} from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { createWorldGenerator, generateRegion } from '../index'
import golden from './golden.json'

const BIOME_NAMES = ['Plains', 'Forest', 'Desert', 'Snowy', 'Mountains', 'Ocean']

/** Chunks that the scripts/locate.ts probe reported as fully one biome. */
const OCEAN_CHUNKS: ReadonlyArray<{ seed: number; cx: number; cz: number }> = [
	{ seed: 1337, cx: 30, cz: -48 },
	{ seed: 20260916, cx: -39, cz: -48 },
]

function generate(seed: number, cx: number, cz: number) {
	const blocks = new Uint16Array(CHUNK_VOLUME)
	const fluids = new Uint8Array(CHUNK_VOLUME)
	createWorldGenerator(seed).generateChunk(cx, cz, blocks, fluids)
	return { blocks, fluids }
}

describe('golden chunks', () => {
	it('reproduces the pinned fixture byte for byte', () => {
		expect(golden.worldGenVersion).toBe(WORLD_GEN_VERSION)
		expect(golden.entries.length).toBeGreaterThan(0)
		const actual = golden.entries.map((entry) => {
			const { blocks, fluids } = generate(entry.seed, entry.cx, entry.cz)
			return {
				seed: entry.seed,
				cx: entry.cx,
				cz: entry.cz,
				blocks: hashBuffer(blocks),
				fluids: hashBuffer(fluids),
			}
		})
		expect(actual).toEqual(golden.entries)
	})
})

describe('determinism', () => {
	it('produces byte identical chunks for the same seed', () => {
		for (const [cx, cz] of [
			[0, 0],
			[-7, 19],
			[123, -456],
		]) {
			const first = generate(1337, cx, cz)
			const second = generate(1337, cx, cz)
			let blockDiff = -1
			let fluidDiff = -1
			for (let i = 0; i < CHUNK_VOLUME; i++) {
				if (blockDiff < 0 && first.blocks[i] !== second.blocks[i]) blockDiff = i
				if (fluidDiff < 0 && first.fluids[i] !== second.fluids[i]) fluidDiff = i
			}
			expect(blockDiff, `blocks differ at index ${blockDiff} of chunk ${cx},${cz}`).toBe(-1)
			expect(fluidDiff, `fluids differ at index ${fluidDiff} of chunk ${cx},${cz}`).toBe(-1)
		}
	})

	it('produces different worlds for different seeds', () => {
		const a = generate(1337, 0, 0)
		const b = generate(1338, 0, 0)
		expect(hashBuffer(a.blocks)).not.toBe(hashBuffer(b.blocks))
	})

	it('is independent of generation order', () => {
		const seed = 20260916
		const reference = generateRegion(createWorldGenerator(seed), -2, -2, 4, 'forward')
		for (const order of ['reverse', 'quadrants'] as const) {
			const other = generateRegion(createWorldGenerator(seed), -2, -2, 4, order)
			for (const chunk of reference.all()) {
				const mirror = other.chunk(chunk.cx, chunk.cz)
				if (mirror === undefined) throw new Error(`missing chunk ${chunk.cx},${chunk.cz}`)
				expect(
					hashBuffer(mirror.blocks),
					`${order} order changed blocks of chunk ${chunk.cx},${chunk.cz}`,
				).toBe(hashBuffer(chunk.blocks))
				expect(
					hashBuffer(mirror.fluids),
					`${order} order changed fluids of chunk ${chunk.cx},${chunk.cz}`,
				).toBe(hashBuffer(chunk.fluids))
			}
		}
	})

	it('never uses a non-deterministic or trigonometric API in generation code', () => {
		const forbidden = /Math\.random|Date\.now|Math\.sin|Math\.cos|performance\.now/
		const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..')
		const offenders: string[] = []
		const walk = (dir: string): void => {
			for (const entry of readdirSync(dir)) {
				const full = join(dir, entry)
				if (statSync(full).isDirectory()) {
					if (entry !== '__tests__') walk(full)
					continue
				}
				if (!full.endsWith('.ts')) continue
				if (forbidden.test(readFileSync(full, 'utf8'))) offenders.push(entry)
			}
		}
		walk(srcDir)
		expect(offenders).toEqual([])
	})
})

describe('biomes', () => {
	it('produces all six biomes across the world', () => {
		const gen = createWorldGenerator(1337)
		const counts = new Array<number>(6).fill(0)
		for (let wx = -2400; wx <= 2400; wx += 48) {
			for (let wz = -2400; wz <= 2400; wz += 48) counts[gen.biomeAt(wx, wz)]++
		}
		for (let biome = 0; biome < 6; biome++) {
			expect(counts[biome], `${BIOME_NAMES[biome]} occurrences`).toBeGreaterThanOrEqual(5)
		}
		expect(counts.reduce((a, b) => a + b, 0)).toBe(101 * 101)
	})

	it('agrees between biomeAt and sampleColumn', () => {
		const gen = createWorldGenerator(1337)
		for (let wx = -600; wx <= 600; wx += 137) {
			for (let wz = -600; wz <= 600; wz += 149) {
				const sample = gen.sampleColumn(wx, wz)
				expect(sample.biome).toBe(gen.biomeAt(wx, wz))
				expect(sample.surfaceY).toBeGreaterThan(0)
				expect(sample.surfaceY).toBeLessThan(CHUNK_Y)
			}
		}
	})
})

describe('column structure', () => {
	it('lays a bedrock floor confined to the bottom layers', () => {
		const { blocks } = generate(1337, 3, -9)
		let above = 0
		for (let z = 0; z < 16; z++) {
			for (let x = 0; x < 16; x++) {
				expect(blocks[blockIndex(x, 0, z)]).toBe(BLOCK.BEDROCK)
				for (let y = BEDROCK_LAYERS; y < CHUNK_Y; y++) {
					if (blocks[blockIndex(x, y, z)] === BLOCK.BEDROCK) above++
				}
			}
		}
		expect(above).toBe(0)
	})

	it('tops ocean columns with water exactly at sea level', () => {
		for (const { seed, cx, cz } of OCEAN_CHUNKS) {
			const gen = createWorldGenerator(seed)
			const { blocks, fluids } = generate(seed, cx, cz)
			let oceanColumns = 0
			for (let z = 0; z < 16; z++) {
				for (let x = 0; x < 16; x++) {
					const sample = gen.sampleColumn(cx * 16 + x, cz * 16 + z)
					if (sample.biome !== BIOME.Ocean) continue
					oceanColumns++
					expect(sample.surfaceY).toBeLessThan(SEA_LEVEL)
					const top = blocks[blockIndex(x, SEA_LEVEL, z)]
					expect([BLOCK.WATER, BLOCK.ICE]).toContain(top)
					if (top === BLOCK.WATER) {
						expect(fluids[blockIndex(x, SEA_LEVEL, z)]).not.toBe(0)
					}
					// Nothing above the waterline, and no gap just below it.
					expect(blocks[blockIndex(x, SEA_LEVEL + 1, z)]).toBe(BLOCK.AIR)
					expect(blocks[blockIndex(x, sample.surfaceY + 1, z)]).not.toBe(BLOCK.AIR)
				}
			}
			expect(oceanColumns, `ocean columns in chunk ${cx},${cz} of seed ${seed}`).toBeGreaterThan(0)
		}
	})
})

describe('performance', () => {
	it('generates a chunk within the benchmark budget', () => {
		const gen = createWorldGenerator(1337)
		const blocks = new Uint16Array(CHUNK_VOLUME)
		const fluids = new Uint8Array(CHUNK_VOLUME)
		for (let i = 0; i < 8; i++) gen.generateChunk(900 + i, 900, blocks, fluids)
		const runs = 24
		const started = performance.now()
		for (let i = 0; i < runs; i++) gen.generateChunk(i, 411, blocks, fluids)
		const avg = (performance.now() - started) / runs
		console.log(
			`chunkGen avg ${avg.toFixed(3)} ms over ${runs} chunks (budget ${PERF.chunkGenBudgetMs} ms, bench max ${BENCH.chunkGenAvgMsMax} ms)`,
		)
		expect(avg).toBeLessThan(BENCH.chunkGenAvgMsMax * BENCH.failFactor)
	})
})
