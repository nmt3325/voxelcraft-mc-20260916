import {
	RENDER_LAYER,
	VERTEX_STRIDE_U16,
	type MeshBuffer,
	type MeshRequest,
	type MeshResult,
	type RenderLayer,
} from '@voxelcraft/core-types'
import { appearanceOf, isOpaqueId, occludedBy } from './appearance'
import {
	PADDED_BASE,
	PADDED_STRIDE_X,
	PADDED_STRIDE_Y,
	PADDED_STRIDE_Z,
	SECTION_SIZE,
} from './padded'

/**
 * Greedy mesher (0fps slice sweep).
 *
 * For each of the 6 face directions and each of the 16 slices along that axis we
 * build a 16x16 mask of visible faces, then merge runs of identical faces into
 * rectangles. Faces only merge when texture layer, tint, render layer, packed AO
 * and packed light all match, which is what keeps `sum(w * h)` equal to the
 * number of visible faces.
 *
 * Vertex layout is the frozen contract from `core-types/mesh.ts`
 * (`VERTEX_STRIDE_U16 = 8`):
 *   0..2 position in 1/16 block units (0..256, section local)
 *   3    reserved (always 0)
 *   4    texture array layer (index into `TEXTURE_NAMES`)
 *   5    (normalId << 4) | (uvCorner << 2) | ao
 *   6    (skyLight << 4) | blockLight
 *   7    tint palette index
 *
 * UVs are derived in the vertex shader from the two tangent components of the
 * position with `RepeatWrapping`, so a merged w x h quad tiles its texture w x h
 * times without needing extra vertex lanes.
 */

export const MESHER_VERSION = 1

const S = SECTION_SIZE
const STRIDES: readonly number[] = [PADDED_STRIDE_X, PADDED_STRIDE_Y, PADDED_STRIDE_Z]
const AXIS_OF_FACE: readonly number[] = [0, 0, 1, 1, 2, 2]
const SIGN_OF_FACE: readonly number[] = [-1, 1, -1, 1, -1, 1]
/** Canonical corner order: (0,0), (1,0), (1,1), (0,1) in (u, v) space. */
const CORNER_DU: readonly number[] = [0, 1, 1, 0]
const CORNER_DV: readonly number[] = [0, 0, 1, 1]
/** Emission order keeps every quad counter-clockwise seen from outside. */
const POS_ORDER: readonly number[] = [0, 1, 2, 3]
const NEG_ORDER: readonly number[] = [0, 3, 2, 1]
const CROSS_FACES: readonly number[] = [0, 1, 4, 5]
const LAYER_ORDER: readonly RenderLayer[] = [
	RENDER_LAYER.Opaque,
	RENDER_LAYER.Cutout,
	RENDER_LAYER.Translucent,
]
/** Uint16 index buffers cannot address more than 65536 vertices. */
const MAX_VERTICES = 65532
const UNIT = 16

class LayerBuilder {
	private vertices: Uint16Array
	private indices: Uint16Array
	vertexCount = 0
	indexCount = 0
	quads = 0

	constructor(capacityQuads: number) {
		this.vertices = new Uint16Array(capacityQuads * 4 * VERTEX_STRIDE_U16)
		this.indices = new Uint16Array(capacityQuads * 6)
	}

	canPush(): boolean {
		return this.vertexCount + 4 <= MAX_VERTICES
	}

	private reserve(): void {
		if ((this.vertexCount + 4) * VERTEX_STRIDE_U16 > this.vertices.length) {
			const grown = new Uint16Array(this.vertices.length * 2)
			grown.set(this.vertices)
			this.vertices = grown
		}
		if (this.indexCount + 6 > this.indices.length) {
			const grown = new Uint16Array(this.indices.length * 2)
			grown.set(this.indices)
			this.indices = grown
		}
	}

