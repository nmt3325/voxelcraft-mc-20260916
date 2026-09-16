import { PERF, SECTION_Y, type MeshResult } from '@voxelcraft/core-types'
import * as THREE from 'three'
import { createAtlasTexture, fallbackAtlas, type AtlasSource } from './atlasTexture'
import { createLayerMaterials, type LayerMaterials } from './material'
import { createSectionGeometry } from './sectionMesh'

/**
 * WebGL2 voxel renderer.
 *
 * - one `THREE.Group` per meshed section, one `Mesh` per render layer
 * - uploads are budgeted (`PERF.uploadsPerFrame`) so a burst of finished mesh
 *   jobs cannot stall a frame
 * - visibility is render-distance (chebyshev, in sections) plus an explicit
 *   frustum test, which also gives the debug overlay a visible-section count
 * - day/night drives the sun direction, sky colour, ambient term and fog
 */

export interface VoxelRendererOptions {
	canvas: HTMLCanvasElement
	width?: number
	height?: number
	renderDistance?: number
	fov?: number
	atlas?: AtlasSource
	maxPixelRatio?: number
}

export interface RenderStats {
	drawCalls: number
	triangles: number
	quads: number
	sections: number
	visibleSections: number
	queuedUploads: number
	fps: number
}

interface SectionEntry {
	key: string
	cx: number
	cz: number
	sy: number
	revision: number
	quads: number
	group: THREE.Group
	bounds: THREE.Box3
}

const NIGHT_SKY = new THREE.Color(0.02, 0.03, 0.08)
const DAY_SKY = new THREE.Color(0.52, 0.72, 0.98)
const DUSK_SUN = new THREE.Color(1, 0.62, 0.36)
const DAY_SUN = new THREE.Color(1, 0.98, 0.94)
const UNDERWATER_FOG = new THREE.Color(0.1, 0.28, 0.52)

export class VoxelRenderer {
	readonly renderer: THREE.WebGLRenderer
	readonly scene: THREE.Scene
	readonly camera: THREE.PerspectiveCamera
	readonly materials: LayerMaterials

	private readonly sections = new Map<string, SectionEntry>()
	private readonly pending = new Map<string, MeshResult>()
	private readonly frustum = new THREE.Frustum()
	private readonly frustumMatrix = new THREE.Matrix4()
	private readonly skyColor = DAY_SKY.clone()
	private atlasTexture: THREE.DataArrayTexture
	private renderDistance: number
	private underwater = false
	private timeOfDay = 0.3
	private visibleSections = 0
	private totalQuads = 0
	private fps = 0

	constructor(options: VoxelRendererOptions) {
		const width = options.width ?? options.canvas.clientWidth ?? options.canvas.width
		const height = options.height ?? options.canvas.clientHeight ?? options.canvas.height
		this.renderDistance = options.renderDistance ?? PERF.renderDistanceDefault

		this.renderer = new THREE.WebGLRenderer({
			canvas: options.canvas,
			antialias: false,
			alpha: false,
			powerPreference: 'high-performance',
		})
		this.renderer.setPixelRatio(
			Math.min(globalThis.devicePixelRatio ?? 1, options.maxPixelRatio ?? 1),
		)
		this.renderer.setSize(Math.max(1, width), Math.max(1, height), false)
		// Our shaders write final colours directly, so no extra conversion.
		this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
		this.renderer.sortObjects = true

		this.scene = new THREE.Scene()
		this.scene.background = this.skyColor
		this.camera = new THREE.PerspectiveCamera(
			options.fov ?? PERF.fovDefault,
			Math.max(1, width) / Math.max(1, height),
			0.05,
			1024,
		)
		this.camera.position.set(8, SECTION_Y * 5, 8)

		this.materials = createLayerMaterials()
		this.atlasTexture = createAtlasTexture(options.atlas ?? fallbackAtlas())
		this.materials.setAtlas(this.atlasTexture)
		this.setTimeOfDay(this.timeOfDay)
	}

	setAtlas(source: AtlasSource): void {
		const next = createAtlasTexture(source)
		this.atlasTexture.dispose()
		this.atlasTexture = next
		this.materials.setAtlas(next)
	}

	resize(width: number, height: number): void {
		const w = Math.max(1, Math.floor(width))
		const h = Math.max(1, Math.floor(height))
		this.renderer.setSize(w, h, false)
		this.camera.aspect = w / h
		this.camera.updateProjectionMatrix()
	}

	setFov(fov: number): void {
		this.camera.fov = fov
		this.camera.updateProjectionMatrix()
	}

	setRenderDistance(sections: number): void {
		this.renderDistance = Math.max(
			PERF.renderDistanceMin,
			Math.min(PERF.renderDistanceMax, Math.floor(sections)),
		)
		this.applyFog()
	}

	getRenderDistance(): number {
		return this.renderDistance
	}

