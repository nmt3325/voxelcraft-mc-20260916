/**
 * Nether decoration: quartz veins, glowstone clusters, soul sand and magma
 * patches. Owned by task v2-world-nether-deco.
 *
 * dimension.ts now runs the seam for real: placeChunk inside generateChunk and
 * decorate from the generator. These tests still drive the pass by hand on top
 * of the bare terrain fill, so they can compare a chunk before and after the
 * pass, and one case asserts that the hand run matches the wired pipeline
 * voxel for voxel.
 *
 * The invariant tests collect every rule that broke into one expect, so a
 * failure names all of them instead of stopping at the first voxel.
 */
import { describe, expect, it } from 'vitest'
import {
	BLOCK,
	BLOCK_V2,
	CHUNK_VOLUME,
	CHUNK_X,
	CHUNK_Y,
	CHUNK_Z,
	DIMENSION,
	NETHER_GEN,
	blockIndex,
} from '@voxelcraft/core-types'
import {
	NETHER_ROOF_TOP,
	createNetherTerrain,
	createNoiseBasis,
	createWorldGenerator,
} from '../index'
import { createNetherDecoration } from '../nether/decoration'
import { ChunkGrid } from '../testing/chunk-grid'

const SEEDS = [1337, 20260916]
const SEA = NETHER_GEN.lavaSeaLevel
const SHELL_HI = NETHER_GEN.roofY - 1
/** Everything the pass is allowed to add. */
const PLACED: number[] = [BLOCK_V2.QUARTZ_ORE, BLOCK_V2.SOUL_SAND, BLOCK_V2.MAGMA_BLOCK]
const PATCHES: number[] = [BLOCK_V2.SOUL_SAND, BLOCK_V2.MAGMA_BLOCK]
/** Solid nether ground a patch may rest on. */
const GROUND: number[] = [
	BLOCK_V2.NETHERRACK,
	BLOCK_V2.QUARTZ_ORE,
	BLOCK_V2.SOUL_SAND,
	BLOCK_V2.MAGMA_BLOCK,
]
/** Height band that counts as the shore of the lava sea. */
const NEAR_SEA = 8

const CHUNKS: Array<[number, number]> = [
	[0, 0],
	[3, -7],
	[-5, 11],
]
/** (-9, -9) is a chunk whose caverns a handful of random probes can miss. */
const CLUSTER_CHUNKS: Array<[number, number]> = [
	[0, 0],
	[3, -7],
	[-5, 11],
	[2, 5],
	[7, -2],
	[-9, -9],
]
/** Enough columns that a per column chance is measurable: 8 chunks, 2048. */
const COLUMN_CHUNKS: Array<[number, number]> = [
	[0, 0],
	[1, 0],
	[3, -7],
	[-5, 11],
	[8, 8],
	[-2, -9],
	[12, 3],
	[-11, -4],
]
const NEIGHBOURS: Array<[number, number, number]> = [
	[1, 0, 0],
	[-1, 0, 0],
	[0, 1, 0],
	[0, -1, 0],
	[0, 0, 1],
	[0, 0, -1],
]

function decoration(seed: number) {
	const noise = createNoiseBasis(seed)
	return createNetherDecoration(seed, noise, createNetherTerrain(seed, noise))
}

/** A generated nether chunk, plus the terrain it held before decoration. */
function decorated(seed: number, cx: number, cz: number) {
	const blocks = new Uint16Array(CHUNK_VOLUME)
	const fluids = new Uint8Array(CHUNK_VOLUME)
	// The shell on its own: the generator decorates inside generateChunk now,
	// so the bare fill is the only way to still see a chunk before the pass.
	createNetherTerrain(seed, createNoiseBasis(seed)).fillChunk(cx, cz, blocks, fluids)
	const terrainOnly = blocks.slice()
	decoration(seed).placeChunk(cx, cz, blocks, fluids)
	return { blocks, fluids, terrainOnly }
}

