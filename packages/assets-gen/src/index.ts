/** Public surface of the procedural asset generator. */
export const PACKAGE_NAME = '@voxelcraft/assets-gen'

export { blitTile, buildAtlas, enforceAlphaPolicy, type BuiltAtlas } from './atlas'
export { PNG_SIGNATURE, encodePng, type PngCompression, type PngImage } from './png'
export { assetSeed } from './seed'
export {
  REQUIRED_SOUNDS,
  SOUND_SPECS,
  SOUND_SUBDIR,
  buildSounds,
  renderSound,
  type BuiltSounds,
  type SoundSpec,
} from './sounds'
export { CUTOUT_TEXTURES, REQUIRED_TEXTURES, TRANSLUCENT_TEXTURES } from './texture-list'
export { GENERATORS, type TilePainter } from './texture-registry'
export {
  ATLAS_HEIGHT,
  ATLAS_SLOTS,
  ATLAS_WIDTH,
  TILE_PX,
  TRANSPARENT,
  TileCanvas,
  clampByte,
  desaturate,
  mix,
  rgb,
  shade,
  withAlpha,
  type Rgba,
} from './tile'
export { SOUND_SAMPLE_RATE, encodeWav } from './wav'
export {
  ASSET_OUTPUT_DIR,
  ATLAS_MANIFEST_FILE,
  ATLAS_PNG_FILE,
  SOUND_MANIFEST_FILE,
  writeAllAssets,
  type WrittenAssets,
} from './write'
export { adler32, concatBytes, crc32, deflateStore, u32be } from './zlib-lite'
