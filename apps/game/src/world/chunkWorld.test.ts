/**
 * Generation-side contract of the app's world: real chunks from
 * `@voxelcraft/world`, deterministic per seed, with edits that produce save
 * payloads and the mesh requests the client worker pool consumes.
 */
import { describe, expect, it } from 'vitest'
import {
	BEDROCK_LAYERS,
	BLOCK,
	CHUNK_Y,
	PADDED_VOLUME,
	SEA_LEVEL,
	SECTIONS_PER_CHUNK,
	SECTION_Y,
	hashBuffer,
	sectionKey,
	type BlockId,
} from '@voxelcraft/core-types'
import { ChunkWorld } from './chunkWorld'

const SEED = 20260916
/** Real generation is far heavier than the old fixture, so allow for it. */
const SLOW = 30_000

/** Spawn chunk: terrain for the 3x3 neighbourhood, decoration and skylight. */
function spawnChunk(seed = SEED): ChunkWorld {
	const world = new ChunkWorld({ seed })
	world.ensureDecorated(0, 0)
	return world
}

/** A fully decorated 3x3 region for the assertions that scan many columns. */
function region(seed = SEED): ChunkWorld {
	const world = new ChunkWorld({ seed })
	for (let cx = -1; cx <= 1; cx++) {
		for (let cz = -1; cz <= 1; cz++) world.generateTerrain(cx, cz)
	}
	for (let cx = -1; cx <= 1; cx++) {
		for (let cz = -1; cz <= 1; cz++) world.decorate(cx, cz)
	}
	world.stitchLight()
	return world
}

function surfaceY(world: ChunkWorld, x: number, z: number): number {
	for (let y = CHUNK_Y - 1; y >= 0; y--) {
		if (world.blockAt(x, y, z) !== BLOCK.AIR) return y
	}
	return -1
}

const ORES: readonly BlockId[] = [
	BLOCK.COAL_ORE,
	BLOCK.IRON_ORE,
	BLOCK.GOLD_ORE,
	BLOCK.DIAMOND_ORE,
	BLOCK.REDSTONE_ORE,
	BLOCK.LAPIS_ORE,
]

const FEATURES: readonly BlockId[] = [
	BLOCK.OAK_LOG,
	BLOCK.OAK_LEAVES,
	BLOCK.OAK_SAPLING,
	BLOCK.TALL_GRASS,
	BLOCK.DEAD_BUSH,
	BLOCK.FLOWER_RED,
	BLOCK.FLOWER_YELLOW,
]

