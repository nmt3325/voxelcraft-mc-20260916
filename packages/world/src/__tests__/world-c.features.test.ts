/**
 * Caves, ore veins and decoration. Owned by task world-c.
 *
 * The invariants that matter for these three passes are: the crust and the
 * bedrock shell survive carving, the sea floor stays sealed, ore stays inside
 * its depth band and only replaces stone, and decoration is a pure function of
 * (seed, chunk) so it cannot depend on the order chunks are visited in, on
 * being run twice, or on which neighbours happen to be loaded.
 */
import {
	BEDROCK_LAYERS,
	BENCH,
	BIOME,
	BLOCK,
	CHUNK_VOLUME,
	CHUNK_X,
	CHUNK_Y,
	CHUNK_Z,
	PERF,
	SEA_LEVEL,
	blockIndex,
	hashBuffer,
} from '@voxelcraft/core-types'
import type { WorldGenerator } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import type { GenerationOrder } from '../index'
import {
	CAVES,
	ChunkGrid,
	ORES,
	VEGETATION,
	chunkCoords,
	createWorldGenerator,
	generateRegion,
} from '../index'

const SEED = 1337
/** Land region, also used by the world-a cave tests. */
const LAND = { cx: -40, cz: 24 }
/** Region whose centre chunk (30, -48) is ocean for this seed. */
const OCEAN = { cx: 29, cz: -49 }

const LOG_BLOCKS: readonly number[] = [BLOCK.OAK_LOG, BLOCK.BIRCH_LOG, BLOCK.SPRUCE_LOG]
const LEAF_BLOCKS: readonly number[] = [BLOCK.OAK_LEAVES, BLOCK.BIRCH_LEAVES, BLOCK.SPRUCE_LEAVES]
const PLANT_BLOCKS: readonly number[] = [
	BLOCK.TALL_GRASS,
	BLOCK.DEAD_BUSH,
	BLOCK.FLOWER_RED,
	BLOCK.FLOWER_YELLOW,
	BLOCK.OAK_SAPLING,
	BLOCK.CACTUS,
]
const ORE_BY_BLOCK = new Map(ORES.map((ore) => [ore.block, ore]))

function isLog(id: number): boolean {
	return LOG_BLOCKS.includes(id)
}

function isLeaf(id: number): boolean {
	return LEAF_BLOCKS.includes(id)
}

function isTrunk(id: number): boolean {
	return isLog(id) || id === BLOCK.CACTUS
}

function decorate(
	cx0: number,
	cz0: number,
	size: number,
	order: GenerationOrder = 'forward',
): { gen: WorldGenerator; grid: ChunkGrid } {
	const gen = createWorldGenerator(SEED)
	const grid = generateRegion(gen, cx0, cz0, size)
	for (const [cx, cz] of chunkCoords(cx0, cz0, size, order)) gen.decorate(cx, cz, grid)
	return { gen, grid }
}

/** First chunk whose centre column sits in the wanted biome. */
function findBiomeChunk(
	gen: WorldGenerator,
	biome: number,
	limit = 40,
): [number, number] | undefined {
	for (let r = 0; r <= limit; r++) {
		for (let cz = -r; cz <= r; cz++) {
			for (let cx = -r; cx <= r; cx++) {
				if (Math.max(Math.abs(cx), Math.abs(cz)) !== r) continue
				if (gen.biomeAt(cx * CHUNK_X + 8, cz * CHUNK_Z + 8) === biome) return [cx, cz]
			}
		}
	}
	return undefined
}

