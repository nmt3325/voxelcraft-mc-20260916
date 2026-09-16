import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { PNG_SIGNATURE, encodePng } from '../png'
import { adler32, crc32, deflateStore } from '../zlib-lite'
import { decodePng, pixelAt } from './png-decode'

function ramp(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = i & 0xff
    data[i * 4 + 1] = (i * 7) & 0xff
    data[i * 4 + 2] = (i * 31) & 0xff
    data[i * 4 + 3] = i % 3 === 0 ? 255 : 128
  }
  return data
}

describe('checksums', () => {
  it('matches the CRC-32 reference vector', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('matches the Adler-32 reference vector', () => {
    expect(adler32(new TextEncoder().encode('Wikipedia'))).toBe(0x11e60398)
  })
})

describe('deflateStore', () => {
  it('produces a zlib stream that node can inflate, across block boundaries', () => {
    const raw = new Uint8Array(70000)
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 13) & 0xff
    const round = new Uint8Array(inflateSync(Buffer.from(deflateStore(raw))))
    expect(Buffer.from(round).equals(Buffer.from(raw))).toBe(true)
  })
})

describe('encodePng', () => {
  it('writes an RGBA8 stream with the right chunks and intact CRCs', () => {
    const png = encodePng({ width: 7, height: 5, data: ramp(7, 5) })
    expect(Buffer.from(png.subarray(0, 8)).equals(Buffer.from(PNG_SIGNATURE))).toBe(true)
    const decoded = decodePng(png)
    expect(decoded.chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
    expect(decoded.chunks.every((chunk) => chunk.crcOk)).toBe(true)
    expect([decoded.width, decoded.height, decoded.bitDepth, decoded.colorType]).toEqual([
      7, 5, 8, 6,
    ])
  })

  it('round trips every pixel', () => {
    const data = ramp(16, 9)
    const decoded = decodePng(encodePng({ width: 16, height: 9, data }))
    expect(Buffer.from(decoded.rgba).equals(Buffer.from(data))).toBe(true)
    expect(pixelAt(decoded, 0, 0)).toEqual([0, 0, 0, 255])
  })

  it('agrees between the zlib and the store code paths', () => {
    const image = { width: 20, height: 12, data: ramp(20, 12) }
    const viaZlib = decodePng(encodePng(image, 'zlib'))
    const viaStore = decodePng(encodePng(image, 'store'))
    expect(Buffer.from(viaStore.rgba).equals(Buffer.from(viaZlib.rgba))).toBe(true)
  })

  it('is deterministic and validates the buffer length', () => {
    const image = { width: 8, height: 8, data: ramp(8, 8) }
    expect(Buffer.from(encodePng(image)).equals(Buffer.from(encodePng(image)))).toBe(true)
    expect(() => encodePng({ width: 8, height: 8, data: new Uint8Array(4) })).toThrow()
  })
})