/** A 3x3 region of decorated chunks with decorate run on the middle one. */
function region(seed: number, cx: number, cz: number) {
	const grid = new ChunkGrid()
	const before = new Map<string, Uint16Array>()
	for (let dz = -1; dz <= 1; dz++) {
		for (let dx = -1; dx <= 1; dx++) {
			const { blocks, fluids } = decorated(seed, cx + dx, cz + dz)
			grid.add({ cx: cx + dx, cz: cz + dz, blocks, fluids })
			before.set(`${cx + dx},${cz + dz}`, blocks.slice())
		}
	}
	decoration(seed).decorate(cx, cz, grid)
	return { grid, before }
}

/** World coordinates of every glowstone voxel of a region. */
function glowstone(grid: ChunkGrid, cx: number, cz: number): Array<[number, number, number]> {
	const found: Array<[number, number, number]> = []
	for (let dz = -1; dz <= 1; dz++) {
		for (let dx = -1; dx <= 1; dx++) {
			const chunk = grid.chunk(cx + dx, cz + dz)
			if (chunk === undefined) continue
			for (let y = SEA; y <= SHELL_HI; y++) {
				for (let z = 0; z < CHUNK_Z; z++) {
					for (let x = 0; x < CHUNK_X; x++) {
						if (chunk.blocks[blockIndex(x, y, z)] !== BLOCK.GLOWSTONE) continue
						found.push([(cx + dx) * CHUNK_X + x, y, (cz + dz) * CHUNK_Z + z])
					}
				}
			}
		}
	}
	return found
}

/** Number of 6-connected components of a voxel set: one per cluster. */
function clusterCount(voxels: Array<[number, number, number]>): number {
	const open = new Set(voxels.map(([x, y, z]) => `${x},${y},${z}`))
	let count = 0
	for (const start of [...open]) {
		if (!open.delete(start)) continue
		count++
		const stack = [start]
		while (stack.length > 0) {
			const [x, y, z] = (stack.pop() as string).split(',').map(Number)
			for (const [dx, dy, dz] of NEIGHBOURS) {
				const key = `${x + dx},${y + dy},${z + dz}`
				if (open.delete(key)) stack.push(key)
			}
		}
	}
	return count
}

/** Does this column hold the block anywhere inside the shell? */
function columnHas(blocks: Uint16Array, x: number, z: number, id: number): boolean {
	for (let y = NETHER_GEN.floorY; y <= SHELL_HI; y++) {
		if (blocks[blockIndex(x, y, z)] === id) return true
	}
	return false
}

function isOpen(id: number): boolean {
	return id === BLOCK.AIR || id === BLOCK.LAVA
}

/** The cavern floor of a column above the lava sea, the way the pass finds it. */
function floorAbove(blocks: Uint16Array, x: number, z: number): number {
	for (let y = SEA + 1; y <= SHELL_HI - 2; y++) {
		if (isOpen(blocks[blockIndex(x, y, z)])) continue
		if (isOpen(blocks[blockIndex(x, y + 1, z)]) && isOpen(blocks[blockIndex(x, y + 2, z)])) {
			return y
		}
	}
	return -1
}

describe('nether decoration determinism', () => {
	it.each(SEEDS)('decorates a chunk identically twice for seed %i', (seed) => {
		expect(decorated(seed, 3, -7).blocks).toEqual(decorated(seed, 3, -7).blocks)
	})

	it.each(SEEDS)('hangs the same clusters twice for seed %i', (seed) => {
		expect(glowstone(region(seed, 2, 5).grid, 2, 5)).toEqual(
			glowstone(region(seed, 2, 5).grid, 2, 5),
		)
	})

	it.each(SEEDS)('changes nothing on a second pass for seed %i', (seed) => {
		const { blocks, fluids } = decorated(seed, -5, 11)
		const again = blocks.slice()
		decoration(seed).placeChunk(-5, 11, again, fluids)
		expect(again).toEqual(blocks)
	})

	it.each(SEEDS)('actually decorates the chunk for seed %i', (seed) => {
		const { blocks, terrainOnly } = decorated(seed, 3, -7)
		expect(blocks).not.toEqual(terrainOnly)
	})

	it.each(SEEDS)('matches the wired generator pipeline for seed %i', (seed) => {
		const { blocks } = decorated(seed, 3, -7)
		const wired = new Uint16Array(CHUNK_VOLUME)
		const wiredFluids = new Uint8Array(CHUNK_VOLUME)
		createWorldGenerator(seed, DIMENSION.Nether).generateChunk(3, -7, wired, wiredFluids)
		let first = -1
		for (let i = 0; i < wired.length; i++) {
			if (wired[i] !== blocks[i]) {
				first = i
				break
			}
		}
		expect(first).toBe(-1)
	})

	it('decorates the two seeds differently', () => {
		expect(decorated(SEEDS[1], 3, -7).blocks).not.toEqual(decorated(SEEDS[0], 3, -7).blocks)
	})
})

