/** Own CRC-32 / Adler-32 and a store-only deflate. No third party code. */

const ADLER_MOD = 65521
const STORE_BLOCK_MAX = 0xffff

function crcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n >>> 0
    for (let k = 0; k < 8; k++) c = (c & 1) === 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1
    table[n] = c >>> 0
  }
  return table
}

const CRC_TABLE = crcTable()

/** CRC-32 (IEEE 802.3 / ISO-HDLC): the checksum every PNG chunk carries. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = (CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)) >>> 0
  return (c ^ 0xffffffff) >>> 0
}

/** Adler-32: the zlib stream checksum. */
export function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % ADLER_MOD
    b = (b + a) % ADLER_MOD
  }
  return ((b << 16) | a) >>> 0
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0
  for (const part of parts) total += part.length
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

export function u32be(value: number): Uint8Array {
  return Uint8Array.from([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ])
}

/** zlib stream made only of stored (BTYPE=00) blocks: dependency free fallback. */
export function deflateStore(raw: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.from([0x78, 0x01])]
  if (raw.length === 0) parts.push(Uint8Array.from([0x01, 0x00, 0x00, 0xff, 0xff]))
  for (let offset = 0; offset < raw.length; offset += STORE_BLOCK_MAX) {
    const len = Math.min(STORE_BLOCK_MAX, raw.length - offset)
    const last = offset + len >= raw.length ? 1 : 0
    parts.push(
      Uint8Array.from([last, len & 0xff, (len >>> 8) & 0xff, ~len & 0xff, (~len >>> 8) & 0xff]),
    )
    parts.push(raw.subarray(offset, offset + len))
  }
  parts.push(u32be(adler32(raw)))
  return concatBytes(parts)
}
