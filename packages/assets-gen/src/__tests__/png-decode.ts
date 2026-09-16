/** Minimal PNG reader used by the tests to verify what the encoder produced. */
import { inflateSync } from 'node:zlib'
import { crc32 } from '../zlib-lite'

export const SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export type PngChunk = {
  readonly type: string
  readonly body: Uint8Array
  readonly crc: number
  readonly crcOk: boolean
}

export type DecodedPng = {
  readonly width: number
  readonly height: number
  readonly bitDepth: number
  readonly colorType: number
  readonly chunks: readonly PngChunk[]
  readonly rgba: Uint8Array
}

function readU32(bytes: Uint8Array, at: number): number {
  return (
    (((bytes[at] ?? 0) << 24) |
      ((bytes[at + 1] ?? 0) << 16) |
      ((bytes[at + 2] ?? 0) << 8) |
      (bytes[at + 3] ?? 0)) >>>
    0
  )
}

export function decodePng(bytes: Uint8Array): DecodedPng {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error(`bad PNG signature at byte ${i}`)
  }
  const chunks: PngChunk[] = []
  let at = 8
  while (at + 12 <= bytes.length) {
    const length = readU32(bytes, at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const body = bytes.subarray(at + 8, at + 8 + length)
    const crc = readU32(bytes, at + 8 + length)
    chunks.push({ type, body, crc, crcOk: crc32(bytes.subarray(at + 4, at + 8 + length)) === crc })
    at += 12 + length
  }
  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR')
  if (!ihdr) throw new Error('missing IHDR chunk')
  const width = readU32(ihdr.body, 0)
  const height = readU32(ihdr.body, 4)
  const idat = Buffer.concat(
    chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => Buffer.from(chunk.body)),
  )
  const raw = new Uint8Array(inflateSync(idat))
  const stride = width * 4
  if (raw.length !== (stride + 1) * height) {
    throw new Error(`unexpected raw size ${raw.length} for ${width}x${height}`)
  }
  const rgba = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1)
    if (raw[rowStart] !== 0) throw new Error(`unexpected row filter ${raw[rowStart]} on row ${y}`)
    rgba.set(raw.subarray(rowStart + 1, rowStart + 1 + stride), y * stride)
  }
  return {
    width,
    height,
    bitDepth: ihdr.body[8] ?? 0,
    colorType: ihdr.body[9] ?? 0,
    chunks,
    rgba,
  }
}

export function pixelAt(png: DecodedPng, x: number, y: number): [number, number, number, number] {
  const o = (y * png.width + x) * 4
  return [png.rgba[o] ?? 0, png.rgba[o + 1] ?? 0, png.rgba[o + 2] ?? 0, png.rgba[o + 3] ?? 0]
}

/** All pixels of the tile at the given atlas index, row-major slot layout. */
export function tilePixels(
  png: DecodedPng,
  index: number,
  tilePx: number,
  columns: number,
): Array<[number, number, number, number]> {
  const col = index % columns
  const row = Math.floor(index / columns)
  const out: Array<[number, number, number, number]> = []
  for (let y = 0; y < tilePx; y++) {
    for (let x = 0; x < tilePx; x++) {
      out.push(pixelAt(png, col * tilePx + x, row * tilePx + y))
    }
  }
  return out
}
