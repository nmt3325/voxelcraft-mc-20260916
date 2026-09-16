/**
 * Performance baseline for the real stack. Chunk generation, decoration and
 * lighting run on packages/world plus packages/sim, meshing runs on the real
 * packages/client mesher, and the sim tick runs the real ECS schedule. No
 * bench fixtures are substituted for those systems any more.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	BENCH,
	CHUNK_X,
	CHUNK_Y,
	CHUNK_Z,
	CONTRACT_VERSION,
	PERF,
	SEA_LEVEL,
	SECTIONS_PER_CHUNK,
	SECTION_Y,
	WORLD_GEN_VERSION,
	paddedIndex,
	sectionKey,
	type BlockId,
	type MeshRequest,
} from '@voxelcraft/core-types'
import { sectionMaskOf } from '@voxelcraft/gameplay'
import {
	Intent,
	createEcsWorld,
	createPhysicsSystem,
	createSchedule,
	createSimVoxelWorld,
	createTickRunner,
	defineSystem,
	fluidCreateEngine,
	fluidSystemEntry,
	lightCreateEngine,
	lightPropsOf,
	lightSystemEntry,
	spawnLivingEntity,
} from '@voxelcraft/sim'
import { createWorldGenerator } from '@voxelcraft/world'
import { loadMesher, type MesherApi } from './clientMesher'
import type { PaddedNeighbourhood } from './fixtures/mesher'

const SEED = 1337
const RENDER_DISTANCE = BENCH.renderDistance
/** Decoration reads the 3x3 terrain neighbourhood, so the outer ring stays bare. */
const DECORATE_DISTANCE = RENDER_DISTANCE - 1
const MESH_CHUNK_SAMPLE = 32
const TICK_ENTITIES = 512
const TICK_COLUMNS = 32
const TICK_COUNT = 600

const generator = createWorldGenerator(SEED)
const voxels = createSimVoxelWorld()
const light = lightCreateEngine({ world: voxels })
const fluids = fluidCreateEngine({ world: voxels })

/** `skyPassThrough` per block id, so a heightmap rebuild is a typed-array scan. */
const SKY_PASS_THROUGH = ((): Uint8Array => {
	const table = new Uint8Array(256)
	for (let id = 0; id < table.length; id++) table[id] = lightPropsOf(id).skyPassThrough ? 1 : 0
	return table
})()

/** The same edit view apps/game hands to the generator when it decorates. */
const decorationView = {
	getBlock: (x: number, y: number, z: number) => voxels.getBlock(x, y, z),
	getFluid: (x: number, y: number, z: number) => voxels.getFluid(x, y, z),
	isSolid: (x: number, y: number, z: number) => voxels.isSolid(x, y, z),
	isLiquid: (x: number, y: number, z: number) => voxels.isLiquid(x, y, z),
	isLoaded: (cx: number, cz: number) => voxels.isLoaded(cx, cz),
	setBlock: (x: number, y: number, z: number, id: BlockId) => {
		voxels.setBlock(x, y, z, id)
	},
	setFluid: (x: number, y: number, z: number, packed: number) => {
		voxels.setFluid(x, y, z, packed)
	},
}

/** `generateChunk` writes the block array directly, so the heightmap follows. */
function refreshHeightmap(chunk: {
	blocks: { readonly [index: number]: number }
	heightmap: { [index: number]: number }
}): void {
	for (let lz = 0; lz < CHUNK_Z; lz++) {
		for (let lx = 0; lx < CHUNK_X; lx++) {
			let y = CHUNK_Y - 1
			while (y >= 0 && SKY_PASS_THROUGH[chunk.blocks[(y << 8) | (lz << 4) | lx]] === 1) y--
			chunk.heightmap[(lz << 4) | lx] = y + 1
		}
	}
}

function round3(value: number): number {
	return Math.round(value * 1000) / 1000
}

interface GenResult {
	terrainMs: number
	decorateMs: number
	lightMs: number
	chunks: number
	decorated: number
}

/**
 * Real terrain for the whole render distance, then real decoration and a real
 * skylight seed for everything that has its full neighbourhood. `chunkGenAvgMs`
 * covers terrain plus decoration; lighting is reported on its own.
 */
