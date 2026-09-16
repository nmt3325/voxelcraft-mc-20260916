/**
 * The game's voxel world.
 *
 * Nothing in here is a fixture:
 *  - terrain, caves, ores and decoration come from `@voxelcraft/world`
 *  - storage, light bytes, revisions and dirty sections are the `SimVoxelWorld`
 *    of `@voxelcraft/sim`, which also owns light and fluid propagation
 *  - chunk payloads use the frozen v1 codec of `@voxelcraft/gameplay`
 *  - mesher inputs are built with the padded helpers of `@voxelcraft/client`
 *
 * `decorate` may cross a chunk border, so a chunk is only decorated once its
 * whole 3x3 terrain neighbourhood exists. Decoration is a pure function of the
 * seed and therefore never marks a chunk as modified: only player edits and
 * restored saves do, and those are exactly the chunks that must be written
 * back. Decoration writes into an already modified chunk are dropped, so a
 * reloaded world stays identical to the one that was saved even when a tree
 * from a freshly generated neighbour would reach into it.
 */
import {
	BLOCK,
	CHUNK_X,
	CHUNK_Y,
	CHUNK_Z,
	SEA_LEVEL,
	SECTIONS_PER_CHUNK,
	SECTION_Y,
	blockIndex,
	chunkKey,
	hashBuffer,
	sectionKey,
	worldToChunk,
	type BlockId,
	type ChunkData,
	type ChunkPos,
	type ColumnSample,
	type MeshRequest,
	type VoxelEditView,
	type WorldGenerator,
} from '@voxelcraft/core-types'
import { createEmptyPadded, createMeshRequest, fillPaddedFromSampler } from '@voxelcraft/client'
import {
	applySnapshotToChunk,
	canDecodeChunk,
	decodeChunkAt,
	encodeChunk,
	sectionMaskOf,
	snapshotFromChunk,
} from '@voxelcraft/gameplay'
import {
	createSimVoxelWorld,
	fluidCreateEngine,
	lightCreateEngine,
	lightPropsOf,
	type FluidEngineInstance,
	type LightEngineInstance,
	type SimVoxelWorld,
} from '@voxelcraft/sim'
import { biomeDef, createWorldGenerator } from '@voxelcraft/world'

/** Payload source for chunks that were written by an earlier session. */
export interface ChunkStoreSource {
	/** True when the save index holds this chunk. */
	has(cx: number, cz: number): boolean
	load(cx: number, cz: number): Promise<Uint8Array | undefined>
}

export interface ChunkWorldOptions {
	seed: number
	source?: ChunkStoreSource
}

export interface SectionRef {
	cx: number
	cz: number
	sy: number
}

export interface StreamBudget {
	/** Chunks whose terrain may be generated or restored in this call. */
	terrain: number
	/** Chunks that may be decorated (and lit) in this call. */
	decorate: number
}

export interface ChunkPayload {
	cx: number
	cz: number
	data: Uint8Array
}

const SECTION_MASK_ALL = (1 << SECTIONS_PER_CHUNK) - 1
const LIGHT_DIRTY_TRIPLES = 256
const SPAWN_SEARCH_RADIUS = 7

/** `skyPassThrough` per block id, so a heightmap rebuild is a typed-array scan. */
const SKY_PASS_THROUGH = ((): Uint8Array => {
	const table = new Uint8Array(256)
	for (let id = 0; id < table.length; id++) table[id] = lightPropsOf(id).skyPassThrough ? 1 : 0
	return table
})()

const OFFSETS = new Map<number, ReadonlyArray<readonly [number, number]>>()

/** Chunk offsets ordered by chebyshev distance, so loading grows outwards. */
function offsetsFor(radius: number): ReadonlyArray<readonly [number, number]> {
	const cached = OFFSETS.get(radius)
	if (cached !== undefined) return cached
	const out: Array<readonly [number, number]> = []
	for (let dz = -radius; dz <= radius; dz++) {
		for (let dx = -radius; dx <= radius; dx++) out.push([dx, dz])
	}
	out.sort((a, b) => {
		const da = Math.max(Math.abs(a[0]), Math.abs(a[1]))
		const db = Math.max(Math.abs(b[0]), Math.abs(b[1]))
		if (da !== db) return da - db
		if (a[1] !== b[1]) return a[1] - b[1]
		return a[0] - b[0]
	})
	OFFSETS.set(radius, out)
	return out
}