describe('glowstone clusters', () => {
	it.each(SEEDS)('hangs the frozen number of clusters per chunk for seed %i', (seed) => {
		const counted = CLUSTER_CHUNKS.map(([cx, cz]) =>
			clusterCount(glowstone(region(seed, cx, cz).grid, cx, cz)),
		)
		expect(counted).toEqual(CLUSTER_CHUNKS.map(() => NETHER_GEN.glowstoneClustersPerChunk))
	})

	it.each(SEEDS)('only ever turns open air into glowstone for seed %i', (seed) => {
		const { grid, before } = region(seed, 2, 5)
		const wrong = new Set<string>()
		for (const [key, snapshot] of before) {
			const [cx, cz] = key.split(',').map(Number)
			const chunk = grid.chunk(cx, cz)
			if (chunk === undefined) continue
			for (let i = 0; i < snapshot.length; i++) {
				if (chunk.blocks[i] === snapshot[i]) continue
				if (snapshot[i] !== BLOCK.AIR) wrong.add(`replaced ${snapshot[i]}`)
				if (chunk.blocks[i] !== BLOCK.GLOWSTONE) wrong.add(`wrote ${chunk.blocks[i]}`)
			}
		}
		expect([...wrong]).toEqual([])
	})

	it.each(SEEDS)('hangs every cluster from rock for seed %i', (seed) => {
		const { grid } = region(seed, 2, 5)
		const wrong = new Set<string>()
		const voxels = glowstone(grid, 2, 5)
		for (const [x, y, z] of voxels) {
			if (y <= SEA || y > SHELL_HI) wrong.add(`glowstone at y ${y}`)
			if (grid.getBlock(x, y + 1, z) === BLOCK.AIR) wrong.add('floating glowstone')
		}
		expect(voxels.length).toBeGreaterThan(0)
		expect([...wrong]).toEqual([])
	})
})

describe('quartz veins', () => {
	it.each(SEEDS)('fill the frozen share of the columns for seed %i', (seed) => {
		let columns = 0
		let withQuartz = 0
		for (const [cx, cz] of COLUMN_CHUNKS) {
			const { blocks } = decorated(seed, cx, cz)
			for (let z = 0; z < CHUNK_Z; z++) {
				for (let x = 0; x < CHUNK_X; x++) {
					columns++
					if (columnHas(blocks, x, z, BLOCK_V2.QUARTZ_ORE)) withQuartz++
				}
			}
		}
		expect(columns).toBe(COLUMN_CHUNKS.length * CHUNK_X * CHUNK_Z)
		const rate = withQuartz / columns
		expect(rate).toBeGreaterThan(NETHER_GEN.quartzOreChancePerColumn - 0.03)
		expect(rate).toBeLessThan(NETHER_GEN.quartzOreChancePerColumn + 0.03)
	})
})

