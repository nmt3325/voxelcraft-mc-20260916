/**
 * Overworld chunk generation performance and equivalence (item H-06).
 * Owned by task world-f.
 *
 * Two independent jobs:
 *  - the measurement mirrors the world-a benchmark so the two log lines can be
 *    compared directly, and asserts against the shared bench ceiling;
 *  - the equivalence test pins the exact chunk hashes captured before the first
 *    optimisation. Every H-06 change is meant to be a pure reordering of work
 *    (caching, lookup tables, hoisted invariants, typed array fills, fewer
 *    allocations), so any drift in these numbers means an optimisation changed
 *    generated output and has to be reverted rather than re-pinned.
 *
 * The seven golden chunks in golden.json already cover the same contract from
 * the other direction; the three extra chunks here reach far from the origin,
 * where the noise lattice indices and the cave halo are large and negative.
 */
import { BENCH, CHUNK_VOLUME, PERF, hashBuffer } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { createWorldGenerator } from '../index'

/** seed, cx, cz, hashBuffer(blocks), hashBuffer(fluids). */
type ChunkPin = readonly [number, number, number, number, number]

/** Captured on the H-06 base commit, before any optimisation landed. */
const ORIGIN_CHUNK: ChunkPin = [1337, 0, 0, 2763474780, 1582341573]

const PINNED_CHUNKS: readonly ChunkPin[] = [
	ORIGIN_CHUNK,
	[1337, 5, -3, 1508117521, 1582341573],
	[1337, -12, 7, 1825573235, 1582341573],
	[20260916, 0, 0, 2319082960, 1582341573],
	[20260916, 31, 29, 2689750948, 1582341573],
	[1337, 30, -48, 1397256602, 3244926373],
	[20260916, -39, -48, 3740249551, 2484712597],
	[1337, 411, 411, 377808583, 1582341573],
	[1337, -40, 24, 3994399779, 1582341573],
	[20260916, 700, -700, 2965523954, 1582341573],
]

/** Median of three, so a single noisy round cannot decide the result. */
function median3(a: number, b: number, c: number): number {
	return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c))
}

describe('world-f overworld equivalence', () => {
	it('generates byte identical chunks after the H-06 optimisations', () => {
		for (const [seed, cx, cz, blockHash, fluidHash] of PINNED_CHUNKS) {
			const blocks = new Uint16Array(CHUNK_VOLUME)
			const fluids = new Uint8Array(CHUNK_VOLUME)
			createWorldGenerator(seed).generateChunk(cx, cz, blocks, fluids)
			const where = `chunk ${cx},${cz} of seed ${seed}`
			expect(hashBuffer(blocks), `blocks of ${where}`).toBe(blockHash)
			expect(hashBuffer(fluids), `fluids of ${where}`).toBe(fluidHash)
		}
	})

	it('leaves nothing behind in a reused buffer pair', () => {
		const [seed, cx, cz, blockHash, fluidHash] = ORIGIN_CHUNK
		const gen = createWorldGenerator(seed)
		const blocks = new Uint16Array(CHUNK_VOLUME)
		const fluids = new Uint8Array(CHUNK_VOLUME)
		// A deep ocean chunk first. The column filler writes whole Y layers as
		// typed array runs now, so a voxel that a run failed to cover would show up
		// here as leftover water, ice or stone from the previous chunk.
		gen.generateChunk(30, -48, blocks, fluids)
		gen.generateChunk(cx, cz, blocks, fluids)
		expect(hashBuffer(blocks), 'blocks of a chunk written into a dirty buffer').toBe(blockHash)
		expect(hashBuffer(fluids), 'fluids of a chunk written into a dirty buffer').toBe(fluidHash)
	})
})

describe('world-f performance', () => {
	it('generates a chunk within the benchmark budget', () => {
		const gen = createWorldGenerator(1337)
		const blocks = new Uint16Array(CHUNK_VOLUME)
		const fluids = new Uint8Array(CHUNK_VOLUME)
		for (let i = 0; i < 8; i++) gen.generateChunk(900 + i, 900, blocks, fluids)
		const runs = 24
		const round = (): number => {
			const started = performance.now()
			for (let i = 0; i < runs; i++) gen.generateChunk(i, 411, blocks, fluids)
			return (performance.now() - started) / runs
		}
		// Several agents share this runner, so three rounds and a median are much
		// steadier than a single round.
		const first = round()
		const second = round()
		const third = round()
		const avg = median3(first, second, third)
		const rounds = `${first.toFixed(3)} ${second.toFixed(3)} ${third.toFixed(3)}`
		console.log(
			`world-f chunkGen avg ${avg.toFixed(3)} ms over ${runs} chunks (budget ${PERF.chunkGenBudgetMs} ms, bench max ${BENCH.chunkGenAvgMsMax} ms, rounds ${rounds})`,
		)
		expect(avg).toBeLessThan(BENCH.chunkGenAvgMsMax * BENCH.failFactor)
	})
})