/** Chebyshev distance in chunks. */
export function chunkDistance(ax: number, az: number, bx: number, bz: number): number {
	return Math.max(Math.abs(ax - bx), Math.abs(az - bz))
}

export class ChunkWorld {
	readonly seed: number
	readonly generator: WorldGenerator
	readonly voxels: SimVoxelWorld
	readonly light: LightEngineInstance
	readonly fluids: FluidEngineInstance

	private readonly source: ChunkStoreSource | null
	private readonly terrainReady = new Set<string>()
	private readonly decorated = new Set<string>()
	/** Chunks that diverged from pristine generation, i.e. the ones to save. */
	private readonly modified = new Set<string>()
	private readonly restoring = new Set<string>()
	private readonly sectionRevision = new Map<string, number>()
	private readonly sectionMasks = new Map<string, number>()
	private readonly lightDirty = new Int32Array(LIGHT_DIRTY_TRIPLES * 3)
	private readonly decorationView: VoxelEditView

	constructor(options: ChunkWorldOptions) {
		this.seed = options.seed >>> 0
		this.source = options.source ?? null
		this.generator = createWorldGenerator(this.seed)
		this.voxels = createSimVoxelWorld()
		this.light = lightCreateEngine({ world: this.voxels })
		this.fluids = fluidCreateEngine({ world: this.voxels })

		const voxels = this.voxels
		const blocked = (x: number, z: number): boolean =>
			this.modified.has(chunkKey(worldToChunk(x), worldToChunk(z)))
		this.decorationView = {
			getBlock: (x, y, z) => voxels.getBlock(x, y, z),
			getFluid: (x, y, z) => voxels.getFluid(x, y, z),
			isSolid: (x, y, z) => voxels.isSolid(x, y, z),
			isLiquid: (x, y, z) => voxels.isLiquid(x, y, z),
			isLoaded: (cx, cz) => voxels.isLoaded(cx, cz),
			setBlock: (x, y, z, id) => {
				if (blocked(x, z)) return
				voxels.setBlock(x, y, z, id)
				if (id !== BLOCK.AIR) this.orSectionMask(x, y, z)
			},
			setFluid: (x, y, z, packed) => {
				if (blocked(x, z)) return
				voxels.setFluid(x, y, z, packed)
				if (packed !== 0) this.orSectionMask(x, y, z)
			},
		}
	}

	// --- generation ---------------------------------------------------------

	hasTerrain(cx: number, cz: number): boolean {
		return this.terrainReady.has(chunkKey(cx, cz))
	}

	isDecorated(cx: number, cz: number): boolean {
		return this.decorated.has(chunkKey(cx, cz))
	}

	isModified(cx: number, cz: number): boolean {
		return this.modified.has(chunkKey(cx, cz))
	}

	get loadedChunks(): number {
		return this.voxels.chunks.size
	}

	/** Bedrock, stone, biome surface, ocean, caves and ores for one chunk. */
	generateTerrain(cx: number, cz: number): boolean {
		const key = chunkKey(cx, cz)
		if (this.terrainReady.has(key)) return false
		const chunk = this.voxels.ensureChunk(cx, cz)
		this.generator.generateChunk(cx, cz, chunk.blocks, chunk.fluids)
		this.refreshHeightmap(chunk)
		chunk.generated = true
		chunk.lit = false
		chunk.dirtyForSave = false
		chunk.dirtySections = SECTION_MASK_ALL
		this.sectionMasks.set(key, sectionMaskOf(chunk.blocks, chunk.fluids))
		this.terrainReady.add(key)
		return true
	}

