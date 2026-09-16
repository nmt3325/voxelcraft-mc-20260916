/**
 * Depth dependent ore veins. Owned by task world-c.
 *
 * Every chunk owns the veins seeded from makeRng(seed, SALT.ore, oreIndex, cx,
 * cz). generateChunk replays the veins of the whole 3x3 neighbourhood and clips
 * the writes to the chunk being generated, so a vein that straddles a border
 * appears identically in both chunks. A vein's walk never looks at the target
 * chunk, which is what keeps the result independent of generation order.
 *
 * A vein that cannot possibly reach the target chunk is skipped, but its random
 * draws are still consumed, so pruning is exactly output preserving: nextInt
 * takes one nextU32 per call, so veinSize raw draws replace veinSize steps.
 * The reach test is the Manhattan distance to the chunk, because a step moves
 * exactly one axis by one voxel, and the last write happens after veinSize - 1
 * steps.
 *
 * The starting Y of a vein comes from a triangular distribution peaking at
 * OreDef.peakY, so diamond stays deep while coal spreads up towards the
 * surface, and every write is clamped into [minY, maxY].
 *
 * H-06 (output is bit-identical): the placer runs 54 vein sets per chunk, so
 * the per-write work is what matters. The ore table is flattened into typed
 * columns and unpacked once per vein set, the depth band and the bedrock shell
 * collapse into one precomputed [writeLoY, writeHiY] range, and the write index
 * is computed inline. The order of the neighbourhood walk, of the ores, and of
 * every single random draw is unchanged, so the same voxels are written in the
 * same sequence.
 */
import { BEDROCK_LAYERS, BLOCK, CHUNK_X, CHUNK_Y, CHUNK_Z, makeRng } from '@voxelcraft/core-types'
import type { OrePlacer, TerrainContext } from '../internal'
import { ORES, SALT } from '../internal'

/* Same function and the same frozen values, resolved once. */
const rngOf = makeRng
const SALT_ORE = SALT.ore
const STONE = BLOCK.STONE

/** Six face offsets used by the vein walk, as x, y, z triples. */
const STEPS = new Int8Array([1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1])
/** Index of the reverse direction, so a vein never walks straight back. */
const OPPOSITE = new Int8Array([1, 0, 3, 2, 5, 4])

/**
 * The ore table as typed columns. Every OreDef field is an integer and the
 * values are copied straight out of ORES, so placement is unaffected; the vein
 * walk simply stops reading properties off a shared frozen object.
 */
const ORE_COUNT = ORES.length
const ORE_BLOCK = new Int32Array(ORE_COUNT)
const ORE_MIN_Y = new Int32Array(ORE_COUNT)
const ORE_MAX_Y = new Int32Array(ORE_COUNT)
const ORE_PEAK_Y = new Int32Array(ORE_COUNT)
const ORE_VEIN_SIZE = new Int32Array(ORE_COUNT)
const ORE_ATTEMPTS = new Int32Array(ORE_COUNT)
for (let i = 0; i < ORE_COUNT; i++) {
	const ore = ORES[i]
	ORE_BLOCK[i] = ore.block
	ORE_MIN_Y[i] = ore.minY
	ORE_MAX_Y[i] = ore.maxY
	ORE_PEAK_Y[i] = ore.peakY
	ORE_VEIN_SIZE[i] = ore.veinSize
	ORE_ATTEMPTS[i] = ore.attemptsPerChunk
}

function placeVeinsOf(
	seed: number,
	oreIndex: number,
	ncx: number,
	ncz: number,
	cx: number,
	cz: number,
	blocks: Uint16Array,
): void {
	const rng = rngOf(seed, SALT_ORE, oreIndex, ncx, ncz)
	const minX = cx * CHUNK_X
	const maxX = minX + CHUNK_X - 1
	const minZ = cz * CHUNK_Z
	const maxZ = minZ + CHUNK_Z - 1
	const block = ORE_BLOCK[oreIndex]
	const loY = ORE_MIN_Y[oreIndex]
	const hiY = ORE_MAX_Y[oreIndex]
	const peakY = ORE_PEAK_Y[oreIndex]
	const veinSize = ORE_VEIN_SIZE[oreIndex]
	const attempts = ORE_ATTEMPTS[oreIndex]
	// A vein writes before it steps, so the furthest write is veinSize - 1 away.
	const reach = veinSize - 1
	// The depth band and the bedrock shell are both fixed per ore, so the whole
	// "may this Y be written" test collapses into one range.
	const writeLoY = loY < BEDROCK_LAYERS ? BEDROCK_LAYERS : loY
	const writeHiY = hiY >= CHUNK_Y ? CHUNK_Y - 1 : hiY
	const baseX = ncx * CHUNK_X
	const baseZ = ncz * CHUNK_Z
	for (let attempt = 0; attempt < attempts; attempt++) {
		let vx = baseX + rng.nextInt(CHUNK_X)
		let vz = baseZ + rng.nextInt(CHUNK_Z)
		const t = (rng.next01() + rng.next01()) * 0.5
		// Triangular distribution over [minY, maxY] with its mode at peakY.
		let vy = Math.round(
			t < 0.5 ? loY + (peakY - loY) * (t * 2) : peakY + (hiY - peakY) * ((t - 0.5) * 2),
		)
		const awayX = vx < minX ? minX - vx : vx > maxX ? vx - maxX : 0
		const awayZ = vz < minZ ? minZ - vz : vz > maxZ ? vz - maxZ : 0
		if (awayX + awayZ > reach) {
			for (let n = 0; n < veinSize; n++) rng.nextU32()
			continue
		}
		let dir = -1
		for (let n = 0; n < veinSize; n++) {
			if (
				vx >= minX &&
				vx <= maxX &&
				vz >= minZ &&
				vz <= maxZ &&
				vy >= writeLoY &&
				vy <= writeHiY
			) {
				const i = (vy << 8) | ((vz & 15) << 4) | (vx & 15)
				// Ore only replaces plain stone, so surfaces, fluids, bedrock and the
				// air of an already carved cave all stay intact.
				if (blocks[i] === STONE) blocks[i] = block
			}
			let pick: number
			if (dir < 0) {
				pick = rng.nextInt(6)
			} else {
				// Five choices instead of six: dropping the reverse direction turns
				// the walk into a vein that extends instead of one that oscillates
				// between two voxels.
				const back = OPPOSITE[dir]
				pick = rng.nextInt(5)
				if (pick >= back) pick++
			}
			dir = pick
			const s = pick * 3
			vx += STEPS[s]
			vy += STEPS[s + 1]
			vz += STEPS[s + 2]
			if (vy < loY) vy = loY
			if (vy > hiY) vy = hiY
		}
	}
}

export function createOrePlacer(terrain: TerrainContext): OrePlacer {
	const seed = terrain.seed
	return {
		placeChunk(cx, cz, blocks, _heights): void {
			for (let dz = -1; dz <= 1; dz++) {
				for (let dx = -1; dx <= 1; dx++) {
					const ncx = cx + dx
					const ncz = cz + dz
					for (let oreIndex = 0; oreIndex < ORE_COUNT; oreIndex++) {
						placeVeinsOf(seed, oreIndex, ncx, ncz, cx, cz, blocks)
					}
				}
			}
		},
	}
}
