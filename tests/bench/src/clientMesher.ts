import type { MeshRequest, MeshResult } from '@voxelcraft/core-types'
import {
  FALLBACK_MESHER_VERSION,
  countVisibleFaces,
  createEmptyPadded,
  fillPaddedLight,
  meshSection,
  setPaddedBlock,
  type PaddedNeighbourhood,
} from './fixtures/mesher'

export interface MesherApi {
  meshSection(request: MeshRequest): MeshResult
  createEmptyPadded(): PaddedNeighbourhood
  setPaddedBlock(blocks: Uint16Array, x: number, y: number, z: number, id: number): void
  fillPaddedLight(light: Uint8Array, sky: number, block: number): void
  countVisibleFaces(blocks: Uint16Array): number
  MESHER_VERSION: string | number
}

export interface LoadedMesher {
  api: MesherApi
  source: 'client' | 'bench-fallback'
  version: string
  reason?: string
}

const fallback: MesherApi = {
  meshSection,
  createEmptyPadded,
  setPaddedBlock,
  fillPaddedLight,
  countVisibleFaces,
  MESHER_VERSION: FALLBACK_MESHER_VERSION,
}

const REQUIRED = [
  'meshSection',
  'createEmptyPadded',
  'setPaddedBlock',
  'fillPaddedLight',
  'countVisibleFaces',
] as const

/**
 * Prefers the real mesher from @voxelcraft/client (owned by client-a) and falls
 * back to the local naive implementation while those exports do not exist yet.
 */
export async function loadMesher(): Promise<LoadedMesher> {
  try {
    const mod = (await import('@voxelcraft/client')) as unknown as Partial<MesherApi>
    const missing = REQUIRED.filter((name) => typeof mod[name] !== 'function')
    if (missing.length === 0) {
      return {
        api: mod as MesherApi,
        source: 'client',
        version: String(mod.MESHER_VERSION ?? 'unknown'),
      }
    }
    return {
      api: fallback,
      source: 'bench-fallback',
      version: FALLBACK_MESHER_VERSION,
      reason: `@voxelcraft/client does not export ${missing.join(', ')} yet`,
    }
  } catch (error) {
    return {
      api: fallback,
      source: 'bench-fallback',
      version: FALLBACK_MESHER_VERSION,
      reason: `importing @voxelcraft/client failed: ${String(error)}`,
    }
  }
}