	/**
	 * Trees and plants for one chunk, then a full light seed for it. Returns
	 * false while the 3x3 terrain neighbourhood is still incomplete.
	 */
	decorate(cx: number, cz: number): boolean {
		const key = chunkKey(cx, cz)
		if (this.decorated.has(key) || !this.terrainReady.has(key)) return false
		for (const [dx, dz] of offsetsFor(1)) {
			if (!this.terrainReady.has(chunkKey(cx + dx, cz + dz))) return false
		}
		this.generator.decorate(cx, cz, this.decorationView)
		this.decorated.add(key)
		this.light.seedChunk(cx, cz)
		const chunk = this.voxels.getChunk(cx, cz)
		if (chunk !== undefined) chunk.lit = true
		return true
	}

	/** Cross-chunk light repropagation. Cheap enough to run once per frame. */
	stitchLight(passes?: number): void {
		this.light.stitchBoundaries(passes)
	}

	// --- persistence bridge -------------------------------------------------

	/** Loads a saved chunk instead of generating it. */
	async restoreFromStore(cx: number, cz: number): Promise<boolean> {
		const key = chunkKey(cx, cz)
		if (this.terrainReady.has(key) || this.restoring.has(key)) return false
		if (this.source === null || !this.source.has(cx, cz)) return false
		this.restoring.add(key)
		try {
			const bytes = await this.source.load(cx, cz)
			if (bytes === undefined || !canDecodeChunk(bytes)) return false
			if (this.terrainReady.has(key)) return false
			this.applyChunkBytes(cx, cz, bytes)
			return true
		} finally {
			this.restoring.delete(key)
		}
	}

	/** Applies a stored payload and marks the chunk authoritative. */
	applyChunkBytes(cx: number, cz: number, bytes: Uint8Array): void {
		const snapshot = decodeChunkAt(bytes, cx, cz)
		const chunk = this.voxels.ensureChunk(cx, cz)
		applySnapshotToChunk(snapshot, chunk)
		this.refreshHeightmap(chunk)
		const key = chunkKey(cx, cz)
		this.terrainReady.add(key)
		this.decorated.add(key)
		this.modified.add(key)
		this.sectionMasks.set(key, sectionMaskOf(chunk.blocks, chunk.fluids))
		this.light.seedChunk(cx, cz)
		chunk.lit = true
	}

	/** Chunks that have to be written back, in a deterministic order. */
	modifiedChunks(): ChunkPos[] {
		const out: ChunkPos[] = []
		for (const chunk of this.voxels.orderedChunks()) {
			if (this.modified.has(chunkKey(chunk.cx, chunk.cz))) out.push({ cx: chunk.cx, cz: chunk.cz })
		}
		return out
	}

	chunkBytes(cx: number, cz: number): Uint8Array | null {
		const chunk = this.voxels.getChunk(cx, cz)
		if (chunk === undefined) return null
		return encodeChunk(snapshotFromChunk(chunk))
	}

	/** Encoded payloads for every modified chunk. */
	savePayloads(): ChunkPayload[] {
		const out: ChunkPayload[] = []
		for (const pos of this.modifiedChunks()) {
			const data = this.chunkBytes(pos.cx, pos.cz)
			if (data !== null) out.push({ cx: pos.cx, cz: pos.cz, data })
		}
		return out
	}

	// --- reads and edits ----------------------------------------------------

	blockAt(x: number, y: number, z: number): BlockId {
		return this.voxels.getBlock(x, y, z)
	}

	fluidAt(x: number, y: number, z: number): number {
		return this.voxels.getFluid(x, y, z)
	}

	column(wx: number, wz: number): ColumnSample {
		return this.generator.sampleColumn(wx, wz)
	}

	biomeNameAt(wx: number, wz: number): string {
		return biomeDef(this.generator.biomeAt(wx, wz)).displayName
	}

