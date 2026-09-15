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
  SECTIONS_PER_CHUNK,
  SECTION_Y,
  blockIndex,
  paddedIndex,
  sectionKey,
} from '@voxelcraft/core-types'
import type { MeshRequest } from '@voxelcraft/core-types'
import { loadMesher, type MesherApi } from './clientMesher'
import { isOpaque, type PaddedNeighbourhood } from './fixtures/mesher'
import {
  FIXTURE_TERRAIN_VERSION,
  generateFixtureChunk,
  surfaceHeight,
  type FixtureChunk,
} from './fixtures/terrain'
import { FIXTURE_TICK_VERSION, createTickWorld, stepTickWorld } from './fixtures/tick'

const SEED = 1337
const RENDER_DISTANCE = BENCH.renderDistance
const MESH_CHUNK_SAMPLE = 32
const TICK_ENTITIES = 512
const TICK_COUNT = 600

const chunks = new Map<number, FixtureChunk>()

function chunkKey(cx: number, cz: number): number {
  return ((cx + 1024) << 12) | (cz + 1024)
}

function getChunk(cx: number, cz: number): FixtureChunk | undefined {
  return chunks.get(chunkKey(cx, cz))
}

function sampleBlock(wx: number, wy: number, wz: number): number {
  if (wy < 0 || wy >= CHUNK_Y) return 0
  const cx = Math.floor(wx / CHUNK_X)
  const cz = Math.floor(wz / CHUNK_Z)
  const chunk = getChunk(cx, cz)
  if (chunk === undefined) return 0
  return chunk.blocks[blockIndex(wx - cx * CHUNK_X, wy, wz - cz * CHUNK_Z)]
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

interface GenResult {
  totalMs: number
  count: number
}

function benchChunkGeneration(): GenResult {
  const started = performance.now()
  let count = 0
  for (let cz = -RENDER_DISTANCE; cz <= RENDER_DISTANCE; cz++) {
    for (let cx = -RENDER_DISTANCE; cx <= RENDER_DISTANCE; cx++) {
      chunks.set(chunkKey(cx, cz), generateFixtureChunk(SEED, cx, cz))
      count++
    }
  }
  return { totalMs: performance.now() - started, count }
}

/** Copies the 18^3 neighbourhood for one section out of the generated chunks. */
function buildPadded(
  neighbours: ReadonlyArray<FixtureChunk | undefined>,
  sy: number,
  padded: PaddedNeighbourhood,
  api: MesherApi,
): void {
  const baseY = sy * SECTION_Y
  for (let y = -1; y <= SECTION_Y; y++) {
    const wy = baseY + y
    const inRange = wy >= 0 && wy < CHUNK_Y
    for (let z = -1; z <= SECTION_Y; z++) {
      const dz = z < 0 ? -1 : z >= CHUNK_Z ? 1 : 0
      const lz = z < 0 ? CHUNK_Z - 1 : z >= CHUNK_Z ? 0 : z
      for (let x = -1; x <= SECTION_Y; x++) {
        const dx = x < 0 ? -1 : x >= CHUNK_X ? 1 : 0
        const lx = x < 0 ? CHUNK_X - 1 : x >= CHUNK_X ? 0 : x
        const chunk = neighbours[(dz + 1) * 3 + (dx + 1)]
        padded.blocks[paddedIndex(x, y, z)] =
          inRange && chunk !== undefined ? chunk.blocks[blockIndex(lx, wy, lz)] : 0
      }
    }
  }
  api.fillPaddedLight(padded.light, 15, 0)
  padded.fluids.fill(0)
}

function sectionHasBlocks(chunk: FixtureChunk, sy: number): boolean {
  const from = sy * SECTION_Y
  for (let y = from; y < from + SECTION_Y; y++) {
    for (let z = 0; z < CHUNK_Z; z++) {
      for (let x = 0; x < CHUNK_X; x++) {
        if (chunk.blocks[blockIndex(x, y, z)] !== 0) return true
      }
    }
  }
  return false
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
  const inner = RENDER_DISTANCE - 1
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
    const chunk = getChunk(target.cx, target.cz)
    if (chunk === undefined) continue

    const neighbours: Array<FixtureChunk | undefined> = []
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        neighbours.push(getChunk(target.cx + dx, target.cz + dz))
      }
    }

    for (let sy = 0; sy < SECTIONS_PER_CHUNK; sy++) {
      // A real renderer never meshes an all-air section, so neither does the bench.
      if (!sectionHasBlocks(chunk, sy)) {
        skippedEmptySections++
        continue
      }
      buildPadded(neighbours, sy, padded, api)
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
}