describe('cave carving', () => {
	const gen = createWorldGenerator(SEED)
	const grid = generateRegion(gen, LAND.cx, LAND.cz, 3)

	it('keeps the crust of every surface column', () => {
		let breaches = 0
		for (const chunk of grid.all()) {
			for (let z = 0; z < CHUNK_Z; z++) {
				for (let x = 0; x < CHUNK_X; x++) {
					const wx = chunk.cx * CHUNK_X + x
					const wz = chunk.cz * CHUNK_Z + z
					const surfaceY = gen.sampleColumn(wx, wz).surfaceY
					for (let d = 0; d < CAVES.surfaceMargin; d++) {
						if (chunk.blocks[blockIndex(x, surfaceY - d, z)] === BLOCK.AIR) breaches++
					}
				}
			}
		}
		expect(breaches).toBe(0)
	})

	it('never carves the bedrock shell', () => {
		let airInShell = 0
		let softFloor = 0
		for (const chunk of grid.all()) {
			for (let z = 0; z < CHUNK_Z; z++) {
				for (let x = 0; x < CHUNK_X; x++) {
					if (chunk.blocks[blockIndex(x, 0, z)] !== BLOCK.BEDROCK) softFloor++
					for (let y = 0; y < BEDROCK_LAYERS; y++) {
						if (chunk.blocks[blockIndex(x, y, z)] === BLOCK.AIR) airInShell++
					}
				}
			}
		}
		expect(softFloor).toBe(0)
		expect(airInShell).toBe(0)
	})

	it('opens caves without hollowing out the underground', () => {
		let air = 0
		let total = 0
		for (const chunk of grid.all()) {
			for (let y = BEDROCK_LAYERS; y < SEA_LEVEL; y++) {
				for (let z = 0; z < CHUNK_Z; z++) {
					for (let x = 0; x < CHUNK_X; x++) {
						total++
						if (chunk.blocks[blockIndex(x, y, z)] === BLOCK.AIR) air++
					}
				}
			}
		}
		const ratio = air / total
		console.log(`world-c deep air ratio ${(ratio * 100).toFixed(2)}%`)
		expect(ratio).toBeGreaterThan(0.002)
		expect(ratio).toBeLessThan(0.35)
	})

	it('produces both chambers and tunnels', () => {
		let chambers = 0
		let tunnels = 0
		for (const chunk of grid.all()) {
			for (let z = 1; z < CHUNK_Z - 1; z++) {
				for (let x = 1; x < CHUNK_X - 1; x++) {
					const wx = chunk.cx * CHUNK_X + x
					const wz = chunk.cz * CHUNK_Z + z
					const top = gen.sampleColumn(wx, wz).surfaceY - CAVES.surfaceMargin - 1
					for (let y = BEDROCK_LAYERS + 1; y <= top; y++) {
						if (chunk.blocks[blockIndex(x, y, z)] !== BLOCK.AIR) continue
						const open =
							chunk.blocks[blockIndex(x - 1, y, z)] === BLOCK.AIR &&
							chunk.blocks[blockIndex(x + 1, y, z)] === BLOCK.AIR &&
							chunk.blocks[blockIndex(x, y, z - 1)] === BLOCK.AIR &&
							chunk.blocks[blockIndex(x, y, z + 1)] === BLOCK.AIR
						if (!open) continue
						const up = chunk.blocks[blockIndex(x, y + 1, z)] === BLOCK.AIR
						const down = chunk.blocks[blockIndex(x, y - 1, z)] === BLOCK.AIR
						if (up && down) chambers++
						else if (!up && !down) tunnels++
					}
				}
			}
		}
		expect(chambers).toBeGreaterThan(0)
		expect(tunnels).toBeGreaterThan(0)
	})

	it('keeps the sea floor sealed', () => {
		const oceanGen = createWorldGenerator(SEED)
		const ocean = generateRegion(oceanGen, OCEAN.cx, OCEAN.cz, 3)
		const centre = ocean.chunk(OCEAN.cx + 1, OCEAN.cz + 1)
		expect(centre).toBeDefined()
		if (centre === undefined) return
		let water = 0
		let leaks = 0
		let seal = 0
		for (let z = 0; z < CHUNK_Z; z++) {
			for (let x = 0; x < CHUNK_X; x++) {
				const wx = centre.cx * CHUNK_X + x
				const wz = centre.cz * CHUNK_Z + z
				for (let y = 1; y <= SEA_LEVEL; y++) {
					if (centre.blocks[blockIndex(x, y, z)] !== BLOCK.WATER) continue
					water++
					const open =
						ocean.getBlock(wx - 1, y, wz) === BLOCK.AIR ||
						ocean.getBlock(wx + 1, y, wz) === BLOCK.AIR ||
						ocean.getBlock(wx, y, wz - 1) === BLOCK.AIR ||
						ocean.getBlock(wx, y, wz + 1) === BLOCK.AIR ||
						ocean.getBlock(wx, y - 1, wz) === BLOCK.AIR
					if (open) leaks++
				}
				const surfaceY = oceanGen.sampleColumn(wx, wz).surfaceY
				if (surfaceY >= SEA_LEVEL) continue
				for (let d = 0; d < CAVES.surfaceMargin + 4; d++) {
					const y = surfaceY - d
					if (y < 0) break
					if (centre.blocks[blockIndex(x, y, z)] === BLOCK.AIR) seal++
				}
			}
		}
		expect(water).toBeGreaterThan(0)
		expect(leaks).toBe(0)
		expect(seal).toBe(0)
	})
})