	/**
	 * Writes one voxel and tells the light and fluid engines about it. Returns
	 * false when nothing changed or the chunk is not loaded, so callers can keep
	 * their sounds and statistics honest.
	 */
	setBlock(x: number, y: number, z: number, id: BlockId): boolean {
		if (y < 0 || y >= CHUNK_Y) return false
		const cx = worldToChunk(x)
		const cz = worldToChunk(z)
		if (!this.terrainReady.has(chunkKey(cx, cz))) return false
		const before = this.voxels.getBlock(x, y, z)
		if (before === id) return false
		const beforeProps = lightPropsOf(before)
		this.voxels.setBlock(x, y, z, id)
		// A block edit also clears whatever fluid used to sit in the voxel; the
		// fluid engine refills it from the neighbours if that is what the rules say.
		if (id !== BLOCK.WATER && id !== BLOCK.LAVA && this.voxels.getFluid(x, y, z) !== 0) {
			this.voxels.setFluid(x, y, z, 0)
		}
		this.modified.add(chunkKey(cx, cz))
		if (id !== BLOCK.AIR) this.orSectionMask(x, y, z)
		this.light.onBlockChanged(x, y, z, beforeProps, lightPropsOf(id))
		this.fluids.onNeighborChanged(x, y, z)
		return true
	}

	// --- meshing ------------------------------------------------------------

	/** Turns light and edit dirt into per-section revisions. Once per frame. */
	pumpDirty(): void {
		const triples = this.light.drainDirtySections(this.lightDirty)
		for (let i = 0; i < triples; i++) {
			this.bumpSections(
				this.lightDirty[i * 3],
				this.lightDirty[i * 3 + 1],
				this.lightDirty[i * 3 + 2],
			)
		}
		for (const chunk of this.voxels.chunks.values()) {
			if (chunk.dirtySections === 0) continue
			this.bumpSections(chunk.cx, chunk.cz, chunk.dirtySections)
			chunk.dirtySections = 0
		}
	}

	/** Monotonic per-section revision; stale mesher results are dropped by it. */
	revisionOf(cx: number, cz: number, sy: number): number {
		return this.sectionRevision.get(sectionKey(cx, cz, sy)) ?? 0
	}

	/** True when the section holds neither a block nor a fluid. */
	isSectionEmpty(cx: number, cz: number, sy: number): boolean {
		const mask = this.sectionMasks.get(chunkKey(cx, cz))
		if (mask === undefined) return true
		return (mask & (1 << sy)) === 0
	}

	/**
	 * Fresh 18^3 neighbourhood for one section. The buffers are handed over to
	 * the worker pool, which transfers them, so every request allocates its own.
	 */
	buildMeshRequest(cx: number, cz: number, sy: number): MeshRequest {
		const padded = createEmptyPadded()
		const voxels = this.voxels
		fillPaddedFromSampler(padded, cx * CHUNK_X, sy * SECTION_Y, cz * CHUNK_Z, {
			block: (x, y, z) => voxels.getBlock(x, y, z),
			light: (x, y, z) => voxels.getLightByte(x, y, z),
			fluid: (x, y, z) => voxels.getFluid(x, y, z),
		})
		return createMeshRequest({
			key: sectionKey(cx, cz, sy),
			cx,
			cz,
			sy,
			revision: this.revisionOf(cx, cz, sy),
			padded,
		})
	}

	// --- streaming ----------------------------------------------------------

	/**
	 * Restores, generates and decorates around a centre chunk, bounded by the
	 * budget so a frame is never blocked by a whole region. Terrain runs one
	 * ring wider than `radius`, because decoration reads the 3x3 neighbourhood.
	 */
	stream(centerCx: number, centerCz: number, radius: number, budget: StreamBudget): boolean {
		let terrainLeft = budget.terrain
		let decorateLeft = budget.decorate
		let decoratedAny = false

		if (terrainLeft > 0) {
			for (const [dx, dz] of offsetsFor(radius + 1)) {
				if (terrainLeft <= 0) break
				const cx = centerCx + dx
				const cz = centerCz + dz
				const key = chunkKey(cx, cz)
				if (this.terrainReady.has(key) || this.restoring.has(key)) continue
				terrainLeft--
				if (this.source !== null && this.source.has(cx, cz)) {
					// Saved chunks are authoritative, so they are read back instead of
					// regenerated. The await lands in a later frame.
					void this.restoreFromStore(cx, cz)
					continue
				}
				this.generateTerrain(cx, cz)
			}
		}

		for (const [dx, dz] of offsetsFor(radius)) {
			if (decorateLeft <= 0) break
			if (!this.decorate(centerCx + dx, centerCz + dz)) continue
			decorateLeft--
			decoratedAny = true
		}
		if (decoratedAny) this.stitchLight()
		return decoratedAny
	}