	pushVertex(
		x: number,
		y: number,
		z: number,
		texLayer: number,
		normalAo: number,
		light: number,
		tint: number,
	): void {
		this.reserve()
		const offset = this.vertexCount * VERTEX_STRIDE_U16
		const v = this.vertices
		v[offset] = x
		v[offset + 1] = y
		v[offset + 2] = z
		v[offset + 3] = 0
		v[offset + 4] = texLayer
		v[offset + 5] = normalAo
		v[offset + 6] = light
		v[offset + 7] = tint
		this.vertexCount++
	}

	pushQuadIndices(base: number, flip: boolean): void {
		this.reserve()
		const i = this.indices
		const offset = this.indexCount
		if (flip) {
			i[offset] = base + 1
			i[offset + 1] = base + 2
			i[offset + 2] = base + 3
			i[offset + 3] = base + 1
			i[offset + 4] = base + 3
			i[offset + 5] = base
		} else {
			i[offset] = base
			i[offset + 1] = base + 1
			i[offset + 2] = base + 2
			i[offset + 3] = base
			i[offset + 4] = base + 2
			i[offset + 5] = base + 3
		}
		this.indexCount = offset + 6
		this.quads++
	}

	toBuffer(layer: RenderLayer): MeshBuffer | null {
		if (this.vertexCount === 0) return null
		const usedVertexWords = this.vertexCount * VERTEX_STRIDE_U16
		const interleaved = new ArrayBuffer(usedVertexWords * 2)
		new Uint16Array(interleaved).set(this.vertices.subarray(0, usedVertexWords))
		const index = new ArrayBuffer(this.indexCount * 2)
		new Uint16Array(index).set(this.indices.subarray(0, this.indexCount))
		return {
			layer,
			interleaved,
			index,
			vertexCount: this.vertexCount,
			indexCount: this.indexCount,
		}
	}
}

/** Contract AO formula: 3 - (side1 + side2 + corner). */
function cornerAo(blocks: Uint16Array, neighbour: number, offsetU: number, offsetV: number): number {
	const side1 = isOpaqueId(blocks[neighbour + offsetU]) ? 1 : 0
	const side2 = isOpaqueId(blocks[neighbour + offsetV]) ? 1 : 0
	const corner = isOpaqueId(blocks[neighbour + offsetU + offsetV]) ? 1 : 0
	return 3 - (side1 + side2 + corner)
}

/** Average sky/block light over the 4 non-opaque samples touching the corner. */
function cornerLight(
	blocks: Uint16Array,
	light: Uint8Array,
	neighbour: number,
	offsetU: number,
	offsetV: number,
): number {
	const i0 = neighbour
	const i1 = neighbour + offsetU
	const i2 = neighbour + offsetV
	const i3 = neighbour + offsetU + offsetV
	let sky = 0
	let block = 0
	let count = 0
	if (!isOpaqueId(blocks[i0])) {
		sky += light[i0] >> 4
		block += light[i0] & 15
		count++
	}
	if (!isOpaqueId(blocks[i1])) {
		sky += light[i1] >> 4
		block += light[i1] & 15
		count++
	}
	if (!isOpaqueId(blocks[i2])) {
		sky += light[i2] >> 4
		block += light[i2] & 15
		count++
	}
	if (!isOpaqueId(blocks[i3])) {
		sky += light[i3] >> 4
		block += light[i3] & 15
		count++
	}
	if (count === 0) return light[i0]
	return ((Math.round(sky / count) & 15) << 4) | (Math.round(block / count) & 15)
}

function emitQuad(
	builder: LayerBuilder,
	face: number,
	axis: number,
	uAxis: number,
	vAxis: number,
	order: readonly number[],
	plane: number,
	u0: number,
	uSpan: number,
	v0: number,
	vSpan: number,
	texLayer: number,
	tint: number,
	aoPacked: number,
	lightPacked: number,
): void {
	const ao0 = aoPacked & 3
	const ao1 = (aoPacked >> 2) & 3
	const ao2 = (aoPacked >> 4) & 3
	const ao3 = (aoPacked >> 6) & 3
	// Flip the triangle split so the darker diagonal stays continuous.
	const flip = ao0 + ao2 > ao1 + ao3
	const base = builder.vertexCount
	const position = [0, 0, 0]
	for (let slot = 0; slot < 4; slot++) {
		const corner = order[slot]
		position[axis] = plane
		position[uAxis] = u0 + CORNER_DU[corner] * uSpan
		position[vAxis] = v0 + CORNER_DV[corner] * vSpan
		const ao = (aoPacked >> (corner * 2)) & 3
		const lightValue = (lightPacked >>> (corner * 8)) & 0xff
		builder.pushVertex(
			position[0],
			position[1],
			position[2],
			texLayer,
			(face << 4) | (corner << 2) | ao,
			lightValue,
			tint,
		)
	}
	builder.pushQuadIndices(base, flip)
}

