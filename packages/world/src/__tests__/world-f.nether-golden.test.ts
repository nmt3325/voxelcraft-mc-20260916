/**
 * Golden fixture for the nether (v2).
 *
 * The overworld block of golden.json is pinned by world-a.terrain.test.ts and
 * regenerates through the overworld generator. The nether needs its own block
 * and its own regeneration, because a dimension unaware generator would
 * otherwise reproduce the overworld bytes for a nether chunk and pass.
 */
import {
	BLOCK,
	BLOCK_V2,
	CHUNK_AREA,
	CHUNK_VOLUME,
	DIMENSION,
	FLUID,
	NETHER_GEN,
	blockIndex,
	hashBuffer,
	packFluid,
} from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { createWorldGenerator } from '../index'
import golden from './golden.json'

/** `hashBuffer` of an all zero fluid buffer, which pins nothing at all. */
const EMPTY_FLUIDS_HASH = 1582341573

const LAVA_SOURCE = packFluid({ kind: FLUID.Lava, level: 0, falling: false })

function generate(seed: number, cx: number, cz: number) {
	const blocks = new Uint16Array(CHUNK_VOLUME)
	const fluids = new Uint8Array(CHUNK_VOLUME)
	createWorldGenerator(seed, DIMENSION.Nether).generateChunk(cx, cz, blocks, fluids)
	return { blocks, fluids }
}

describe('nether golden chunks', () => {
	it('reproduces the pinned nether fixture byte for byte', () => {
		expect(golden.netherGenVersion).toBe(NETHER_GEN.genVersion)
		expect(golden.netherEntries.length).toBeGreaterThan(0)
		const actual = golden.netherEntries.map((entry) => {
			const { blocks, fluids } = generate(entry.seed, entry.cx, entry.cz)
			return {
				seed: entry.seed,
				cx: entry.cx,
				cz: entry.cz,
				blocks: hashBuffer(blocks),
				fluids: hashBuffer(fluids),
			}
		})
		expect(actual).toEqual(golden.netherEntries)
	})

	it('pins bytes no overworld chunk produces', () => {
		// A generator that ignored the dimension argument would hand back the
		// overworld chunk here, so the two blocks of the fixture must not meet.
		const overworld = new Set(golden.entries.map((entry) => entry.blocks))
		for (const entry of golden.netherEntries) {
			expect(
				overworld.has(entry.blocks),
				`nether chunk ${entry.cx},${entry.cz} of seed ${entry.seed} pins overworld bytes`,
			).toBe(false)
		}
	})

	it('pins nether chunks that actually contain lava', () => {
		// The constant really is the hash of an empty fluid buffer.
		expect(hashBuffer(new Uint8Array(CHUNK_VOLUME))).toBe(EMPTY_FLUIDS_HASH)

		const wet = golden.netherEntries.filter((entry) => entry.fluids !== EMPTY_FLUIDS_HASH)
		expect(wet.length, 'nether golden entries with a lava sea').toBeGreaterThan(0)

		for (const entry of wet) {
			const where = `nether chunk ${entry.cx},${entry.cz} of seed ${entry.seed}`
			const { blocks, fluids } = generate(entry.seed, entry.cx, entry.cz)
			expect(hashBuffer(fluids), `fluids hash of ${where}`).toBe(entry.fluids)

			let lava = 0
			let netherrack = 0
			let water = 0
			for (let i = 0; i < CHUNK_VOLUME; i++) {
				if (fluids[i] === LAVA_SOURCE) lava++
				if (blocks[i] === BLOCK_V2.NETHERRACK) netherrack++
				if (blocks[i] === BLOCK.WATER) water++
			}
			expect(lava, `lava source voxels in ${where}`).toBeGreaterThan(0)
			expect(netherrack, `netherrack voxels in ${where}`).toBeGreaterThan(0)
			expect(water, `water voxels in ${where}`).toBe(0)
		}
	})

	it('caps every pinned chunk with a bedrock roof and floor', () => {
		for (const entry of golden.netherEntries) {
			const where = `nether chunk ${entry.cx},${entry.cz} of seed ${entry.seed}`
			const { blocks } = generate(entry.seed, entry.cx, entry.cz)
			let floor = 0
			let roof = 0
			for (let z = 0; z < 16; z++) {
				for (let x = 0; x < 16; x++) {
					if (blocks[blockIndex(x, 0, z)] === BLOCK.BEDROCK) floor++
					if (blocks[blockIndex(x, NETHER_GEN.roofY + 3, z)] === BLOCK.BEDROCK) roof++
				}
			}
			expect(floor, `bedrock floor voxels in ${where}`).toBe(CHUNK_AREA)
			expect(roof, `bedrock roof voxels in ${where}`).toBe(CHUNK_AREA)
		}
	})
})