	/** Blocking preparation of one chunk, used for the spawn chunk at boot. */
	ensureDecorated(cx: number, cz: number): void {
		for (const [dx, dz] of offsetsFor(1)) this.generateTerrain(cx + dx, cz + dz)
		if (this.decorate(cx, cz)) this.stitchLight()
	}

	/**
	 * A column near (wx, wz) with a solid surface above sea level and two free
	 * blocks above it, so the player never spawns inside a plant or a tree.
	 * Deterministic for a seed, and only reads chunks that are already loaded.
	 */
	findSpawn(wx: number, wz: number): { x: number; y: number; z: number } {
		for (const [dx, dz] of offsetsFor(SPAWN_SEARCH_RADIUS)) {
			const x = wx + dx
			const z = wz + dz
			const sample = this.generator.sampleColumn(x, z)
			if (sample.surfaceY < SEA_LEVEL) continue
			if (!this.voxels.isSolid(x, sample.surfaceY, z)) continue
			if (this.voxels.getBlock(x, sample.surfaceY + 1, z) !== BLOCK.AIR) continue
			if (this.voxels.getBlock(x, sample.surfaceY + 2, z) !== BLOCK.AIR) continue
			return { x: x + 0.5, y: sample.surfaceY + 1, z: z + 0.5 }
		}
		const fallback = this.generator.sampleColumn(wx, wz)
		return { x: wx + 0.5, y: Math.max(fallback.surfaceY + 1, SEA_LEVEL + 1), z: wz + 0.5 }
	}

	// --- automation ---------------------------------------------------------

	/**
	 * Fingerprint of everything a save has to reproduce: the seed plus the blocks
	 * and fluids of every chunk that diverged from pristine generation. Light is
	 * derived state and is deliberately left out, so the value is stable while
	 * light is still propagating.
	 */
	stateHash(): number {
		let h = 0x811c9dc5 >>> 0
		const mix = (value: number): void => {
			h = Math.imul(h ^ (value >>> 0), 0x01000193) >>> 0
		}
		mix(this.seed)
		for (const pos of this.modifiedChunks()) {
			const chunk = this.voxels.getChunk(pos.cx, pos.cz)
			if (chunk === undefined) continue
			mix(pos.cx)
			mix(pos.cz)
			mix(hashBuffer(chunk.blocks))
			mix(hashBuffer(chunk.fluids))
		}
		return h >>> 0
	}

	// --- internals ----------------------------------------------------------

	private bumpSections(cx: number, cz: number, mask: number): void {
		for (let sy = 0; sy < SECTIONS_PER_CHUNK; sy++) {
			if ((mask & (1 << sy)) === 0) continue
			const key = sectionKey(cx, cz, sy)
			this.sectionRevision.set(key, (this.sectionRevision.get(key) ?? 0) + 1)
		}
	}

	private orSectionMask(x: number, y: number, z: number): void {
		const key = chunkKey(worldToChunk(x), worldToChunk(z))
		const mask = this.sectionMasks.get(key) ?? 0
		this.sectionMasks.set(key, mask | (1 << ((y >> 4) & 15)))
	}

	/**
	 * `generateChunk` and `applySnapshotToChunk` write the block array directly,
	 * so the heightmap has to be rebuilt afterwards. Edits go through
	 * `SimVoxelWorld.setBlock`, which keeps it up to date on its own.
	 */
	private refreshHeightmap(chunk: ChunkData): void {
		for (let lz = 0; lz < CHUNK_Z; lz++) {
			for (let lx = 0; lx < CHUNK_X; lx++) {
				let y = CHUNK_Y - 1
				while (y >= 0 && SKY_PASS_THROUGH[chunk.blocks[blockIndex(lx, y, lz)]] === 1) y--
				chunk.heightmap[(lz << 4) | lx] = y + 1
			}
		}
	}
}