	/** `time` is a 0..1 fraction of the day; 0.25 is noon, 0.75 is midnight. */
	setTimeOfDay(time: number): void {
		this.timeOfDay = ((time % 1) + 1) % 1
		const angle = this.timeOfDay * Math.PI * 2
		const sunDir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0.35).normalize()
		const daylight = THREE.MathUtils.clamp(sunDir.y * 1.25 + 0.3, 0.05, 1)
		const sunColor = DUSK_SUN.clone().lerp(DAY_SUN, THREE.MathUtils.clamp(sunDir.y * 2, 0, 1))
		this.skyColor.copy(NIGHT_SKY).lerp(DAY_SKY, daylight)
		this.materials.setSun(sunDir, sunColor, 0.1 + 0.22 * daylight)
		this.applyFog()
	}

	getTimeOfDay(): number {
		return this.timeOfDay
	}

	setUnderwater(underwater: boolean): void {
		this.underwater = underwater
		this.materials.setUnderwater(underwater)
		this.applyFog()
	}

	isUnderwater(): boolean {
		return this.underwater
	}

	private applyFog(): void {
		const far = this.renderDistance * SECTION_Y * 0.95
		if (this.underwater) {
			this.materials.setFog(UNDERWATER_FOG, 2, Math.min(far, 28))
			return
		}
		this.materials.setFog(this.skyColor, far * 0.45, far)
	}

	/** Queue a finished mesh; newer revisions replace queued older ones. */
	enqueue(result: MeshResult): void {
		const queued = this.pending.get(result.key)
		if (queued !== undefined && queued.revision > result.revision) return
		const live = this.sections.get(result.key)
		if (live !== undefined && live.revision > result.revision) return
		this.pending.set(result.key, result)
	}

	removeSection(key: string): void {
		this.pending.delete(key)
		const entry = this.sections.get(key)
		if (entry === undefined) return
		this.disposeEntry(entry)
		this.sections.delete(key)
		this.totalQuads -= entry.quads
	}

	clearSections(): void {
		for (const entry of this.sections.values()) this.disposeEntry(entry)
		this.sections.clear()
		this.pending.clear()
		this.totalQuads = 0
	}

	private disposeEntry(entry: SectionEntry): void {
		this.scene.remove(entry.group)
		entry.group.traverse((object) => {
			if (object instanceof THREE.Mesh) object.geometry.dispose()
		})
		entry.group.clear()
	}

	/** Upload at most `budget` queued sections. Returns the number uploaded. */
	flushUploads(budget = PERF.uploadsPerFrame): number {
		let uploaded = 0
		for (const [key, result] of this.pending) {
			if (uploaded >= budget) break
			this.pending.delete(key)
			this.applyMesh(result)
			uploaded++
		}
		return uploaded
	}

	private applyMesh(result: MeshResult): void {
		const existing = this.sections.get(result.key)
		if (existing !== undefined) {
			this.disposeEntry(existing)
			this.sections.delete(result.key)
			this.totalQuads -= existing.quads
		}
		if (result.buffers.length === 0) return

		const group = new THREE.Group()
		group.name = result.key
		group.position.set(result.cx * SECTION_Y, result.sy * SECTION_Y, result.cz * SECTION_Y)
		group.matrixAutoUpdate = false
		group.updateMatrix()

		for (const buffer of result.buffers) {
			const mesh = new THREE.Mesh(
				createSectionGeometry(buffer),
				this.materials.materialFor(buffer.layer),
			)
			mesh.frustumCulled = false
			mesh.matrixAutoUpdate = false
			mesh.updateMatrix()
			mesh.renderOrder = buffer.layer
			group.add(mesh)
		}

		const min = new THREE.Vector3(
			result.cx * SECTION_Y,
			result.sy * SECTION_Y,
			result.cz * SECTION_Y,
		)
		const entry: SectionEntry = {
			key: result.key,
			cx: result.cx,
			cz: result.cz,
			sy: result.sy,
			revision: result.revision,
			quads: result.stats.quads,
			group,
			bounds: new THREE.Box3(
				min,
				min.clone().addScalar(SECTION_Y),
			),
		}
		this.sections.set(result.key, entry)
		this.totalQuads += entry.quads
		this.scene.add(group)
	}

	private updateVisibility(): void {
		this.camera.updateMatrixWorld()
		this.frustumMatrix.multiplyMatrices(
			this.camera.projectionMatrix,
			this.camera.matrixWorldInverse,
		)
		this.frustum.setFromProjectionMatrix(this.frustumMatrix)

		const cameraSectionX = Math.floor(this.camera.position.x / SECTION_Y)
		const cameraSectionZ = Math.floor(this.camera.position.z / SECTION_Y)
		let visible = 0
		for (const entry of this.sections.values()) {
			const distance = Math.max(
				Math.abs(entry.cx - cameraSectionX),
				Math.abs(entry.cz - cameraSectionZ),
			)
			const show = distance <= this.renderDistance && this.frustum.intersectsBox(entry.bounds)
			entry.group.visible = show
			if (show) visible++
		}
		this.visibleSections = visible
	}

	/** `deltaSeconds` is only used for the FPS estimate. */
	render(deltaSeconds = 0): void {
		this.flushUploads()
		this.updateVisibility()
		this.renderer.info.reset()
		this.renderer.render(this.scene, this.camera)
		if (deltaSeconds > 0) {
			const instant = 1 / deltaSeconds
			this.fps = this.fps === 0 ? instant : this.fps * 0.9 + instant * 0.1
		}
	}

	stats(): RenderStats {
		return {
			drawCalls: this.renderer.info.render.calls,
			triangles: this.renderer.info.render.triangles,
			quads: this.totalQuads,
			sections: this.sections.size,
			visibleSections: this.visibleSections,
			queuedUploads: this.pending.size,
			fps: Math.round(this.fps),
		}
	}

	dispose(): void {
		this.clearSections()
		this.materials.dispose()
		this.atlasTexture.dispose()
		this.renderer.dispose()
	}
}