function benchChunkGeneration(): GenResult {
	const terrainStarted = performance.now()
	let chunks = 0
	for (let cz = -RENDER_DISTANCE; cz <= RENDER_DISTANCE; cz++) {
		for (let cx = -RENDER_DISTANCE; cx <= RENDER_DISTANCE; cx++) {
			const chunk = voxels.ensureChunk(cx, cz)
			generator.generateChunk(cx, cz, chunk.blocks, chunk.fluids)
			refreshHeightmap(chunk)
			chunk.generated = true
			chunk.lit = false
			chunks++
		}
	}
	const terrainMs = performance.now() - terrainStarted

	const decorateStarted = performance.now()
	let decorated = 0
	for (let cz = -DECORATE_DISTANCE; cz <= DECORATE_DISTANCE; cz++) {
		for (let cx = -DECORATE_DISTANCE; cx <= DECORATE_DISTANCE; cx++) {
			generator.decorate(cx, cz, decorationView)
			decorated++
		}
	}
	const decorateMs = performance.now() - decorateStarted

	const lightStarted = performance.now()
	for (let cz = -DECORATE_DISTANCE; cz <= DECORATE_DISTANCE; cz++) {
		for (let cx = -DECORATE_DISTANCE; cx <= DECORATE_DISTANCE; cx++) {
			light.seedChunk(cx, cz)
			const chunk = voxels.getChunk(cx, cz)
			if (chunk !== undefined) chunk.lit = true
		}
	}
	light.stitchBoundaries()
	const lightMs = performance.now() - lightStarted

	return { terrainMs, decorateMs, lightMs, chunks, decorated }
}

/** Copies the real 18^3 block, light and fluid neighbourhood for one section. */
function fillPadded(padded: PaddedNeighbourhood, cx: number, cz: number, sy: number): void {
	const baseX = cx * CHUNK_X
	const baseY = sy * SECTION_Y
	const baseZ = cz * CHUNK_Z
	for (let y = -1; y <= SECTION_Y; y++) {
		const wy = baseY + y
		const inRange = wy >= 0 && wy < CHUNK_Y
		for (let z = -1; z <= CHUNK_Z; z++) {
			const wz = baseZ + z
			for (let x = -1; x <= CHUNK_X; x++) {
				const index = paddedIndex(x, y, z)
				if (!inRange) {
					padded.blocks[index] = 0
					padded.light[index] = 0
					padded.fluids[index] = 0
					continue
				}
				const wx = baseX + x
				padded.blocks[index] = voxels.getBlock(wx, wy, wz)
				padded.light[index] = voxels.getLightByte(wx, wy, wz)
				padded.fluids[index] = voxels.getFluid(wx, wy, wz)
			}
		}
	}
}

interface MeshResultSummary {
	totalMs: number
	chunkCount: number
	sectionCount: number
	skippedEmptySections: number
	quads: number
}

function benchMeshing(api: MesherApi): MeshResultSummary {
	const padded = api.createEmptyPadded()
	const targets: Array<{ cx: number; cz: number }> = []
	const inner = DECORATE_DISTANCE
	for (let cz = -inner; cz <= inner && targets.length < MESH_CHUNK_SAMPLE; cz++) {
		for (let cx = -inner; cx <= inner && targets.length < MESH_CHUNK_SAMPLE; cx++) {
			targets.push({ cx, cz })
		}
	}

	let totalMs = 0
	let sectionCount = 0
	let skippedEmptySections = 0
	let quads = 0

	for (const target of targets) {
		const chunk = voxels.getChunk(target.cx, target.cz)
		if (chunk === undefined) continue
		// The renderer never meshes an all-air section, so neither does the bench.
		const mask = sectionMaskOf(chunk.blocks, chunk.fluids)

		for (let sy = 0; sy < SECTIONS_PER_CHUNK; sy++) {
			if ((mask & (1 << sy)) === 0) {
				skippedEmptySections++
				continue
			}
			fillPadded(padded, target.cx, target.cz, sy)
			const request: MeshRequest = {
				key: sectionKey(target.cx, target.cz, sy),
				cx: target.cx,
				cz: target.cz,
				sy,
				revision: 1,
				blocks: padded.blocks,
				light: padded.light,
				fluids: padded.fluids,
				flags: { ao: true, smoothLight: true },
			}
			const started = performance.now()
			const result = api.meshSection(request)
			totalMs += performance.now() - started
			quads += result.stats.quads
			sectionCount++
		}
	}

	return { totalMs, chunkCount: targets.length, sectionCount, skippedEmptySections, quads }
}

interface TickSummary {
	totalMs: number
	ticks: number
	entities: number
	systems: string[]
}

/**
 * The schedule apps/game actually runs: the real fluid and light engine system
 * entries plus the real physics system, driven by the real fixed-step tick
 * runner over the generated world, so collisions, fluid probes, light queues
 * and fall damage are all measured.
 */