describe('ChunkWorld generation', () => {
	it(
		'generates real terrain instead of a flat fixture',
		() => {
			const world = spawnChunk()
			expect(world.loadedChunks).toBeGreaterThanOrEqual(9)
			expect(world.hasTerrain(0, 0)).toBe(true)
			expect(world.isDecorated(0, 0)).toBe(true)
			expect(world.generator.seed).toBe(SEED)
			expect(world.generator.version).toBeGreaterThan(0)
			expect(world.blockAt(0, 0, 0)).toBe(BLOCK.BEDROCK)
			expect(world.blockAt(0, CHUNK_Y - 1, 0)).toBe(BLOCK.AIR)
			expect(surfaceY(world, 0, 0)).toBeGreaterThan(BEDROCK_LAYERS)
			let stone = 0
			for (let y = BEDROCK_LAYERS; y < SEA_LEVEL; y++) {
				if (world.blockAt(0, y, 0) === BLOCK.STONE) stone++
			}
			expect(stone).toBeGreaterThan(0)
			expect(world.biomeNameAt(0, 0).length).toBeGreaterThan(0)
		},
		SLOW,
	)

	it(
		'places biomes, caves, ores and surface features',
		() => {
			const world = region()
			const seen = new Set<number>()
			const biomes = new Set<string>()
			let ores = 0
			let features = 0
			let caveAir = 0
			for (let x = -16; x < 32; x++) {
				for (let z = -16; z < 32; z++) {
					const top = world.column(x, z).surfaceY
					biomes.add(world.biomeNameAt(x, z))
					for (let y = 1; y <= Math.min(top + 6, CHUNK_Y - 1); y++) {
						const id = world.blockAt(x, y, z)
						seen.add(id)
						if (ORES.includes(id)) ores++
						else if (FEATURES.includes(id)) features++
						else if (id === BLOCK.AIR && y < top - 3) caveAir++
					}
				}
			}
			expect(seen.size).toBeGreaterThanOrEqual(6)
			expect(biomes.size).toBeGreaterThanOrEqual(1)
			expect(ores).toBeGreaterThan(0)
			expect(features).toBeGreaterThan(0)
			expect(caveAir).toBeGreaterThan(0)
		},
		SLOW,
	)

	it(
		'is deterministic for a seed and different across seeds',
		() => {
			const a = spawnChunk(SEED).chunkBytes(0, 0)
			const b = spawnChunk(SEED).chunkBytes(0, 0)
			const other = spawnChunk(SEED + 1).chunkBytes(0, 0)
			expect(a).not.toBeNull()
			expect(hashBuffer(b as Uint8Array)).toBe(hashBuffer(a as Uint8Array))
			expect(hashBuffer(other as Uint8Array)).not.toBe(hashBuffer(a as Uint8Array))
		},
		SLOW,
	)

	it(
		'finds a spawn on solid ground with head room',
		() => {
			const world = spawnChunk()
			const spawn = world.findSpawn(0, 0)
			const x = Math.floor(spawn.x)
			const z = Math.floor(spawn.z)
			const feet = Math.floor(spawn.y)
			expect(feet).toBeGreaterThan(SEA_LEVEL)
			expect(world.blockAt(x, feet - 1, z)).not.toBe(BLOCK.AIR)
			expect(world.blockAt(x, feet, z)).toBe(BLOCK.AIR)
			expect(world.blockAt(x, feet + 1, z)).toBe(BLOCK.AIR)
			expect(spawnChunk().findSpawn(0, 0)).toEqual(spawn)
		},
		SLOW,
	)
})

describe('ChunkWorld edits', () => {
	it(
		'bumps section revisions on pump and yields save payloads',
		() => {
			const world = spawnChunk()
			world.pumpDirty()
			const pristine = world.stateHash()
			expect(world.modifiedChunks()).toEqual([])
			const top = surfaceY(world, 1, 1)
			const sy = Math.floor(top / SECTION_Y)
			const revision = world.revisionOf(0, 0, sy)

			expect(world.setBlock(1, top, 1, BLOCK.AIR)).toBe(true)
			expect(world.blockAt(1, top, 1)).toBe(BLOCK.AIR)
			world.pumpDirty()
			expect(world.revisionOf(0, 0, sy)).toBeGreaterThan(revision)
			expect(world.stateHash()).not.toBe(pristine)
			expect(world.isModified(0, 0)).toBe(true)
			expect(world.modifiedChunks()).toContainEqual({ cx: 0, cz: 0 })
			const payloads = world.savePayloads()
			expect(payloads.map((payload) => `${payload.cx},${payload.cz}`)).toEqual(['0,0'])
			expect(payloads[0].data.byteLength).toBeGreaterThan(0)

			expect(world.setBlock(1, top + 1, 1, BLOCK.GLASS)).toBe(true)
			expect(world.blockAt(1, top + 1, 1)).toBe(BLOCK.GLASS)
			expect(world.setBlock(1, top + 1, 1, BLOCK.GLASS)).toBe(false)
		},
		SLOW,
	)

	it(
		'builds padded mesh requests and skips empty sections',
		() => {
			const world = spawnChunk()
			const sy = Math.floor(surfaceY(world, 1, 1) / SECTION_Y)
			const request = world.buildMeshRequest(0, 0, sy)
			expect(request.key).toBe(sectionKey(0, 0, sy))
			expect(request.cx).toBe(0)
			expect(request.cz).toBe(0)
			expect(request.sy).toBe(sy)
			expect(request.revision).toBe(world.revisionOf(0, 0, sy))
			expect(request.blocks.length).toBe(PADDED_VOLUME)
			expect(request.light.length).toBe(PADDED_VOLUME)
			expect(request.fluids.length).toBe(PADDED_VOLUME)
			expect(world.isSectionEmpty(0, 0, sy)).toBe(false)
			expect(world.isSectionEmpty(0, 0, SECTIONS_PER_CHUNK - 1)).toBe(true)
		},
		SLOW,
	)
})
