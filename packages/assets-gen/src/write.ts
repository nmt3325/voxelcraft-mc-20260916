/**
 * Writes the generated assets to disk. The relative layout is part of the
 * contract: apps/game serves this directory, so atlas.png / atlas.json /
 * sounds.json / sounds/*.wav must keep these names.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildAtlas, type BuiltAtlas } from './atlas'
import { SOUND_SUBDIR, buildSounds, type BuiltSounds } from './sounds'

export const ASSET_OUTPUT_DIR = 'generated'
export const ATLAS_PNG_FILE = 'atlas.png'
export const ATLAS_MANIFEST_FILE = 'atlas.json'
export const SOUND_MANIFEST_FILE = 'sounds.json'

export type WrittenAssets = {
  readonly outDir: string
  readonly files: readonly string[]
  readonly atlas: BuiltAtlas
  readonly sounds: BuiltSounds
  readonly atlasPngBytes: number
  readonly textureCount: number
  readonly soundCount: number
}

/** Stable JSON: two space indent plus a trailing newline, no timestamps. */
function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function writeAllAssets(outDir: string): WrittenAssets {
  const atlas = buildAtlas()
  const sounds = buildSounds()
  const soundDir = join(outDir, SOUND_SUBDIR)
  mkdirSync(outDir, { recursive: true })
  rmSync(soundDir, { recursive: true, force: true })
  mkdirSync(soundDir, { recursive: true })

  const files: string[] = []
  const pngPath = join(outDir, ATLAS_PNG_FILE)
  writeFileSync(pngPath, atlas.png)
  files.push(pngPath)

  const atlasManifestPath = join(outDir, ATLAS_MANIFEST_FILE)
  writeJson(atlasManifestPath, atlas.manifest)
  files.push(atlasManifestPath)

  const soundManifestPath = join(outDir, SOUND_MANIFEST_FILE)
  writeJson(soundManifestPath, sounds.manifest)
  files.push(soundManifestPath)

  for (const [name, relative] of Object.entries(sounds.manifest.files)) {
    const wav = sounds.wavs[name]
    if (!wav) throw new Error(`missing rendered wav for "${name}"`)
    const wavPath = join(outDir, relative)
    writeFileSync(wavPath, wav)
    files.push(wavPath)
  }

  return {
    outDir,
    files,
    atlas,
    sounds,
    atlasPngBytes: atlas.png.byteLength,
    textureCount: atlas.tileCount,
    soundCount: Object.keys(sounds.manifest.files).length,
  }
}