function benchSimTick(): TickSummary {
  const sampleSolid = (x: number, y: number, z: number): boolean =>
    isOpaque(sampleBlock(Math.floor(x), Math.floor(y), Math.floor(z)))
  const world = createTickWorld(SEED, TICK_ENTITIES, sampleSolid, (x, z) =>
    surfaceHeight(SEED, Math.floor(x), Math.floor(z)),
  )
  const started = performance.now()
  for (let i = 0; i < TICK_COUNT; i++) stepTickWorld(world)
  return { totalMs: performance.now() - started, ticks: TICK_COUNT, entities: TICK_ENTITIES }
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

  const chunkGenAvgMs = generation.totalMs / Math.max(1, generation.count)
  const chunkMeshAvgMs = meshing.totalMs / Math.max(1, meshing.chunkCount)
  const sectionMeshAvgMs = meshing.totalMs / Math.max(1, meshing.sectionCount)
  const simTickAvgMs = tick.totalMs / Math.max(1, tick.ticks)

  const metrics: Metric[] = [
    makeMetric('chunkGenAvgMs', chunkGenAvgMs, BENCH.chunkGenAvgMsMax),
    makeMetric('chunkMeshAvgMs', chunkMeshAvgMs, BENCH.chunkMeshAvgMsMax),
    makeMetric('simTickAvgMs', simTickAvgMs, BENCH.simTickAvgMsMax),
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
    task: 'client-c',
    generatedAt: new Date().toISOString(),
    contractVersion: CONTRACT_VERSION,
    failFactor: BENCH.failFactor,
    meta: {
      seed: SEED,
      renderDistance: RENDER_DISTANCE,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      fixtureSubstitution: {
        used: true,
        reason:
          'packages/world, packages/sim and packages/gameplay are still stubs, so chunk ' +
          'generation and the sim tick are measured against deterministic bench fixtures ' +
          'built on the shared hashU32 / hash01 primitives instead of the real systems.',
        terrain: { module: 'tests/bench/src/fixtures/terrain.ts', version: FIXTURE_TERRAIN_VERSION },
        simTick: { module: 'tests/bench/src/fixtures/tick.ts', version: FIXTURE_TICK_VERSION },
      },
      mesher: {
        source: mesher.source,
        version: mesher.version,
        fallbackUsed: mesher.source !== 'client',
        reason: mesher.reason ?? null,
      },
      sample: {
        chunksGenerated: generation.count,
        chunksMeshed: meshing.chunkCount,
        sectionsMeshed: meshing.sectionCount,
        sectionsSkippedEmpty: meshing.skippedEmptySections,
        quadsEmitted: meshing.quads,
        tickEntities: tick.entities,
        ticks: tick.ticks,
      },
      totals: {
        chunkGenMs: round3(generation.totalMs),
        meshMs: round3(meshing.totalMs),
        simTickMs: round3(tick.totalMs),
      },
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
    `[bench] render distance ${RENDER_DISTANCE}, generated ${generation.count} chunks, ` +
      `meshed ${meshing.sectionCount} sections across ${meshing.chunkCount} chunks ` +
      `(${meshing.skippedEmptySections} empty sections skipped), ${meshing.quads} quads`,
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
  for (const warning of warnings) console.log(`[bench] WARN ${warning}`)
  for (const failure of failures) console.log(`[bench] FAIL ${failure}`)
  console.log(`[bench] wrote ${outPath}`)

  if (failures.length > 0) process.exitCode = 1
}

void main().catch((error: unknown) => {
  console.log(`[bench] FAIL unexpected error: ${String(error)}`)
  process.exitCode = 1
})
