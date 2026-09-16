import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildAtlas } from '../atlas'
import { REQUIRED_SOUNDS, buildSounds } from '../sounds'
import { REQUIRED_TEXTURES } from '../texture-list'
import { writeAllAssets } from '../write'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'assets-gen-'))
  dirs.push(dir)
  return dir
}

/** sha256 of every file under root, keyed by its posix relative path. */
function hashTree(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) {
        walk(path)
      } else {
        const key = relative(root, path).split(sep).join('/')
        out[key] = createHash('sha256').update(readFileSync(path)).digest('hex')
      }
    }
  }
  walk(root)
  return out
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

describe('build determinism', () => {
  it('builds byte identical atlases', () => {
    const first = buildAtlas()
    const second = buildAtlas()
    expect(Buffer.from(second.png).equals(Buffer.from(first.png))).toBe(true)
    expect(Buffer.from(second.rgba).equals(Buffer.from(first.rgba))).toBe(true)
    expect(second.manifest).toEqual(first.manifest)
  })

  it('builds byte identical sounds', () => {
    const first = buildSounds()
    const second = buildSounds()
    expect(second.manifest).toEqual(first.manifest)
    for (const name of REQUIRED_SOUNDS) {
      const a = Buffer.from(first.wavs[name] ?? new Uint8Array())
      const b = Buffer.from(second.wavs[name] ?? new Uint8Array())
      expect(b.equals(a), name).toBe(true)
    }
  })
})

describe('writeAllAssets', () => {
  it('writes exactly the contract layout', () => {
    const dir = tempDir()
    const result = writeAllAssets(dir)
    const expected = [
      'atlas.json',
      'atlas.png',
      'sounds.json',
      ...REQUIRED_SOUNDS.map((name) => `sounds/${name}.wav`),
    ].sort()
    expect(Object.keys(hashTree(dir)).sort()).toEqual(expected)
    expect(result.files.length).toBe(3 + REQUIRED_SOUNDS.length)
    expect(result.textureCount).toBe(REQUIRED_TEXTURES.length)
    expect(result.soundCount).toBe(REQUIRED_SOUNDS.length)
    expect(result.atlasPngBytes).toBeGreaterThan(0)
  })

  it('is idempotent when run twice into the same directory', () => {
    const dir = tempDir()
    writeAllAssets(dir)
    const first = hashTree(dir)
    writeAllAssets(dir)
    expect(hashTree(dir)).toEqual(first)
  })

  it('writes identical files into a different directory', () => {
    const left = tempDir()
    const right = tempDir()
    writeAllAssets(left)
    writeAllAssets(right)
    expect(hashTree(right)).toEqual(hashTree(left))
  })
})
