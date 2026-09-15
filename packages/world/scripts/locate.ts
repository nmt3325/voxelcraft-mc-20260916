/**
 * Locator for test fixtures: for each seed, prints the chunk that contains the
 * most columns of each biome, so tests can assert on concrete coordinates
 * instead of scanning the world at runtime. Run with:
 *   pnpm --filter @voxelcraft/world exec tsx scripts/locate.ts
 */
import { BLOCK, CHUNK_VOLUME, SEA_LEVEL, blockIndex } from '@voxelcraft/core-types'
import { createWorldGenerator } from '../src/index'

const BIOME_NAMES = ['Plains', 'Forest', 'Desert', 'Snowy', 'Mountains', 'Ocean']

interface Hit {
	cx: number
	cz: number
	count: number
}

for (const seed of [1337, 20260916]) {
	const gen = createWorldGenerator(seed)
	const best: Array<Hit | null> = new Array<Hit | null>(6).fill(null)

	for (let cz = -48; cz <= 48; cz += 3) {
		for (let cx = -48; cx <= 48; cx += 3) {
			const counts = new Array<number>(6).fill(0)
			for (let z = 0; z < 16; z += 2) {
				for (let x = 0; x < 16; x += 2) counts[gen.biomeAt(cx * 16 + x, cz * 16 + z)]++
			}
			for (let b = 0; b < 6; b++) {
				const cur = best[b]
				if (counts[b] > 0 && (cur === null || counts[b] > cur.count)) {
					best[b] = { cx, cz, count: counts[b] }
				}
			}
		}
	}

	console.log(`=== seed ${seed}`)
	for (let b = 0; b < 6; b++) {
		const hit = best[b]
		if (hit === null) {
			console.log(`  ${BIOME_NAMES[b].padEnd(10)} NOT FOUND`)
			continue
		}
		console.log(
			`  ${BIOME_NAMES[b].padEnd(10)} chunk=(${hit.cx},${hit.cz}) columns=${hit.count}/64`,
		)
	}

	// Verify the ocean surface rule on the best ocean chunk.
	const ocean = best[5]
	if (ocean !== null) {
		const blocks = new Uint16Array(CHUNK_VOLUME)
		const fluids = new Uint8Array(CHUNK_VOLUME)
		gen.generateChunk(ocean.cx, ocean.cz, blocks, fluids)
		let water = 0
		let ice = 0
		let air = 0
		let other = 0
		let airAbove = 0
		let fluidAt62 = 0
		for (let z = 0; z < 16; z++) {
			for (let x = 0; x < 16; x++) {
				const top = blocks[blockIndex(x, SEA_LEVEL, z)]
				if (top === BLOCK.WATER) water++
				else if (top === BLOCK.ICE) ice++
				else if (top === BLOCK.AIR) air++
				else other++
				if (blocks[blockIndex(x, SEA_LEVEL + 1, z)] === BLOCK.AIR) airAbove++
				if (fluids[blockIndex(x, SEA_LEVEL, z)] !== 0) fluidAt62++
			}
		}
		console.log(
			`  ocean chunk (${ocean.cx},${ocean.cz}) at y=${SEA_LEVEL}: water=${water} ice=${ice} air=${air} other=${other} airAt63=${airAbove} packedFluid=${fluidAt62}`,
		)
	}
}
