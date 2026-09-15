/**
 * Regenerates every asset into packages/assets-gen/generated.
 * Deterministic: running it twice produces byte identical files.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ASSET_OUTPUT_DIR, writeAllAssets } from './write'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(packageRoot, ASSET_OUTPUT_DIR)
const result = writeAllAssets(outDir)

console.log(
  `assets-gen: ${result.textureCount} textures, ${result.soundCount} sounds -> ${result.outDir}`,
)
console.log(
  `assets-gen: atlas.png ${result.atlasPngBytes} bytes, ${result.files.length} files written`,
)
