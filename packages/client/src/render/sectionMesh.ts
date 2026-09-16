import { SECTION_Y, VERTEX_STRIDE_U16, VERTEX_LANE, type MeshBuffer } from '@voxelcraft/core-types'
import * as THREE from 'three'

/**
 * Turns a mesher `MeshBuffer` into a three.js geometry without copying:
 * the interleaved Uint16 vertex stream is uploaded once and every attribute is
 * an `InterleavedBufferAttribute` view into it.
 *
 * Bounding volumes are set by hand in *block* units (0..16) rather than being
 * computed from the raw attribute values (0..256 in 1/16 block units), because
 * the vertex shader divides positions by 16. Computing them would make every
 * section 16x too large for frustum culling.
 */

const SECTION_SPAN = SECTION_Y
const HALF = SECTION_SPAN / 2

export function createSectionGeometry(buffer: MeshBuffer): THREE.BufferGeometry {
	const geometry = new THREE.BufferGeometry()
	const vertices = new THREE.InterleavedBuffer(
		new Uint16Array(buffer.interleaved),
		VERTEX_STRIDE_U16,
	)

	geometry.setAttribute(
		'position',
		new THREE.InterleavedBufferAttribute(vertices, 3, VERTEX_LANE.PosX, false),
	)
	geometry.setAttribute(
		'aTexLayer',
		new THREE.InterleavedBufferAttribute(vertices, 1, VERTEX_LANE.TexLayer, false),
	)
	geometry.setAttribute(
		'aNormalAo',
		new THREE.InterleavedBufferAttribute(vertices, 1, VERTEX_LANE.NormalAo, false),
	)
	geometry.setAttribute(
		'aLight',
		new THREE.InterleavedBufferAttribute(vertices, 1, VERTEX_LANE.Light, false),
	)
	geometry.setAttribute(
		'aTint',
		new THREE.InterleavedBufferAttribute(vertices, 1, VERTEX_LANE.Tint, false),
	)
	geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(buffer.index), 1))
	geometry.setDrawRange(0, buffer.indexCount)

	geometry.boundingBox = new THREE.Box3(
		new THREE.Vector3(0, 0, 0),
		new THREE.Vector3(SECTION_SPAN, SECTION_SPAN, SECTION_SPAN),
	)
	geometry.boundingSphere = new THREE.Sphere(
		new THREE.Vector3(HALF, HALF, HALF),
		Math.sqrt(3) * HALF,
	)
	return geometry
}

export function disposeGeometry(geometry: THREE.BufferGeometry): void {
	geometry.dispose()
}
