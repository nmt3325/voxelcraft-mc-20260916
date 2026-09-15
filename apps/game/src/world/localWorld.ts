import {
	BLOCK,
	CHUNK_X,
	CHUNK_Y,
	CHUNK_Z,
	SECTION_Y,
	sectionKey,
	type MeshRequest,
} from '@voxelcraft/core-types'
import { createEmptyPadded, createMeshRequest, paddedOffset } from '@voxelcraft/client'

/**
 * Local world fixture.
 *
 * `packages/world` (terrain) and `packages/sim` (lighting, fluids) are being
 * built in parallel, so the app ships a small deterministic generator of its
 * own. It is intentionally simple but has every property the client needs:
 * same seed gives the same terrain, edits are recorded so they can be saved and
 * replayed, and sections expose a revision so stale mesh jobs can be dropped.
 *
 * Swapping in the real world package later means replacing `blockAt` and
 * `skyLightAt`; nothing else in the app depends on how terrain is produced.
 */

export const SEA_LEVEL = 62
const BASE_HEIGHT = 58
const STONE_DEPTH = 4

export type BiomeName = 'plains' | 'forest' | 'desert' | 'tundra' | 'ocean'

export interface BlockEdit {
	x: number
	y: number
	z: number
	id: number
}

function hash2(seed: number, x: number, z: number): number {
	let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263)) | 0
	h = Math.imul(h ^ (h >>> 13), 1274126177)
	return (h ^ (h >>> 16)) >>> 0
}

function hash3(seed: number, x: number, y: number, z: number): number {
	return hash2(hash2(seed, x, z) | 0, y, 0x5f3a)
}

function unit(seed: number, x: number, z: number): number {
	return hash2(seed, x, z) / 4294967296
}

/** Smoothstep-interpolated value noise: deterministic and dependency free. */
function valueNoise(seed: number, x: number, z: number, scale: number): number {
	const fx = x / scale
	const fz = z / scale
	const x0 = Math.floor(fx)
	const z0 = Math.floor(fz)
	const tx = fx - x0
	const tz = fz - z0
	const sx = tx * tx * (3 - 2 * tx)
	const sz = tz * tz * (3 - 2 * tz)
	const n00 = unit(seed, x0, z0)
	const n10 = unit(seed, x0 + 1, z0)
	const n01 = unit(seed, x0, z0 + 1)
	const n11 = unit(seed, x0 + 1, z0 + 1)
	return (n00 * (1 - sx) + n10 * sx) * (1 - sz) + (n01 * (1 - sx) + n11 * sx) * sz
}

export class LocalWorld {
	readonly seed: number
	private readonly edits = new Map<string, number>()
	private readonly revisions = new Map<string, number>()
	private readonly heightCache = new Map<string, number>()

	constructor(seed: number) {
		this.seed = seed | 0
	}

	// --- terrain ------------------------------------------------------------

	surfaceHeight(x: number, z: number): number {
		const key = `${x},${z}`
		const cached = this.heightCache.get(key)
		if (cached !== undefined) return cached
		const rolling = valueNoise(this.seed, x, z, 48) * 18
		const detail = valueNoise(this.seed ^ 0x9e37, x, z, 11) * 5
		const continent = valueNoise(this.seed ^ 0x51ed, x, z, 160) * 12
		const height = Math.floor(BASE_HEIGHT + rolling + detail + continent - 8)
		const clamped = Math.max(1, Math.min(CHUNK_Y - 8, height))
		this.heightCache.set(key, clamped)
		return clamped
	}

	biomeAt(x: number, z: number): BiomeName {
		const height = this.surfaceHeight(x, z)
		if (height < SEA_LEVEL - 1) return 'ocean'
		const temperature = valueNoise(this.seed ^ 0x2f1b, x, z, 220)
		const trees = valueNoise(this.seed ^ 0x7c19, x, z, 90)
		if (temperature > 0.68) return 'desert'
		if (temperature < 0.3) return 'tundra'
		if (trees > 0.58) return 'forest'
		return 'plains'
	}