describe('ore veins', () => {
	const gen = createWorldGenerator(SEED)
	const grid = generateRegion(gen, 0, 0, 3)

	it('places every ore type inside its depth band', () => {
		const counts = new Map<number, number>()
		const sums = new Map<number, number>()
		let outOfBand = 0
		let inShell = 0
		for (const chunk of grid.all()) {
			for (let y = 0; y < CHUNK_Y; y++) {
				for (let z = 0; z < CHUNK_Z; z++) {
					for (let x = 0; x < CHUNK_X; x++) {
						const id = chunk.blocks[blockIndex(x, y, z)]
						const ore = ORE_BY_BLOCK.get(id)
						if (ore === undefined) continue
						counts.set(id, (counts.get(id) ?? 0) + 1)
						sums.set(id, (sums.get(id) ?? 0) + y)
						if (y < ore.minY || y > ore.maxY) outOfBand++
						if (y < BEDROCK_LAYERS) inShell++
					}
				}
			}
		}
		for (const ore of ORES) expect(counts.get(ore.block) ?? 0).toBeGreaterThan(0)
		expect(outOfBand).toBe(0)
		expect(inShell).toBe(0)
		const mean = (block: number): number => (sums.get(block) ?? 0) / (counts.get(block) ?? 1)
		expect(mean(BLOCK.DIAMOND_ORE)).toBeLessThan(mean(BLOCK.IRON_ORE))
		expect(mean(BLOCK.IRON_ORE)).toBeLessThan(mean(BLOCK.COAL_ORE))
	})

	it('never replaces the surface of a column', () => {
		let surfaceOre = 0
		for (const chunk of grid.all()) {
			for (let z = 0; z < CHUNK_Z; z++) {
				for (let x = 0; x < CHUNK_X; x++) {
					const wx = chunk.cx * CHUNK_X + x
					const wz = chunk.cz * CHUNK_Z + z
					const surfaceY = gen.sampleColumn(wx, wz).surfaceY
					if (ORE_BY_BLOCK.has(chunk.blocks[blockIndex(x, surfaceY, z)])) surfaceOre++
				}
			}
		}
		expect(surfaceOre).toBe(0)
	})

	it('reproduces veins that cross a chunk border', () => {
		const target = grid.chunk(1, 1)
		expect(target).toBeDefined()
		if (target === undefined) return
		const blocks = new Uint16Array(CHUNK_VOLUME)
		const fluids = new Uint8Array(CHUNK_VOLUME)
		createWorldGenerator(SEED).generateChunk(1, 1, blocks, fluids)
		expect(hashBuffer(blocks)).toBe(hashBuffer(target.blocks))
		const reverse = generateRegion(createWorldGenerator(SEED), 0, 0, 3, 'reverse')
		const mirror = reverse.chunk(1, 1)
		expect(mirror).toBeDefined()
		if (mirror === undefined) return
		expect(hashBuffer(mirror.blocks)).toBe(hashBuffer(target.blocks))
	})
})

