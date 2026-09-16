import { PADDED, PADDED_VOLUME, paddedIndex, type MeshFlags, type MeshRequest } from '@voxelcraft/core-types'
import { appearanceOf, occludedBy } from './appearance'

/**
 * Padded (18^3) section input helpers.
 *
 * The mesher never reads neighbouring chunks: callers copy a 16^3 section plus a
 * one voxel skirt into these arrays, which is what makes meshing a pure
 * function and lets it run inside a worker.
 */

export const SECTION_SIZE = 16
export const PADDED_SIZE = PADDED

/** Index of interior voxel (0,0,0). */
export const PADDED_BASE = 1 + PADDED + PADDED * PADDED
/** Index strides per axis (x, y, z). */
export const PADDED_STRIDE_X = 1
export const PADDED_STRIDE_Y = PADDED * PADDED
export const PADDED_STRIDE_Z = PADDED

export interface PaddedSection {
	blocks: Uint16Array
	light: Uint8Array
	fluids: Uint8Array
}

/** Same layout as `paddedIndex` from the contract, expressed with strides. */
export function paddedOffset(x: number, y: number, z: number): number {
	return PADDED_BASE + x * PADDED_STRIDE_X + y * PADDED_STRIDE_Y + z * PADDED_STRIDE_Z
}

export function createEmptyPadded(): PaddedSection {
	return {
		blocks: new Uint16Array(PADDED_VOLUME),
		light: new Uint8Array(PADDED_VOLUME),
		fluids: new Uint8Array(PADDED_VOLUME),
	}
}

export function setPaddedBlock(blocks: Uint16Array, x: number, y: number, z: number, id: number): void {
	blocks[paddedIndex(x, y, z)] = id
}

export function getPaddedBlock(blocks: Uint16Array, x: number, y: number, z: number): number {
	return blocks[paddedIndex(x, y, z)]
}

export function setPaddedLight(
	light: Uint8Array,
	x: number,
	y: number,
	z: number,
	sky: number,
	block: number,
): void {
	light[paddedIndex(x, y, z)] = ((sky & 15) << 4) | (block & 15)
}

/** Fill the whole padded light array with a uniform (sky, block) pair. */
export function fillPaddedLight(light: Uint8Array, sky: number, block: number): void {
	light.fill(((sky & 15) << 4) | (block & 15))
}

const FACE_OFFSETS: readonly number[] = [
	-PADDED_STRIDE_X,
	PADDED_STRIDE_X,
	-PADDED_STRIDE_Y,
	PADDED_STRIDE_Y,
	-PADDED_STRIDE_Z,
	PADDED_STRIDE_Z,
]

/**
 * Number of visible full-cube faces in the interior of the section.
 *
 * This is the reference value for the merge invariant: the sum of `w * h` over
 * all greedy quads must equal this count. It deliberately shares `occludedBy`
 * with the mesher so both agree on what "visible" means.
 */
export function countVisibleFaces(blocks: Uint16Array): number {
	let total = 0
	for (let y = 0; y < SECTION_SIZE; y++) {
		for (let z = 0; z < SECTION_SIZE; z++) {
			for (let x = 0; x < SECTION_SIZE; x++) {
				const index = paddedOffset(x, y, z)
				const id = blocks[index]
				if (id === 0) continue
				const appearance = appearanceOf(id)
				if (!appearance || !appearance.fullCube) continue
				for (let face = 0; face < 6; face++) {
					if (!occludedBy(appearance, blocks[index + FACE_OFFSETS[face]])) total++
				}
			}
		}
	}
	return total
}

export interface SectionSampler {
	/** Block id at world coordinates; return 0 (air) outside the world. */
	block(x: number, y: number, z: number): number
	/** Packed (sky << 4) | block light; defaults to full sky light. */
	light?(x: number, y: number, z: number): number
	fluid?(x: number, y: number, z: number): number
}

/** Copy a section plus its one voxel skirt out of a world sampler. */
export function fillPaddedFromSampler(
	target: PaddedSection,
	originX: number,
	originY: number,
	originZ: number,
	sampler: SectionSampler,
): PaddedSection {
	const { blocks, light, fluids } = target
	for (let y = -1; y <= SECTION_SIZE; y++) {
		for (let z = -1; z <= SECTION_SIZE; z++) {
			for (let x = -1; x <= SECTION_SIZE; x++) {
				const index = paddedOffset(x, y, z)
				const wx = originX + x
				const wy = originY + y
				const wz = originZ + z
				blocks[index] = sampler.block(wx, wy, wz)
				light[index] = sampler.light ? sampler.light(wx, wy, wz) : 0xf0
				fluids[index] = sampler.fluid ? sampler.fluid(wx, wy, wz) : 0
			}
		}
	}
	return target
}

export const DEFAULT_MESH_FLAGS: MeshFlags = { ao: true, smoothLight: true }

export function createMeshRequest(args: {
	key: string
	cx: number
	cz: number
	sy: number
	revision: number
	padded: PaddedSection
	flags?: MeshFlags
}): MeshRequest {
	return {
		key: args.key,
		cx: args.cx,
		cz: args.cz,
		sy: args.sy,
		revision: args.revision,
		blocks: args.padded.blocks,
		light: args.padded.light,
		fluids: args.padded.fluids,
		flags: args.flags ?? DEFAULT_MESH_FLAGS,
	}
}