	/** Terrain before any edits. */
	private generatedBlock(x: number, y: number, z: number): number {
		if (y < 0 || y >= CHUNK_Y) return BLOCK.AIR
		if (y === 0) return BLOCK.BEDROCK

		const height = this.surfaceHeight(x, z)
		const biome = this.biomeAt(x, z)

		if (y > height) {
			if (y <= SEA_LEVEL) return BLOCK.WATER
			return this.decoration(x, y, z, height, biome)
		}

		if (y === height) {
			if (biome === 'desert') return BLOCK.SAND
			if (biome === 'tundra') return BLOCK.SNOW_BLOCK
			if (height < SEA_LEVEL) return BLOCK.SAND
			return BLOCK.GRASS_BLOCK
		}
		if (y > height - STONE_DEPTH) {
			return biome === 'desert' || height < SEA_LEVEL ? BLOCK.SAND : BLOCK.DIRT
		}

		const ore = hash3(this.seed ^ 0x1234, x, y, z) / 4294967296
		if (y < 18 && ore > 0.9975) return BLOCK.DIAMOND_ORE
		if (y < 34 && ore > 0.994) return BLOCK.GOLD_ORE
		if (y < 52 && ore > 0.988) return BLOCK.IRON_ORE
		if (ore > 0.978) return BLOCK.COAL_ORE
		if (ore < 0.004) return BLOCK.GRAVEL
		return BLOCK.STONE
	}

	/** Trees and plants sitting on top of the surface. */
	private decoration(
		x: number,
		y: number,
		z: number,
		height: number,
		biome: BiomeName,
	): number {
		const above = y - height
		if (above <= 0) return BLOCK.AIR

		// Trees are anchored on a 1-in-N lattice so trunks never overlap.
		if (biome === 'forest' || biome === 'plains') {
			for (let dx = -2; dx <= 2; dx++) {
				for (let dz = -2; dz <= 2; dz++) {
					const tx = x + dx
					const tz = z + dz
					const chance = hash2(this.seed ^ 0x6a09, tx, tz) / 4294967296
					const density = biome === 'forest' ? 0.045 : 0.012
					if (chance > density) continue
					const trunkHeight = this.surfaceHeight(tx, tz)
					if (trunkHeight < SEA_LEVEL) continue
					const trunkTop = trunkHeight + 5
					if (dx === 0 && dz === 0 && y <= trunkTop) return BLOCK.OAK_LOG
					const leafBottom = trunkHeight + 3
					if (y < leafBottom || y > trunkTop + 1) continue
					const radius = y >= trunkTop ? 1 : 2
					if (Math.abs(dx) <= radius && Math.abs(dz) <= radius) return BLOCK.OAK_LEAVES
				}
			}
		}

		if (above !== 1 || height < SEA_LEVEL) return BLOCK.AIR
		const roll = hash2(this.seed ^ 0xbb67, x, z) / 4294967296
		if (biome === 'desert') {
			if (roll > 0.994) return BLOCK.CACTUS
			if (roll > 0.982) return BLOCK.DEAD_BUSH
			return BLOCK.AIR
		}
		if (biome === 'tundra') return roll > 0.97 ? BLOCK.DEAD_BUSH : BLOCK.AIR
		if (roll > 0.93) return BLOCK.TALL_GRASS
		if (roll > 0.921) return BLOCK.FLOWER_RED
		if (roll > 0.914) return BLOCK.FLOWER_YELLOW
		return BLOCK.AIR
	}

	// --- blocks -------------------------------------------------------------

	blockAt(x: number, y: number, z: number): number {
		if (y < 0 || y >= CHUNK_Y) return BLOCK.AIR
		const edited = this.edits.get(`${x},${y},${z}`)
		if (edited !== undefined) return edited
		return this.generatedBlock(x, y, z)
	}

	/** Returns false when the write is a no-op or out of bounds. */
	setBlock(x: number, y: number, z: number, id: number): boolean {
		if (y < 0 || y >= CHUNK_Y) return false
		if (this.blockAt(x, y, z) === id) return false
		const key = `${x},${y},${z}`
		if (this.generatedBlock(x, y, z) === id) this.edits.delete(key)
		else this.edits.set(key, id)
		this.touchAround(x, y, z)
		return true
	}

