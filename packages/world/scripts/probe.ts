/**
 * Tuning probe. Not part of the test suite: it prints the distributions that
 * the constants in src/internal.ts were chosen from. Run with:
 *   pnpm --filter @voxelcraft/world exec tsx scripts/probe.ts
 */
import { BIOME, BLOCK, CHUNK_VOLUME, SEA_LEVEL, blockIndex, indexY } from '@voxelcraft/core-types'
import { createWorldGenerator, generateRegion } from '../src/index'

const SEED = 1337
const gen = createWorldGenerator(SEED)
const BIOME_NAMES = ['Plains', 'Forest', 'Desert', 'Snowy', 'Mountains', 'Ocean']
const ORE_IDS: readonly number[] = [
	BLOCK.COAL_ORE,
	BLOCK.IRON_ORE,
	BLOCK.GOLD_ORE,
	BLOCK.DIAMOND_ORE,
	BLOCK.REDSTONE_ORE,
	BLOCK.LAPIS_ORE,
]
const ORE_NAMES = ['COAL', 'IRON', 'GOLD', 'DIAMOND', 'REDSTONE', 'LAPIS']
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

function pct(part: number, total: number): string {
	return `${((part / total) * 100).toFixed(2)}%`
}

function biomeHistogram(): void {
	const counts = new Array<number>(6).fill(0)
	let below = 0
	let min = 9999
	let max = -9999
	let sum = 0
	let n = 0
	for (let wx = -2400; wx <= 2400; wx += 48) {
		for (let wz = -2400; wz <= 2400; wz += 48) {
			const s = gen.sampleColumn(wx, wz)
			counts[s.biome]++
			if (s.surfaceY < SEA_LEVEL) below++
			if (s.surfaceY < min) min = s.surfaceY
			if (s.surfaceY > max) max = s.surfaceY
			sum += s.surfaceY
			n++
		}
	}
	console.log(`--- biomes over ${n} samples`)
	for (let i = 0; i < 6; i++) {
		console.log(`  ${BIOME_NAMES[i].padEnd(10)} ${String(counts[i]).padStart(6)}  ${pct(counts[i], n)}`)
	}
	console.log(`  height min=${min} max=${max} mean=${(sum / n).toFixed(1)} belowSea=${pct(below, n)}`)
}

/** Stats over a region, including an ocean region so the water rules are seen. */
function chunkStats(cx0: number, cz0: number, size: number, label: string): void {
	const grid = generateRegion(gen, cx0, cz0, size)
	const oreCount = new Array<number>(ORE_IDS.length).fill(0)
	const oreSumY = new Array<number>(ORE_IDS.length).fill(0)
	const oreMinY = new Array<number>(ORE_IDS.length).fill(9999)
	const oreMaxY = new Array<number>(ORE_IDS.length).fill(-9999)
	const biomeCols = new Array<number>(6).fill(0)
	let air = 0
	let airDeep = 0
	let deep = 0
	let total = 0
	let surfaceAir = 0
	let surfaceCols = 0
	let waterTop = 0
	let iceTop = 0
	let airAbove = 0
	let oceanCols = 0

	for (const c of grid.all()) {
		for (let i = 0; i < CHUNK_VOLUME; i++) {
			const b = c.blocks[i]
			const y = indexY(i)
			total++
			if (y < 64) deep++
			if (b === BLOCK.AIR) {
				air++
				if (y < 64) airDeep++
				continue
			}
			const oi = ORE_IDS.indexOf(b)
			if (oi >= 0) {
				oreCount[oi]++
				oreSumY[oi] += y
				if (y < oreMinY[oi]) oreMinY[oi] = y
				if (y > oreMaxY[oi]) oreMaxY[oi] = y
			}
		}
		for (let z = 0; z < 16; z++) {
			for (let x = 0; x < 16; x++) {
				const sample = gen.sampleColumn(c.cx * 16 + x, c.cz * 16 + z)
				surfaceCols++
				biomeCols[sample.biome]++
				if (c.blocks[blockIndex(x, sample.surfaceY, z)] === BLOCK.AIR) surfaceAir++
				if (sample.biome === BIOME.Ocean) {
					oceanCols++
					const top = c.blocks[blockIndex(x, SEA_LEVEL, z)]
					if (top === BLOCK.WATER) waterTop++
					else if (top === BLOCK.ICE) iceTop++
					if (c.blocks[blockIndex(x, SEA_LEVEL + 1, z)] === BLOCK.AIR) airAbove++
				}
			}
		}
	}

	console.log(`--- ${label}: ${size * size} chunks at (${cx0},${cz0})`)
	console.log(`  air=${pct(air, total)}  airBelowY64=${pct(airDeep, deep)}`)
	console.log(`  surface columns carved open: ${surfaceAir}/${surfaceCols}`)
	console.log(
		`  ocean columns=${oceanCols} waterAt62=${waterTop} iceAt62=${iceTop} airAt63=${airAbove}`,
	)
	console.log(`  column biomes: ${biomeCols.map((v, i) => `${BIOME_NAMES[i]}=${v}`).join(' ')}`)
	for (let i = 0; i < ORE_IDS.length; i++) {
		const c = oreCount[i]
		const mean = c > 0 ? (oreSumY[i] / c).toFixed(1) : 'n/a'
		console.log(
			`  ${ORE_NAMES[i].padEnd(9)} n=${String(c).padStart(5)} meanY=${mean} range=[${c > 0 ? oreMinY[i] : '-'},${c > 0 ? oreMaxY[i] : '-'}]`,
		)
	}
}

function decorateStats(cx0: number, cz0: number, size: number): void {
	const grid = generateRegion(gen, cx0, cz0, size)
	for (const c of grid.all()) gen.decorate(c.cx, c.cz, grid)
	let logs = 0
	let leaves = 0
	let plants = 0
	let chunksWithTrees = 0
	// Only the interior is fully decorated, since the border chunks are missing
	// neighbours that would have reached into them.
	for (const c of grid.all()) {
		if (c.cx === cx0 || c.cz === cz0 || c.cx === cx0 + size - 1 || c.cz === cz0 + size - 1) continue
		let chunkLogs = 0
		for (let i = 0; i < CHUNK_VOLUME; i++) {
			const b = c.blocks[i]
			if (LOGS.indexOf(b) >= 0) chunkLogs++
			else if (LEAVES.indexOf(b) >= 0) leaves++
			else if (PLANTS.indexOf(b) >= 0) plants++
		}
		logs += chunkLogs
		if (chunkLogs > 0) chunksWithTrees++
	}
	const interior = (size - 2) * (size - 2)
	console.log(
		`--- decorate interior ${interior} chunks: logs=${logs} leaves=${leaves} plants=${plants} chunksWithTrees=${chunksWithTrees}/${interior}`,
	)
}

function timing(): void {
	const blocks = new Uint16Array(CHUNK_VOLUME)
	const fluids = new Uint8Array(CHUNK_VOLUME)
	for (let i = 0; i < 12; i++) gen.generateChunk(500 + i, 500, blocks, fluids)
	const n = 32
	const t0 = performance.now()
	for (let i = 0; i < n; i++) gen.generateChunk(i, 77, blocks, fluids)
	const t1 = performance.now()
	console.log(`--- chunkGen avg ${((t1 - t0) / n).toFixed(3)} ms over ${n} chunks`)
}

biomeHistogram()
chunkStats(0, 0, 4, 'origin')
chunkStats(-40, 24, 4, 'scan-b')
decorateStats(0, 0, 5)
decorateStats(-40, 24, 5)
timing()
