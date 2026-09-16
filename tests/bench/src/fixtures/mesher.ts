import {
  BLOCK,
  PADDED_VOLUME,
  RENDER_LAYER,
  SECTION_Y,
  VERTEX_LANE,
  VERTEX_STRIDE_U16,
  paddedIndex,
} from '@voxelcraft/core-types'
import type { MeshBuffer, MeshRequest, MeshResult } from '@voxelcraft/core-types'

/**
 * Naive fallback mesher used until @voxelcraft/client exports the real one.
 * One quad per visible face, no greedy merging: enough to measure a realistic
 * amount of per-section work, and clearly flagged in bench.json.
 */
export const FALLBACK_MESHER_VERSION = 'bench-fallback-1'

export type RenderLayerValue = (typeof RENDER_LAYER)[keyof typeof RENDER_LAYER]

export interface PaddedNeighbourhood {
  blocks: Uint16Array
  light: Uint8Array
  fluids: Uint8Array
}

/** Blocks that do not occlude the neighbouring face. */
const NON_OPAQUE = new Set<number>([
  BLOCK.AIR,
  BLOCK.WATER,
  BLOCK.WATER_FLOWING,
  BLOCK.LAVA,
  BLOCK.LAVA_FLOWING,
  BLOCK.GLASS,
])

const TRANSLUCENT = new Set<number>([
  BLOCK.WATER,
  BLOCK.WATER_FLOWING,
  BLOCK.LAVA,
  BLOCK.LAVA_FLOWING,
])

export function isOpaque(id: number): boolean {
  return id !== BLOCK.AIR && !NON_OPAQUE.has(id)
}

export function isRenderable(id: number): boolean {
  return id !== BLOCK.AIR
}

function layerOf(id: number): RenderLayerValue {
  if (TRANSLUCENT.has(id)) return RENDER_LAYER.Translucent
  if (id === BLOCK.GLASS) return RENDER_LAYER.Cutout
  return RENDER_LAYER.Opaque
}

export function createEmptyPadded(): PaddedNeighbourhood {
  return {
    blocks: new Uint16Array(PADDED_VOLUME),
    light: new Uint8Array(PADDED_VOLUME),
    fluids: new Uint8Array(PADDED_VOLUME),
  }
}

export function setPaddedBlock(
  blocks: Uint16Array,
  x: number,
  y: number,
  z: number,
  id: number,
): void {
  blocks[paddedIndex(x, y, z)] = id
}

export function fillPaddedLight(light: Uint8Array, sky: number, block: number): void {
  light.fill(((sky & 15) << 4) | (block & 15))
}

const FACE_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [-1, 0, 0],
  [1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
]

const FACE_CORNERS: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
  [
    [0, 0, 0],
    [0, 0, 1],
    [0, 1, 1],
    [0, 1, 0],
  ],
  [
    [1, 0, 1],
    [1, 0, 0],
    [1, 1, 0],
    [1, 1, 1],
  ],
  [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 1],
    [0, 0, 1],
  ],
  [
    [0, 1, 1],
    [1, 1, 1],
    [1, 1, 0],
    [0, 1, 0],
  ],
  [
    [1, 0, 0],
    [0, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
  ],
  [
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ],
]

export function countVisibleFaces(blocks: Uint16Array): number {
  let faces = 0
  for (let y = 0; y < SECTION_Y; y++) {
    for (let z = 0; z < SECTION_Y; z++) {
      for (let x = 0; x < SECTION_Y; x++) {
        const id = blocks[paddedIndex(x, y, z)]
        if (!isRenderable(id)) continue
        for (let face = 0; face < 6; face++) {
          const offset = FACE_OFFSETS[face]
          const neighbour = blocks[paddedIndex(x + offset[0], y + offset[1], z + offset[2])]
          if (neighbour === id || isOpaque(neighbour)) continue
          faces++
        }
      }
    }
  }
  return faces
}

