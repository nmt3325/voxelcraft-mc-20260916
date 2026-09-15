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
 */
import {
	BEDROCK_LAYERS,
	BLOCK,
	CHUNK_X,
	CHUNK_Y,
	CHUNK_Z,
	blockIndex,
	makeRng,
	worldToChunk,
	worldToLocal,
} from '@voxelcraft/core-types'
import type { OreDef } from '@voxelcraft/core-types'
import type { OrePlacer, TerrainContext } from '../internal'
import { ORES, SALT } from '../internal'

/** Six face offsets used by the vein walk, as x, y, z triples. */
const STEPS: readonly number[] = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]
/** Index of the reverse direction, so a vein never walks straight back. */
const OPPOSITE: readonly number[] = [1, 0, 3, 2, 5, 4]

function writeOre(
	blocks: Uint16Array,
	cx: number,
	cz: number,
	wx: number,
	y: number,
	wz: number,
	ore: OreDef,
): void {
	// Hard depth band, and never inside the bedrock shell.
	if (y < ore.minY || y > ore.maxY) return
	if (y < BEDROCK_LAYERS || y >= CHUNK_Y) return
	if (worldToChunk(wx) !== cx || worldToChunk(wz) !== cz) return
	const i = blockIndex(worldToLocal(wx), y, worldToLocal(wz))
	// Ore only replaces plain stone, so surfaces, fluids, bedrock and the air of
	// an already carved cave all stay intact.
	if (blocks[i] !== BLOCK.STONE) return
	blocks[i] = ore.block
}

/** Triangular distribution over [minY, maxY] with its mode at peakY. */
function veinStartY(ore: OreDef, t: number): number {
	if (t < 0.5) return ore.minY + (ore.peakY - ore.minY) * (t * 2)
	return ore.peakY + (ore.maxY - ore.peakY) * ((t - 0.5) * 2)
}

function placeVeinsOf(
	seed: number,
	oreIndex: number,
	ore: OreDef,
	ncx: number,
	ncz: number,
	cx: number,
	cz: number,
	blocks: Uint16Array,
): void {
	const rng = makeRng(seed, SALT.ore, oreIndex, ncx, ncz)
	const minX = cx * CHUNK_X
	const maxX = minX + CHUNK_X - 1
	const minZ = cz * CHUNK_Z
	const maxZ = minZ + CHUNK_Z - 1
	// A vein writes before it steps, so the furthest write is veinSize - 1 away.
	const reach = ore.veinSize - 1
	const loY = ore.minY
	const hiY = ore.maxY
	for (let attempt = 0; attempt < ore.attemptsPerChunk; attempt++) {
		let vx = ncx * CHUNK_X + rng.nextInt(CHUNK_X)
		let vz = ncz * CHUNK_Z + rng.nextInt(CHUNK_Z)
		const t = (rng.next01() + rng.next01()) * 0.5
		let vy = Math.round(veinStartY(ore, t))
		const awayX = vx < minX ? minX - vx : vx > maxX ? vx - maxX : 0
		const awayZ = vz < minZ ? minZ - vz : vz > maxZ ? vz - maxZ : 0
		if (awayX + awayZ > reach) {
			for (let n = 0; n < ore.veinSize; n++) rng.nextU32()
			continue
		}
		let dir = -1
		for (let n = 0; n < ore.veinSize; n++) {
			writeOre(blocks, cx, cz, vx, vy, vz, ore)
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
					for (let oreIndex = 0; oreIndex < ORES.length; oreIndex++) {
						placeVeinsOf(seed, oreIndex, ORES[oreIndex], cx + dx, cz + dz, cx, cz, blocks)
					}
				}
			}
		},
	}
}
