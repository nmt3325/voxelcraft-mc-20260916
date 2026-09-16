/**
 * One-draw-call particle batch.
 *
 * Every live particle is one point in a single `THREE.Points` object: position,
 * colour, size and fade live in preallocated attributes, and `sync()` only
 * rewrites the live prefix and moves the draw range. Nothing here touches a
 * WebGL context at import or construction time, so the pool tests run in plain
 * node without a GL implementation.
 */
import { PARTICLE_BUDGET } from '@voxelcraft/core-types'
import * as THREE from 'three'
import { PARTICLE_KIND_IDS, PARTICLE_KINDS } from './kinds'
import { PARTICLE_LANE, type ParticlePool } from './pool'

const CAPACITY = PARTICLE_BUDGET.maxAlive
const FLOATS = PARTICLE_BUDGET.floatsPerParticle

function buildColorLut(): Float32Array {
	let highest = 0
	for (const id of PARTICLE_KIND_IDS) highest = Math.max(highest, id)
	const lut = new Float32Array((highest + 1) * 3)
	for (const id of PARTICLE_KIND_IDS) {
		const hex = PARTICLE_KINDS[id].color
		lut[id * 3] = ((hex >> 16) & 0xff) / 255
		lut[id * 3 + 1] = ((hex >> 8) & 0xff) / 255
		lut[id * 3 + 2] = (hex & 0xff) / 255
	}
	return lut
}

/** rgb triplets indexed by particle id, built once per module load. */
const COLOR_LUT = buildColorLut()

const VERTEX_SHADER = `
uniform float uPixelScale;
attribute vec3 aColor;
attribute float aSize;
attribute float aFade;
varying vec3 vColor;
varying float vFade;
void main() {
	vColor = aColor;
	vFade = aFade;
	vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
	gl_PointSize = max(1.0, aSize * uPixelScale / max(0.0001, -viewPos.z));
	gl_Position = projectionMatrix * viewPos;
}
`

const FRAGMENT_SHADER = `
varying vec3 vColor;
varying float vFade;
void main() {
	vec2 offset = gl_PointCoord - vec2(0.5);
	if (dot(offset, offset) > 0.25) discard;
	gl_FragColor = vec4(vColor, vFade);
}
`

export interface ParticleRendererOptions {
	/** Multiplier turning world-space size into point size. */
	readonly pixelScale?: number
	/** Additive blending suits sparks and flames; pass false for soft smoke. */
	readonly additive?: boolean
}

export class ParticleRenderer {
	readonly points: THREE.Points
	private readonly geometry = new THREE.BufferGeometry()
	private readonly material: THREE.ShaderMaterial
	private readonly positions = new Float32Array(CAPACITY * 3)
	private readonly colors = new Float32Array(CAPACITY * 3)
	private readonly sizes = new Float32Array(CAPACITY)
	private readonly fades = new Float32Array(CAPACITY)
	private readonly positionAttr: THREE.BufferAttribute
	private readonly colorAttr: THREE.BufferAttribute
	private readonly sizeAttr: THREE.BufferAttribute
	private readonly fadeAttr: THREE.BufferAttribute
	private visible = 0
	private disposed = false

	constructor(options: ParticleRendererOptions = {}) {
		this.positionAttr = new THREE.BufferAttribute(this.positions, 3)
		this.colorAttr = new THREE.BufferAttribute(this.colors, 3)
		this.sizeAttr = new THREE.BufferAttribute(this.sizes, 1)
		this.fadeAttr = new THREE.BufferAttribute(this.fades, 1)
		for (const attr of [this.positionAttr, this.colorAttr, this.sizeAttr, this.fadeAttr]) {
			attr.setUsage(THREE.DynamicDrawUsage)
		}
		this.geometry.setAttribute('position', this.positionAttr)
		this.geometry.setAttribute('aColor', this.colorAttr)
		this.geometry.setAttribute('aSize', this.sizeAttr)
		this.geometry.setAttribute('aFade', this.fadeAttr)
		this.geometry.setDrawRange(0, 0)
		this.material = new THREE.ShaderMaterial({
			uniforms: { uPixelScale: { value: options.pixelScale ?? 220 } },
			vertexShader: VERTEX_SHADER,
			fragmentShader: FRAGMENT_SHADER,
			transparent: true,
			depthWrite: false,
			blending: options.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
		})
		this.points = new THREE.Points(this.geometry, this.material)
		this.points.name = 'particles'
		// Particles move every tick; skip per-frame bounds recomputation.
		this.points.frustumCulled = false
	}

	/** Add this to the scene once; it is the only object the batch needs. */
	get object(): THREE.Object3D {
		return this.points
	}

	get visibleCount(): number {
		return this.visible
	}

	/** Always one batched draw, or none when nothing is alive. */
	get drawCalls(): number {
		return this.visible > 0 ? 1 : 0
	}

	/** Copy the pool's live prefix into the attributes. Returns point count. */
	sync(pool: ParticlePool): number {
		if (this.disposed) return 0
		const live = Math.min(pool.aliveCount, CAPACITY)
		const lanes = pool.data
		for (let i = 0; i < live; i++) {
			const base = i * FLOATS
			const p = i * 3
			this.positions[p] = lanes[base + PARTICLE_LANE.x]
			this.positions[p + 1] = lanes[base + PARTICLE_LANE.y]
			this.positions[p + 2] = lanes[base + PARTICLE_LANE.z]
			const c = lanes[base + PARTICLE_LANE.kind] * 3
			this.colors[p] = COLOR_LUT[c]
			this.colors[p + 1] = COLOR_LUT[c + 1]
			this.colors[p + 2] = COLOR_LUT[c + 2]
			this.sizes[i] = lanes[base + PARTICLE_LANE.size]
			const lifetime = pool.lifetimeAt(i)
			const age = lanes[base + PARTICLE_LANE.age]
			this.fades[i] = lifetime > 0 ? Math.max(0, 1 - age / lifetime) : 1
		}
		this.positionAttr.needsUpdate = true
		this.colorAttr.needsUpdate = true
		this.sizeAttr.needsUpdate = true
		this.fadeAttr.needsUpdate = true
		this.geometry.setDrawRange(0, live)
		this.visible = live
		return live
	}

	/** Release the geometry and material. Safe to call twice. */
	dispose(): void {
		if (this.disposed) return
		this.disposed = true
		this.visible = 0
		this.geometry.setDrawRange(0, 0)
		this.geometry.dispose()
		this.material.dispose()
	}
}