describe('soul sand and magma patches', () => {
	it.each(SEEDS)('sit on solid ground above the lava sea for seed %i', (seed) => {
		const wrong = new Set<string>()
		let patches = 0
		for (const [cx, cz] of CHUNKS) {
			const { blocks } = decorated(seed, cx, cz)
			for (let y = NETHER_GEN.floorY; y <= SHELL_HI; y++) {
				for (let z = 0; z < CHUNK_Z; z++) {
					for (let x = 0; x < CHUNK_X; x++) {
						if (!PATCHES.includes(blocks[blockIndex(x, y, z)])) continue
						patches++
						if (y <= SEA) wrong.add(`patch at y ${y}`)
						if (!GROUND.includes(blocks[blockIndex(x, y - 1, z)])) {
							wrong.add('patch with nothing under it')
						}
						if (blocks[blockIndex(x, y + 1, z)] !== BLOCK.AIR) {
							wrong.add('patch that is not a floor')
						}
					}
				}
			}
		}
		expect(patches).toBeGreaterThan(0)
		expect([...wrong]).toEqual([])
	})

	/**
	 * The frozen chances are per floor chances, so they are measured on the
	 * floors the pass could actually use: a floor standing on open space, or one
	 * a vein reached first, was refused on purpose and says nothing about them.
	 * Magma rolls before soul sand, which is why soul sand covers the frozen
	 * share of the floors magma left rather than the frozen share of all floors.
	 * The shore band is where the magma chance is exactly the frozen number,
	 * since it tapers with height above the lava sea.
	 */
	it.each(SEEDS)('cover the frozen share of the shore floors for seed %i', (seed) => {
		let floors = 0
		let magma = 0
		let soul = 0
		for (const [cx, cz] of COLUMN_CHUNKS) {
			const { blocks } = decorated(seed, cx, cz)
			for (let z = 0; z < CHUNK_Z; z++) {
				for (let x = 0; x < CHUNK_X; x++) {
					const y = floorAbove(blocks, x, z)
					if (y < 0 || y - SEA > NEAR_SEA) continue
					if (!GROUND.includes(blocks[blockIndex(x, y - 1, z)])) continue
					const id = blocks[blockIndex(x, y, z)]
					if (id === BLOCK_V2.QUARTZ_ORE) continue
					floors++
					if (id === BLOCK_V2.MAGMA_BLOCK) magma++
					if (id === BLOCK_V2.SOUL_SAND) soul++
				}
			}
		}
		expect(floors).toBeGreaterThan(200)
		const magmaRate = magma / floors
		expect(magmaRate).toBeGreaterThan(NETHER_GEN.magmaPatchChance - 0.05)
		expect(magmaRate).toBeLessThan(NETHER_GEN.magmaPatchChance + 0.05)
		const soulExpected = NETHER_GEN.soulSandPatchChance * (1 - NETHER_GEN.magmaPatchChance)
		const soulRate = soul / floors
		expect(soulRate).toBeGreaterThan(soulExpected - 0.06)
		expect(soulRate).toBeLessThan(soulExpected + 0.06)
	})
})

describe('shell invariants after decoration', () => {
	it.each(SEEDS)('still hold for seed %i', (seed) => {
		const broken = new Set<string>()
		for (const [cx, cz] of CHUNKS) {
			const { blocks } = decorated(seed, cx, cz)
			for (let y = 0; y < CHUNK_Y; y++) {
				for (let z = 0; z < CHUNK_Z; z++) {
					for (let x = 0; x < CHUNK_X; x++) {
						const id = blocks[blockIndex(x, y, z)]
						if (y <= SEA && id === BLOCK.AIR) broken.add('air at or below the lava sea')
						if (y > SEA && id === BLOCK.LAVA) broken.add('lava above the lava sea')
						if (y > NETHER_ROOF_TOP && id !== BLOCK.AIR) broken.add('block above the roof')
						if (y === 0 && id !== BLOCK.BEDROCK) broken.add('floor is not bedrock')
						if (y === NETHER_ROOF_TOP && id !== BLOCK.BEDROCK) {
							broken.add('roof top is not bedrock')
						}
						if (y >= NETHER_GEN.floorY && y < NETHER_GEN.roofY && id === BLOCK.BEDROCK) {
							broken.add('bedrock inside the shell')
						}
					}
				}
			}
		}
		expect([...broken]).toEqual([])
	})

	it.each(SEEDS)('only ever replace netherrack for seed %i', (seed) => {
		const wrong = new Set<string>()
		for (const [cx, cz] of CHUNKS) {
			const { blocks, terrainOnly } = decorated(seed, cx, cz)
			for (let i = 0; i < blocks.length; i++) {
				if (blocks[i] === terrainOnly[i]) continue
				if (terrainOnly[i] !== BLOCK_V2.NETHERRACK) wrong.add(`replaced ${terrainOnly[i]}`)
				if (!PLACED.includes(blocks[i])) wrong.add(`wrote ${blocks[i]}`)
			}
		}
		expect([...wrong]).toEqual([])
	})
})