describe('decoration', () => {
	const size = 4
	const base = decorate(LAND.cx, LAND.cz, size)

	it('does not depend on the order chunks are decorated in', () => {
		for (const order of ['reverse', 'quadrants'] as const) {
			const other = decorate(LAND.cx, LAND.cz, size, order)
			for (const chunk of base.grid.all()) {
				const mirror = other.grid.chunk(chunk.cx, chunk.cz)
				expect(mirror).toBeDefined()
				if (mirror === undefined) continue
				expect(hashBuffer(mirror.blocks)).toBe(hashBuffer(chunk.blocks))
				expect(hashBuffer(mirror.fluids)).toBe(hashBuffer(chunk.fluids))
			}
		}
	})

	it('changes nothing when the same area is decorated twice', () => {
		const twice = decorate(LAND.cx, LAND.cz, size)
		for (const [cx, cz] of chunkCoords(LAND.cx, LAND.cz, size)) {
			twice.gen.decorate(cx, cz, twice.grid)
		}
		for (const chunk of base.grid.all()) {
			const mirror = twice.grid.chunk(chunk.cx, chunk.cz)
			expect(mirror).toBeDefined()
			if (mirror === undefined) continue
			expect(hashBuffer(mirror.blocks)).toBe(hashBuffer(chunk.blocks))
		}
	})

	it('decorates a lone chunk exactly as it does inside a loaded region', () => {
		const gen = createWorldGenerator(SEED)
		const blocks = new Uint16Array(CHUNK_VOLUME)
		const fluids = new Uint8Array(CHUNK_VOLUME)
		const cx = LAND.cx + 1
		const cz = LAND.cz + 1
		gen.generateChunk(cx, cz, blocks, fluids)
		const lone = new ChunkGrid()
		lone.add({ cx, cz, blocks, fluids })
		gen.decorate(cx, cz, lone)
		const inRegion = base.grid.chunk(cx, cz)
		expect(inRegion).toBeDefined()
		if (inRegion === undefined) return
		expect(hashBuffer(blocks)).toBe(hashBuffer(inRegion.blocks))
	})

	it('drops writes aimed at chunks that are not loaded', () => {
		const gen = createWorldGenerator(SEED)
		const blocks = new Uint16Array(CHUNK_VOLUME)
		const fluids = new Uint8Array(CHUNK_VOLUME)
		gen.generateChunk(0, 0, blocks, fluids)
		const grid = new ChunkGrid()
		grid.add({ cx: 0, cz: 0, blocks, fluids })
		const before = hashBuffer(blocks)
		expect(() => gen.decorate(1, 0, grid)).not.toThrow()
		expect(() => gen.decorate(0, 0, new ChunkGrid())).not.toThrow()
		expect(hashBuffer(blocks)).toBe(before)
	})

	it('grows trees with supported trunks and leafy canopies', () => {
		let logs = 0
		let leaves = 0
		let unsupported = 0
		let trunks = 0
		let stunted = 0
		let bald = 0
		for (const chunk of base.grid.all()) {
			for (let y = 1; y < CHUNK_Y; y++) {
				for (let z = 0; z < CHUNK_Z; z++) {
					for (let x = 0; x < CHUNK_X; x++) {
						const id = chunk.blocks[blockIndex(x, y, z)]
						if (isLeaf(id)) {
							leaves++
							continue
						}
						if (!isTrunk(id)) continue
						if (isLog(id)) logs++
						const below = chunk.blocks[blockIndex(x, y - 1, z)]
						if (below === BLOCK.AIR || below === BLOCK.WATER) unsupported++
					}
				}
			}
			// Trunk shape is only checked away from the border, where the whole
			// canopy of a tree belongs to this chunk.
			for (let z = 3; z < CHUNK_Z - 3; z++) {
				for (let x = 3; x < CHUNK_X - 3; x++) {
					const wx = chunk.cx * CHUNK_X + x
					const wz = chunk.cz * CHUNK_Z + z
					const surfaceY = base.gen.sampleColumn(wx, wz).surfaceY
					if (!isLog(chunk.blocks[blockIndex(x, surfaceY + 1, z)])) continue
					let height = 1
					while (
						surfaceY + 1 + height < CHUNK_Y &&
						isLog(chunk.blocks[blockIndex(x, surfaceY + 1 + height, z)])
					) {
						height++
					}
					trunks++
					if (height < VEGETATION.minTrunk) stunted++
					const topY = surfaceY + height
					let canopy = 0
					for (let dy = -2; dy <= 2; dy++) {
						const yy = topY + dy
						if (yy < 1 || yy >= CHUNK_Y) continue
						for (let dz = -2; dz <= 2; dz++) {
							for (let dx = -2; dx <= 2; dx++) {
								if (isLeaf(chunk.blocks[blockIndex(x + dx, yy, z + dz)])) canopy++
							}
						}
					}
					if (canopy <= height) bald++
				}
			}
		}
		expect(logs).toBeGreaterThan(0)
		expect(leaves).toBeGreaterThan(logs)
		expect(unsupported).toBe(0)
		expect(trunks).toBeGreaterThan(0)
		expect(stunted).toBe(0)
		expect(bald).toBe(0)
	})

	it('roots every plant on the surface of its column', () => {
		let plants = 0
		let floating = 0
		for (const chunk of base.grid.all()) {
			for (let z = 0; z < CHUNK_Z; z++) {
				for (let x = 0; x < CHUNK_X; x++) {
					const wx = chunk.cx * CHUNK_X + x
					const wz = chunk.cz * CHUNK_Z + z
					const surfaceY = base.gen.sampleColumn(wx, wz).surfaceY
					for (let y = 1; y < CHUNK_Y; y++) {
						const id = chunk.blocks[blockIndex(x, y, z)]
						if (!PLANT_BLOCKS.includes(id)) continue
						plants++
						if (id !== BLOCK.CACTUS && y !== surfaceY + 1) floating++
						const below = chunk.blocks[blockIndex(x, y - 1, z)]
						if (below === BLOCK.AIR || below === BLOCK.WATER) floating++
					}
				}
			}
		}
		expect(plants).toBeGreaterThan(0)
		expect(floating).toBe(0)
	})

	it('picks the tree species from the biome of the trunk', () => {
		let mismatches = 0
		for (const chunk of base.grid.all()) {
			for (let y = 1; y < CHUNK_Y; y++) {
				for (let z = 0; z < CHUNK_Z; z++) {
					for (let x = 0; x < CHUNK_X; x++) {
						const id = chunk.blocks[blockIndex(x, y, z)]
						if (!isTrunk(id)) continue
						const wx = chunk.cx * CHUNK_X + x
						const wz = chunk.cz * CHUNK_Z + z
						const biome = base.gen.sampleColumn(wx, wz).biome
						const conifer = biome === BIOME.Snowy || biome === BIOME.Mountains
						let ok: boolean
						if (id === BLOCK.CACTUS) ok = biome === BIOME.Desert
						else if (id === BLOCK.SPRUCE_LOG) ok = conifer
						else ok = !conifer && biome !== BIOME.Desert && biome !== BIOME.Ocean
						if (!ok) mismatches++
					}
				}
			}
		}
		expect(mismatches).toBe(0)
	})

	it('grows a species for every vegetated biome', () => {
		const gen = createWorldGenerator(SEED)
		const found = new Set<number>()
		for (const biome of [BIOME.Forest, BIOME.Desert, BIOME.Snowy]) {
			const at = findBiomeChunk(gen, biome)
			expect(at).toBeDefined()
			if (at === undefined) continue
			const region = decorate(at[0] - 2, at[1] - 2, 5)
			for (const chunk of region.grid.all()) {
				for (let i = 0; i < CHUNK_VOLUME; i++) {
					const id = chunk.blocks[i]
					if (isTrunk(id)) found.add(id)
				}
			}
		}
		expect(found.has(BLOCK.OAK_LOG)).toBe(true)
		expect(found.has(BLOCK.BIRCH_LOG)).toBe(true)
		expect(found.has(BLOCK.SPRUCE_LOG)).toBe(true)
		expect(found.has(BLOCK.CACTUS)).toBe(true)
	})
})

