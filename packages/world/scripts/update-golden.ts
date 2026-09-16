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
 *
 * v2 pins the nether in a second, independent block. The overworld cases and
 * their order are untouched, so a regeneration must leave every overworld hash
 * exactly as it was: a changed overworld hash is a regression to fix, never a
 * new golden to accept.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DimensionId } from '@voxelcraft/core-types'
import {
	CHUNK_VOLUME,
	DIMENSION,
	NETHER_GEN,
	WORLD_GEN_VERSION,
	hashBuffer,
} from '@voxelcraft/core-types'
import { createWorldGenerator } from '../src/index'

interface GoldenCase {
	seed: number
	cx: number
	cz: number
}

interface GoldenEntry extends GoldenCase {
	blocks: number
	fluids: number
}

const CASES: ReadonlyArray<GoldenCase> = [
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

/**
 * Nether cases. Two seeds and a spread of chunk coordinates, so the fixture
 * covers different cavern shapes and different amounts of lava sea.
 */
const NETHER_CASES: ReadonlyArray<GoldenCase> = [
	{ seed: 1337, cx: 0, cz: 0 },
	{ seed: 1337, cx: 5, cz: -3 },
	{ seed: 1337, cx: -4, cz: 9 },
	{ seed: 20260916, cx: 0, cz: 0 },
	{ seed: 20260916, cx: -4, cz: 9 },
	{ seed: 20260916, cx: 31, cz: 29 },
]

function pin(cases: ReadonlyArray<GoldenCase>, dimension: DimensionId): GoldenEntry[] {
	return cases.map(({ seed, cx, cz }) => {
		const gen = createWorldGenerator(seed, dimension)
		const blocks = new Uint16Array(CHUNK_VOLUME)
		const fluids = new Uint8Array(CHUNK_VOLUME)
		gen.generateChunk(cx, cz, blocks, fluids)
		return { seed, cx, cz, blocks: hashBuffer(blocks), fluids: hashBuffer(fluids) }
	})
}

const entries = pin(CASES, DIMENSION.Overworld)
const netherEntries = pin(NETHER_CASES, DIMENSION.Nether)

/** What a fixture of dry chunks would pin for every single entry. */
const EMPTY_FLUIDS = hashBuffer(new Uint8Array(CHUNK_VOLUME))

if (!entries.some((entry) => entry.fluids !== EMPTY_FLUIDS)) {
	throw new Error(
		`every golden chunk has an empty fluid buffer (hash ${EMPTY_FLUIDS}); add a wet case`,
	)
}

// The same trap in the nether: a case list that never reaches the lava sea
// would pin the all zero fluid hash and prove nothing about the sea level.
if (!netherEntries.some((entry) => entry.fluids !== EMPTY_FLUIDS)) {
	throw new Error(
		`every nether golden chunk has an empty fluid buffer (hash ${EMPTY_FLUIDS}); add a case that reaches the lava sea`,
	)
}

const out = {
	worldGenVersion: WORLD_GEN_VERSION,
	generator: 'createWorldGenerator',
	entries,
	netherGenVersion: NETHER_GEN.genVersion,
	netherGenerator: 'createWorldGenerator(seed, DIMENSION.Nether)',
	netherEntries,
}

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', '__tests__', 'golden.json')
mkdirSync(dirname(file), { recursive: true })
writeFileSync(file, `${JSON.stringify(out, null, '\t')}\n`)
console.log(
	`wrote ${file} with ${entries.length} overworld entries and ${netherEntries.length} nether entries`,
)