function nowMs(): number {
	const perf = globalThis.performance
	return typeof perf !== 'undefined' && typeof perf.now === 'function' ? perf.now() : 0
}

export interface MeshDebugInfo {
	/** Sum of w * h over every greedy quad; must equal `countVisibleFaces`. */
	faceArea: number
	greedyQuads: number
	crossQuads: number
	/** Quads skipped because the Uint16 index range was exhausted. */
	droppedQuads: number
}

export function meshSectionWithDebug(request: MeshRequest): {
	result: MeshResult
	debug: MeshDebugInfo
} {
	const started = nowMs()
	const blocks = request.blocks
	const light = request.light
	const useAo = request.flags.ao
	const smoothLight = request.flags.smoothLight

	const builders = [new LayerBuilder(512), new LayerBuilder(64), new LayerBuilder(64)]

	const maskOn = new Uint8Array(S * S)
	const maskTex = new Int32Array(S * S)
	const maskTint = new Uint8Array(S * S)
	const maskLayer = new Uint8Array(S * S)
	const maskAo = new Uint8Array(S * S)
	const maskLight = new Uint32Array(S * S)

	const sameFace = (a: number, b: number): boolean =>
		maskOn[b] === 1 &&
		maskTex[a] === maskTex[b] &&
		maskTint[a] === maskTint[b] &&
		maskLayer[a] === maskLayer[b] &&
		maskAo[a] === maskAo[b] &&
		maskLight[a] === maskLight[b]

	let faceArea = 0
	let greedyQuads = 0
	let crossQuads = 0
	let droppedQuads = 0

	for (let face = 0; face < 6; face++) {
		const axis = AXIS_OF_FACE[face]
		const sign = SIGN_OF_FACE[face]
		const uAxis = (axis + 1) % 3
		const vAxis = (axis + 2) % 3
		const strideD = STRIDES[axis]
		const strideU = STRIDES[uAxis]
		const strideV = STRIDES[vAxis]
		const order = sign > 0 ? POS_ORDER : NEG_ORDER

		for (let slice = 0; slice < S; slice++) {
			maskOn.fill(0)
			let anyFace = false
			const sliceBase = PADDED_BASE + slice * strideD
			for (let jv = 0; jv < S; jv++) {
				for (let ju = 0; ju < S; ju++) {
					const cell = sliceBase + ju * strideU + jv * strideV
					const id = blocks[cell]
					if (id === 0) continue
					const appearance = appearanceOf(id)
					if (!appearance || !appearance.fullCube) continue
					const neighbour = cell + sign * strideD
					if (occludedBy(appearance, blocks[neighbour])) continue
					const m = jv * S + ju
					anyFace = true
					maskOn[m] = 1
					maskTex[m] = appearance.faces[face]
					maskTint[m] = appearance.faceTints[face]
					maskLayer[m] = appearance.layer
					let aoPacked = 0
					let lightPacked = 0
					for (let corner = 0; corner < 4; corner++) {
						const offsetU = (CORNER_DU[corner] === 0 ? -1 : 1) * strideU
						const offsetV = (CORNER_DV[corner] === 0 ? -1 : 1) * strideV
						const ao = useAo ? cornerAo(blocks, neighbour, offsetU, offsetV) : 3
						aoPacked |= ao << (corner * 2)
						const lightValue = smoothLight
							? cornerLight(blocks, light, neighbour, offsetU, offsetV)
							: light[neighbour]
						lightPacked = (lightPacked | (lightValue << (corner * 8))) >>> 0
					}
					maskAo[m] = aoPacked
					maskLight[m] = lightPacked
				}
			}
			if (!anyFace) continue

			for (let jv = 0; jv < S; jv++) {
				let ju = 0
				while (ju < S) {
					const m = jv * S + ju
					if (maskOn[m] === 0) {
						ju++
						continue
					}
					let width = 1
					while (ju + width < S && sameFace(m, jv * S + ju + width)) width++
					let height = 1
					while (jv + height < S) {
						let rowMatches = true
						const rowBase = (jv + height) * S + ju
						for (let k = 0; k < width; k++) {
							if (!sameFace(m, rowBase + k)) {
								rowMatches = false
								break
							}
						}
						if (!rowMatches) break
						height++
					}
					const builder = builders[maskLayer[m]]
					if (builder.canPush()) {
						emitQuad(
							builder,
							face,
							axis,
							uAxis,
							vAxis,
							order,
							(slice + (sign > 0 ? 1 : 0)) * UNIT,
							ju * UNIT,
							width * UNIT,
							jv * UNIT,
							height * UNIT,
							maskTex[m],
							maskTint[m],
							maskAo[m],
							maskLight[m],
						)
						faceArea += width * height
						greedyQuads++
					} else {
						droppedQuads++
					}
					for (let dv = 0; dv < height; dv++) {
						const rowBase = (jv + dv) * S + ju
						for (let du = 0; du < width; du++) maskOn[rowBase + du] = 0
					}
					ju += width
				}
			}
		}
	}

	// Plants, torches and other non-cube blocks: two axis aligned quads through
	// the middle of the voxel, emitted for both facings so they are visible from
	// every side without relying on two-sided rasterisation.
	const cellCoords = [0, 0, 0]
	for (let y = 0; y < S; y++) {
		for (let z = 0; z < S; z++) {
			for (let x = 0; x < S; x++) {
				const index =
					PADDED_BASE + x * PADDED_STRIDE_X + y * PADDED_STRIDE_Y + z * PADDED_STRIDE_Z
				const id = blocks[index]
				if (id === 0) continue
				const appearance = appearanceOf(id)
				if (!appearance || !appearance.cross) continue
				const builder = builders[appearance.layer]
				const lightValue = light[index]
				const lightPacked =
					(lightValue | (lightValue << 8) | (lightValue << 16) | (lightValue << 24)) >>> 0
				cellCoords[0] = x
				cellCoords[1] = y
				cellCoords[2] = z
				for (const face of CROSS_FACES) {
					if (!builder.canPush()) {
						droppedQuads++
						continue
					}
					const axis = AXIS_OF_FACE[face]
					const uAxis = (axis + 1) % 3
					const vAxis = (axis + 2) % 3
					emitQuad(
						builder,
						face,
						axis,
						uAxis,
						vAxis,
						SIGN_OF_FACE[face] > 0 ? POS_ORDER : NEG_ORDER,
						cellCoords[axis] * UNIT + UNIT / 2,
						cellCoords[uAxis] * UNIT,
						UNIT,
						cellCoords[vAxis] * UNIT,
						UNIT,
						appearance.faces[face],
						appearance.faceTints[face],
						0xff,
						lightPacked,
					)
					crossQuads++
				}
			}
		}
	}

	const buffers: MeshBuffer[] = []
	let quads = 0
	for (let i = 0; i < LAYER_ORDER.length; i++) {
		const builder = builders[i]
		quads += builder.quads
		const buffer = builder.toBuffer(LAYER_ORDER[i])
		if (buffer) buffers.push(buffer)
	}

	const result: MeshResult = {
		key: request.key,
		cx: request.cx,
		cz: request.cz,
		sy: request.sy,
		revision: request.revision,
		buffers,
		stats: { quads, meshMs: nowMs() - started },
	}
	return { result, debug: { faceArea, greedyQuads, crossQuads, droppedQuads } }
}

export function meshSection(request: MeshRequest): MeshResult {
	return meshSectionWithDebug(request).result
}
