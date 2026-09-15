import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '..', 'generated')

mkdirSync(outDir, { recursive: true })
writeFileSync(
  resolve(outDir, 'manifest.json'),
  JSON.stringify({ version: 0, generatedAt: new Date(0).toISOString(), assets: [] }, null, 2),
)
console.log('[assets-gen] scaffold manifest written to', outDir)
