/**
 * Depth dependent ore veins. Owned by task world-c.
 *
 * Every chunk owns the veins seeded from makeRng(seed, SALT.ore, oreIndex, cx,
 * cz). generateChunk replays the veins of the whole 3x3 neighbourhood and
 * clips the writes to the chunk being generated, so a vein that straddles a
 * border appears identically in both chunks. A vein's random walk never looks
 * at the target chunk, which is what keeps the result order independent.
 *
 * The starting Y of a vein comes from a triangular distribution peaking at
 * OreDef.peakY, so diamond stays deep and coal spreads up to the surface.
 */
import {
	BLOCK,
	CHUNK_X,
	CHUNK_Z,
	blockIndex,
	makeRng,
	worldToChunk,
	worldToLocal,
} from '@voxelcraft/core-types'
import type { OreDef } from '@voxelcraft/core-types'
import type { OrePlacer, TerrainContext } from '../internal'
import { ORES, SALT } from '../internal'

/** Six face offsets used by the vein random walk. */
const STEPS: readonly number[] = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]

function writeOre(
	blocks: Uint16Array,
	cx: number,
	cz: number,
	wx: number,
	y: number,
	wz: number,
	block: number,
): void {
	if (y < 1 || y > 254) return
	if (worldToChunk(wx) !== cx || worldToChunk(wz) !== cz) return
	const i = blockIndex(worldToLocal(wx), y, worldToLocal(wz))
	// Ore only replaces plain stone, so surfaces, fluids and caves stay intact.
	if (blocks[i] !== BLOCK.STONE) return
	blocks[i] = block
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
	for (let attempt = 0; attempt < ore.attemptsPerChunk; attempt++) {
		let vx = ncx * CHUNK_X + rng.nextInt(CHUNK_X)
		let vz = ncz * CHUNK_Z + rng.nextInt(CHUNK_Z)
		const t = (rng.next01() + rng.next01()) * 0.5
		let vy = Math.round(veinStartY(ore, t))
		for (let n = 0; n < ore.veinSize; n++) {
			writeOre(blocks, cx, cz, vx, vy, vz, ore.block)
			const s = rng.nextInt(6) * 3
			vx += STEPS[s]
			vy += STEPS[s + 1]
			vz += STEPS[s + 2]
			if (vy < ore.minY) vy = ore.minY
			if (vy > ore.maxY) vy = ore.maxY
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
