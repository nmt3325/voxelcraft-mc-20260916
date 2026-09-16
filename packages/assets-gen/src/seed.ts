/** FNV-1a 32 bit over an asset name: a stable per-asset seed for the core-types hashes. */
export function assetSeed(name: string): number {
  let h = 0x811c9dc5 >>> 0
  for (let i = 0; i < name.length; i++) {
    h = (h ^ name.charCodeAt(i)) >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}
