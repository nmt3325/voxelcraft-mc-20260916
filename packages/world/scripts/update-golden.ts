/**
 * Regenerates src/__tests__/golden.json.
 *
 * The golden fixture pins the exact bytes of a few chunks. Run this ONLY after
 * an intentional change to world generation, and never hand-edit the fixture:
 *   pnpm --filter @voxelcraft/world run golden:update
 *
 * At least one case has to contain fluid. A fixture of dry chunks pins the all
 * zero hash for every `fluids` entry, which any generator at all reproduces
 * (review R-02), so the guard below refuses to write one.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHUNK_VOLUME, WORLD_GEN_VERSION, hashBuffer } from '@voxelcraft/core-types'
import { createWorldGenerator } from '../src/index'

interface GoldenEntry {
	seed: number
	cx: number
	cz: number
	blocks: number
	fluids: number
}

const CASES: ReadonlyArray<{ seed: number; cx: number; cz: number }> = [
	{ seed: 1337, cx: 0, cz: 0 },
	{ seed: 1337, cx: 5, cz: -3 },
	{ seed: 1337, cx: -12, cz: 7 },
	{ seed: 20260916, cx: 0, cz: 0 },
	{ seed: 20260916, cx: 31, cz: 29 },
	// Ocean chunks (review R-02): without a case that actually holds water,
	// every `fluids` hash is the all zero hash and pins nothing at all.
	{ seed: 1337, cx: 30, cz: -48 },
	{ seed: 20260916, cx: -39, cz: -48 },
]

const entries: GoldenEntry[] = CASES.map(({ seed, cx, cz }) => {
	const gen = createWorldGenerator(seed)
	const blocks = new Uint16Array(CHUNK_VOLUME)
	const fluids = new Uint8Array(CHUNK_VOLUME)
	gen.generateChunk(cx, cz, blocks, fluids)
	return { seed, cx, cz, blocks: hashBuffer(blocks), fluids: hashBuffer(fluids) }
})

/** What a fixture of dry chunks would pin for every single entry. */
const EMPTY_FLUIDS = hashBuffer(new Uint8Array(CHUNK_VOLUME))

if (!entries.some((entry) => entry.fluids !== EMPTY_FLUIDS)) {
	throw new Error(
		`every golden chunk has an empty fluid buffer (hash ${EMPTY_FLUIDS}); add a wet case`,
	)
}

const out = {
	worldGenVersion: WORLD_GEN_VERSION,
	generator: 'createWorldGenerator',
	entries,
}

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', '__tests__', 'golden.json')
mkdirSync(dirname(file), { recursive: true })
writeFileSync(file, `${JSON.stringify(out, null, '\t')}\n`)
console.log(`wrote ${file} with ${entries.length} entries`)