	/** Bump the containing section and any neighbour whose padding changed. */
	private touchAround(x: number, y: number, z: number): void {
		const localX = ((x % CHUNK_X) + CHUNK_X) % CHUNK_X
		const localZ = ((z % CHUNK_Z) + CHUNK_Z) % CHUNK_Z
		const localY = y % SECTION_Y
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				for (let dz = -1; dz <= 1; dz++) {
					if (dx !== 0 && localX !== (dx < 0 ? 0 : CHUNK_X - 1)) continue
					if (dy !== 0 && localY !== (dy < 0 ? 0 : SECTION_Y - 1)) continue
					if (dz !== 0 && localZ !== (dz < 0 ? 0 : CHUNK_Z - 1)) continue
					this.bump(
						Math.floor(x / CHUNK_X) + dx,
						Math.floor(y / SECTION_Y) + dy,
						Math.floor(z / CHUNK_Z) + dz,
					)
				}
			}
		}
	}

	private bump(cx: number, sy: number, cz: number): void {
		if (sy < 0 || sy >= CHUNK_Y / SECTION_Y) return
		const key = sectionKey(cx, sy, cz)
		this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1)
	}

	revisionOf(cx: number, sy: number, cz: number): number {
		return this.revisions.get(sectionKey(cx, sy, cz)) ?? 0
	}

	// --- meshing ------------------------------------------------------------

	/**
	 * Sky light double: full sunlight above the surface, darkness below, with a
	 * short gradient so caves are not pitch black. Torches emit block light.
	 */
	private lightAt(x: number, y: number, z: number): number {
		const id = this.blockAt(x, y, z)
		const emission = id === BLOCK.TORCH || id === BLOCK.GLOWSTONE ? 14 : 0
		const height = this.surfaceHeight(x, z)
		const sky = y > height ? 15 : Math.max(0, 12 - (height - y) * 3)
		return (sky << 4) | emission
	}

	buildMeshRequest(cx: number, sy: number, cz: number): MeshRequest {
		const padded = createEmptyPadded()
		const originX = cx * CHUNK_X
		const originY = sy * SECTION_Y
		const originZ = cz * CHUNK_Z
		for (let y = -1; y <= SECTION_Y; y++) {
			for (let z = -1; z <= CHUNK_Z; z++) {
				for (let x = -1; x <= CHUNK_X; x++) {
					const offset = paddedOffset(x, y, z)
					const worldX = originX + x
					const worldY = originY + y
					const worldZ = originZ + z
					padded.blocks[offset] = this.blockAt(worldX, worldY, worldZ)
					padded.light[offset] = this.lightAt(worldX, worldY, worldZ)
				}
			}
		}
		return createMeshRequest({
			key: sectionKey(cx, sy, cz),
			cx,
			cz,
			sy,
			revision: this.revisionOf(cx, sy, cz),
			padded,
		})
	}

	// --- persistence --------------------------------------------------------

	listEdits(): BlockEdit[] {
		const list: BlockEdit[] = []
		for (const [key, id] of this.edits) {
			const [x, y, z] = key.split(',').map(Number)
			list.push({ x, y, z, id })
		}
		list.sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z)
		return list
	}

	applyEdits(edits: readonly BlockEdit[]): void {
		for (const edit of edits) this.setBlock(edit.x, edit.y, edit.z, edit.id)
	}

	/** Stable fingerprint of seed + edits, used by the E2E reload assertion. */
	stateHash(): string {
		let h = 0x811c9dc5 ^ this.seed
		for (const edit of this.listEdits()) {
			for (const value of [edit.x, edit.y, edit.z, edit.id]) {
				h = Math.imul(h ^ value, 16777619) >>> 0
			}
		}
		return (h >>> 0).toString(16).padStart(8, '0')
	}

	/** Highest non-air block in a column, for spawning the player. */
	spawnHeight(x: number, z: number): number {
		for (let y = CHUNK_Y - 1; y > 0; y--) {
			const id = this.blockAt(x, y, z)
			if (id !== BLOCK.AIR && id !== BLOCK.WATER && id !== BLOCK.TALL_GRASS) return y + 1
		}
		return SEA_LEVEL + 1
	}
}