describe('feature performance', () => {
	it('generates and decorates a chunk around the per-chunk budget', () => {
		const gen = createWorldGenerator(SEED)
		const count = 24
		const warmBlocks = new Uint16Array(CHUNK_VOLUME)
		const warmFluids = new Uint8Array(CHUNK_VOLUME)
		for (let i = 0; i < 8; i++) gen.generateChunk(900 + i, 900, warmBlocks, warmFluids)

		const buffers: Array<{ blocks: Uint16Array; fluids: Uint8Array }> = []
		for (let i = 0; i < count; i++) {
			buffers.push({ blocks: new Uint16Array(CHUNK_VOLUME), fluids: new Uint8Array(CHUNK_VOLUME) })
		}
		const genStarted = performance.now()
		for (let i = 0; i < count; i++) {
			gen.generateChunk(i, 700, buffers[i].blocks, buffers[i].fluids)
		}
		const genAvg = (performance.now() - genStarted) / count

		const grid = new ChunkGrid()
		for (let i = 0; i < count; i++) {
			grid.add({ cx: i, cz: 700, blocks: buffers[i].blocks, fluids: buffers[i].fluids })
		}
		const decorateStarted = performance.now()
		for (let i = 0; i < count; i++) gen.decorate(i, 700, grid)
		const decorateAvg = (performance.now() - decorateStarted) / count

		console.log(
			`world-c chunkGen avg ${genAvg.toFixed(3)} ms, decorate avg ${decorateAvg.toFixed(3)} ms, ` +
				`budget ${PERF.chunkGenBudgetMs} ms`,
		)
		expect(genAvg).toBeLessThan(BENCH.chunkGenAvgMsMax * BENCH.failFactor)
		expect(decorateAvg).toBeLessThan(BENCH.chunkGenAvgMsMax * BENCH.failFactor)
	})
})