class LayerBuilder {
  vertices = new Uint16Array(4096 * VERTEX_STRIDE_U16)
  vertexCount = 0
  indices = new Uint32Array(6144)
  indexCount = 0

  private growVertices(): void {
    const next = new Uint16Array(this.vertices.length * 2)
    next.set(this.vertices)
    this.vertices = next
  }

  private growIndices(): void {
    const next = new Uint32Array(this.indices.length * 2)
    next.set(this.indices)
    this.indices = next
  }

  pushQuad(x: number, y: number, z: number, face: number, id: number, lightByte: number): void {
    while ((this.vertexCount + 4) * VERTEX_STRIDE_U16 > this.vertices.length) this.growVertices()
    while (this.indexCount + 6 > this.indices.length) this.growIndices()

    const base = this.vertexCount
    const corners = FACE_CORNERS[face]
    for (let corner = 0; corner < 4; corner++) {
      const o = corners[corner]
      const at = (base + corner) * VERTEX_STRIDE_U16
      // Positions in 1/16 block fixed point, matching the shared vertex layout.
      this.vertices[at + VERTEX_LANE.PosX] = (x + o[0]) * 16
      this.vertices[at + VERTEX_LANE.PosY] = (y + o[1]) * 16
      this.vertices[at + VERTEX_LANE.PosZ] = (z + o[2]) * 16
      this.vertices[at + VERTEX_LANE.Reserved] = 0
      this.vertices[at + VERTEX_LANE.TexLayer] = id & 0xff
      this.vertices[at + VERTEX_LANE.NormalAo] = (face << 4) | (corner << 2) | 3
      this.vertices[at + VERTEX_LANE.Light] = lightByte
      this.vertices[at + VERTEX_LANE.Tint] = 0
    }
    this.vertexCount = base + 4

    this.indices[this.indexCount] = base
    this.indices[this.indexCount + 1] = base + 1
    this.indices[this.indexCount + 2] = base + 2
    this.indices[this.indexCount + 3] = base
    this.indices[this.indexCount + 4] = base + 2
    this.indices[this.indexCount + 5] = base + 3
    this.indexCount += 6
  }

  toBuffer(layer: RenderLayerValue): MeshBuffer {
    return {
      layer,
      interleaved: this.vertices.slice(0, this.vertexCount * VERTEX_STRIDE_U16)
        .buffer as ArrayBuffer,
      index: this.indices.slice(0, this.indexCount).buffer as ArrayBuffer,
      vertexCount: this.vertexCount,
      indexCount: this.indexCount,
    }
  }
}

export function meshSection(request: MeshRequest): MeshResult {
  const started = performance.now()
  const blocks = request.blocks
  const light = request.light
  const builders = new Map<RenderLayerValue, LayerBuilder>()
  let quads = 0

  for (let y = 0; y < SECTION_Y; y++) {
    for (let z = 0; z < SECTION_Y; z++) {
      for (let x = 0; x < SECTION_Y; x++) {
        const id = blocks[paddedIndex(x, y, z)]
        if (!isRenderable(id)) continue
        const layer = layerOf(id)
        for (let face = 0; face < 6; face++) {
          const offset = FACE_OFFSETS[face]
          const neighbourIndex = paddedIndex(x + offset[0], y + offset[1], z + offset[2])
          const neighbour = blocks[neighbourIndex]
          if (neighbour === id || isOpaque(neighbour)) continue
          let builder = builders.get(layer)
          if (builder === undefined) {
            builder = new LayerBuilder()
            builders.set(layer, builder)
          }
          builder.pushQuad(x, y, z, face, id, light[neighbourIndex])
          quads++
        }
      }
    }
  }

  const buffers: MeshBuffer[] = []
  for (const [layer, builder] of builders) {
    if (builder.vertexCount === 0) continue
    buffers.push(builder.toBuffer(layer))
  }

  return {
    key: request.key,
    cx: request.cx,
    cz: request.cz,
    sy: request.sy,
    revision: request.revision,
    buffers,
    stats: { quads, meshMs: performance.now() - started },
  }
}
