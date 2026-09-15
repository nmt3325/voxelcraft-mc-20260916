import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '..', 'results')
mkdirSync(outDir, { recursive: true })

const report = {
  version: 0,
  scaffold: true,
  note: 'Replaced by the real harness: chunk gen + meshing at render distance 8, and sim tick cost.',
  metrics: [] as Array<{ name: string; unit: string; value: number }>,
}

const out = resolve(outDir, 'bench.json')
writeFileSync(out, JSON.stringify(report, null, 2))
console.log('[bench] wrote', out)