function benchSimTick(): TickSummary {
	const ecs = createEcsWorld()
	const entries = [fluidSystemEntry(fluids), lightSystemEntry(light)]
	entries.push(defineSystem('physics', createPhysicsSystem(voxels)))
	const schedule = createSchedule(entries)
	const runner = createTickRunner(ecs, schedule, 0)

	const reach = DECORATE_DISTANCE * CHUNK_X
	const rows = TICK_ENTITIES / TICK_COLUMNS
	for (let i = 0; i < TICK_ENTITIES; i++) {
		const col = i % TICK_COLUMNS
		const row = Math.floor(i / TICK_COLUMNS)
		const x = -reach + (2 * reach * (col + 0.5)) / TICK_COLUMNS
		const z = -reach + (2 * reach * (row + 0.5)) / rows
		const column = generator.sampleColumn(Math.floor(x), Math.floor(z))
		// Spawned above the surface, so the opening ticks do real falling.
		const y = Math.max(column.surfaceY, SEA_LEVEL) + 3
		const yaw = (i % 16) * (Math.PI / 8)
		const entity = spawnLivingEntity(ecs, { x, y, z, yaw })
		ecs.add(entity, Intent, {
			forward: i % 3 === 0 ? 1 : i % 3 === 1 ? 0.5 : -1,
			strafe: ((i % 5) - 2) / 2,
			jump: i % 16 === 0,
			sprint: i % 4 === 0,
			sneak: i % 11 === 0,
			yaw,
		})
	}
	ecs.flush()

	const started = performance.now()
	for (let i = 0; i < TICK_COUNT; i++) runner.runTick()
	return {
		totalMs: performance.now() - started,
		ticks: TICK_COUNT,
		entities: TICK_ENTITIES,
		systems: schedule.systems.map((system) => system.name),
	}
}

type MetricStatus = 'ok' | 'warn' | 'fail'

interface Metric {
	name: string
	unit: 'ms'
	value: number
	threshold: number
	failThreshold: number
	status: MetricStatus
}

function makeMetric(name: string, value: number, threshold: number): Metric {
	const failThreshold = threshold * BENCH.failFactor
	const status: MetricStatus = value > failThreshold ? 'fail' : value > threshold ? 'warn' : 'ok'
	return {
		name,
		unit: 'ms',
		value: round3(value),
		threshold,
		failThreshold: round3(failThreshold),
		status,
	}
}

async function main(): Promise<void> {
	const mesher = await loadMesher()

	const generation = benchChunkGeneration()
	const meshing = benchMeshing(mesher.api)
	const tick = benchSimTick()

	const genMs = generation.terrainMs + generation.decorateMs
	const chunkGenAvgMs = genMs / Math.max(1, generation.chunks)
	const chunkMeshAvgMs = meshing.totalMs / Math.max(1, meshing.chunkCount)
	const sectionMeshAvgMs = meshing.totalMs / Math.max(1, meshing.sectionCount)
	const simTickAvgMs = tick.totalMs / Math.max(1, tick.ticks)
	// The skylight seed and boundary stitch, per column the light loop seeds.
	// It used to be reported as a bare total with no threshold, so a regression
	// in light seeding could never fail the bench. The contract freezes no light
	// budget of its own, so this is held to the per column generation budget:
	// seeding a column is part of making one.
	const lightSeedAvgMs = generation.lightMs / Math.max(1, generation.decorated)

	const metrics: Metric[] = [
		makeMetric('chunkGenAvgMs', chunkGenAvgMs, BENCH.chunkGenAvgMsMax),
		makeMetric('chunkMeshAvgMs', chunkMeshAvgMs, BENCH.chunkMeshAvgMsMax),
		makeMetric('simTickAvgMs', simTickAvgMs, BENCH.simTickAvgMsMax),
		makeMetric('lightSeedAvgMs', lightSeedAvgMs, BENCH.chunkGenAvgMsMax),
	]

	const warnings = metrics
		.filter((metric) => metric.status === 'warn')
		.map(
			(metric) =>
				`${metric.name} ${metric.value} ms exceeds the ${metric.threshold} ms budget ` +
				`(fails above ${metric.failThreshold} ms)`,
		)
	const failures = metrics
		.filter((metric) => metric.status === 'fail')
		.map(
			(metric) =>
				`${metric.name} ${metric.value} ms exceeds ${BENCH.failFactor}x the ` +
				`${metric.threshold} ms budget`,
		)

	if (mesher.source !== 'client') {
		warnings.push(
			`meshing measured with the bench fallback mesher: ${mesher.reason ?? 'unknown reason'}`,
		)
	}

	const report = {
		version: 1,
		task: 'fix-c',
		generatedAt: new Date().toISOString(),
		contractVersion: CONTRACT_VERSION,
		failFactor: BENCH.failFactor,
		meta: {
			seed: SEED,
			renderDistance: RENDER_DISTANCE,
			node: process.version,
			platform: `${process.platform}-${process.arch}`,
			fixtureSubstitution: {
				used: false,
				reason:
					'chunk generation, decoration, lighting and the sim tick run on the real ' +
					'@voxelcraft/world and @voxelcraft/sim implementations, and meshing runs on the ' +
					'real @voxelcraft/client mesher, so no bench fixture stands in for a shipped system.',
				terrain: { module: '@voxelcraft/world', version: generator.version },
				simTick: { module: '@voxelcraft/sim', systems: tick.systems, tickHz: PERF.simTickHz },
			},
			mesher: {
				source: mesher.source,
				version: mesher.version,
				fallbackUsed: mesher.source !== 'client',
				reason: mesher.reason ?? null,
			},
			worldGenVersion: WORLD_GEN_VERSION,
			sample: {
				chunksGenerated: generation.chunks,
				chunksDecorated: generation.decorated,
				chunksMeshed: meshing.chunkCount,
				sectionsMeshed: meshing.sectionCount,
				sectionsSkippedEmpty: meshing.skippedEmptySections,
				quadsEmitted: meshing.quads,
				tickEntities: tick.entities,
				ticks: tick.ticks,
			},
			totals: {
				chunkGenMs: round3(genMs),
				terrainMs: round3(generation.terrainMs),
				decorateMs: round3(generation.decorateMs),
				lightSeedAndStitchMs: round3(generation.lightMs),
				meshMs: round3(meshing.totalMs),
				simTickMs: round3(tick.totalMs),
			},
			notes:
				'chunkGenAvgMs covers real terrain generation plus decoration per chunk; the ' +
				'skylight seed and boundary stitch are timed separately as lightSeedAndStitchMs ' +
				'and gated as lightSeedAvgMs, that same total over the columns the light loop ' +
				'seeds, held to the frozen per column generation budget because the contract ' +
				'freezes no light budget of its own; the light engine is also exercised inside ' +
				'simTickAvgMs.',
		},
		metrics,
		informational: [
			{
				name: 'sectionMeshAvgMs',
				unit: 'ms',
				value: round3(sectionMeshAvgMs),
				budget: PERF.sectionMeshBudgetMs,
			},
		],
		warnings,
		failures,
	}

	const here = dirname(fileURLToPath(import.meta.url))
	const outDir = resolve(here, '..', 'results')
	mkdirSync(outDir, { recursive: true })
	const outPath = resolve(outDir, 'bench.json')
	writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)

	console.log(
		`[bench] mesher=${mesher.source} version=${mesher.version}` +
			(mesher.reason === undefined ? '' : ` (${mesher.reason})`),
	)
	console.log(
		`[bench] real world gen v${generator.version}, render distance ${RENDER_DISTANCE}, ` +
			`generated ${generation.chunks} chunks, decorated ${generation.decorated}, ` +
			`meshed ${meshing.sectionCount} sections across ${meshing.chunkCount} chunks ` +
			`(${meshing.skippedEmptySections} empty sections skipped), ${meshing.quads} quads`,
	)
	console.log(
		`[bench] sim schedule [${tick.systems.join(', ')}] over ${tick.entities} entities, ` +
			`${tick.ticks} ticks`,
	)
	for (const metric of metrics) {
		console.log(
			`[bench] ${metric.name} = ${metric.value} ms ` +
				`(budget ${metric.threshold} ms, fail > ${metric.failThreshold} ms) -> ${metric.status}`,
		)
	}
	console.log(
		`[bench] sectionMeshAvgMs = ${round3(sectionMeshAvgMs)} ms ` +
			`(section budget ${PERF.sectionMeshBudgetMs} ms)`,
	)
	console.log(
		`[bench] terrain ${round3(generation.terrainMs)} ms, decorate ` +
			`${round3(generation.decorateMs)} ms, light seed+stitch ${round3(generation.lightMs)} ms`,
	)
	for (const warning of warnings) console.log(`[bench] WARN ${warning}`)
	for (const failure of failures) console.log(`[bench] FAIL ${failure}`)
	console.log(`[bench] wrote ${outPath}`)

	if (failures.length > 0) process.exitCode = 1
}

void main().catch((error: unknown) => {
	console.log(`[bench] FAIL unexpected error: ${String(error)}`)
	process.exitCode = 1
})
