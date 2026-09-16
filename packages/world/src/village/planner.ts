/**
 * Deterministic village planning. Owned by task world-f (village), L2.
 *
 * One candidate village per VILLAGE.regionChunks x VILLAGE.regionChunks region.
 * Whether the region holds one, where its centre lands and what it is made of
 * are pure functions of (seed, regionX, regionZ) through the frozen SALT_V2
 * salts, so a plan is reproducible without storing any structure state and two
 * chunks that share a village always agree on every piece of it.
 *
 * planRegion returns null when the centre sits in a biome VILLAGE.allowedBiomes
 * does not list, when any ground column of the site is at or below sea level,
 * or when the terrain under the site varies by more than
 * VILLAGE.maxHeightVariance.
 */
import type {
	BiomeId,
	Rng,
	StructureKind,
	StructurePiece,
	VillagePlan,
} from '@voxelcraft/core-types'
import {
	CHUNK_X,
	CHUNK_Y,
	CHUNK_Z,
	SEA_LEVEL,
	STRUCTURE,
	VILLAGE,
	hash01,
	hashU32,
	makeRng,
} from '@voxelcraft/core-types'
import type { TerrainContext, VillagePlanner } from '../internal'
import { SALT_V2 } from '../internal'
import type { Bounds } from './layout'
import {
	PIECE_HEIGHT,
	SLOT_DIRS,
	VILLAGE_LAYOUT,
	boundsOf,
	boundsTouchChunk,
	siteColumns,
} from './layout'

/** Chunks a village can reach out of the chunk that holds its centre. */
const CHUNK_PAD = Math.ceil(VILLAGE_LAYOUT.maxRadius / CHUNK_X)

/** Tallest piece, used to keep a village clear of the world ceiling. */
const MAX_PIECE_HEIGHT = PIECE_HEIGHT.church

interface RegionPlan {
	readonly plan: VillagePlan | null
	readonly bounds: Bounds | null
}

const NO_VILLAGE: RegionPlan = { plan: null, bounds: null }

function floorDiv(value: number, size: number): number {
	return Math.floor(value / size)
}

function allowedBiome(biome: BiomeId): boolean {
	return VILLAGE.allowedBiomes.includes(biome)
}

/** Houses, with the community buildings the budget allows mixed in. */
function buildingKind(index: number): StructureKind {
	switch (index) {
		case 1:
			return STRUCTURE.Farm
		case 3:
			return STRUCTURE.Church
		case 5:
			return STRUCTURE.Smithy
		default:
			return STRUCTURE.House
	}
}

function heightOf(kind: StructureKind): number {
	switch (kind) {
		case STRUCTURE.Well:
			return PIECE_HEIGHT.well
		case STRUCTURE.Farm:
			return PIECE_HEIGHT.farm
		case STRUCTURE.Church:
			return PIECE_HEIGHT.church
		case STRUCTURE.Smithy:
			return PIECE_HEIGHT.smithy
		case STRUCTURE.Lamp:
			return PIECE_HEIGHT.lamp
		default:
			return PIECE_HEIGHT.house
	}
}

/** Footprint of a building. Never wider than VILLAGE.buildingMaxFootprint. */
function footprintOf(kind: StructureKind, rng: Rng): readonly [number, number] {
	switch (kind) {
		case STRUCTURE.Farm:
			return rng.nextInt(2) === 0 ? [7, 7] : [9, 9]
		case STRUCTURE.Church:
			return [7, 9]
		case STRUCTURE.Smithy:
			return [7, 7]
		default:
			return [5 + rng.nextInt(2) * 2, 5 + rng.nextInt(2) * 2]
	}
}

/** Quarter turns that point a piece back at the well it was placed around. */
function rotationToward(offsetX: number, offsetZ: number): 0 | 1 | 2 | 3 {
	if (Math.abs(offsetX) >= Math.abs(offsetZ)) return offsetX > 0 ? 2 : 0
	return offsetZ > 0 ? 3 : 1
}

function covers(piece: StructurePiece, x: number, z: number): boolean {
	return x >= piece.x && x < piece.x + piece.sizeX && z >= piece.z && z < piece.z + piece.sizeZ
}

/** The pieces of a village, at y = 0 until the site height is known. */
function draftPieces(
	seed: number,
	regionX: number,
	regionZ: number,
	centerX: number,
	centerZ: number,
): StructurePiece[] {
	const rng = makeRng(seed, SALT_V2.villageLayout, regionX, regionZ)
	const wellSize = 2 * VILLAGE.wellRadius + 1
	const pieces: StructurePiece[] = [
		{
			kind: STRUCTURE.Well,
			x: centerX - VILLAGE.wellRadius,
			y: 0,
			z: centerZ - VILLAGE.wellRadius,
			sizeX: wellSize,
			sizeY: PIECE_HEIGHT.well,
			sizeZ: wellSize,
			rotation: 0,
		},
	]
	const budget = VILLAGE.maxBuildings - VILLAGE.minBuildings + 1
	const count = VILLAGE.minBuildings + rng.nextInt(budget)
	const firstSlot = rng.nextInt(VILLAGE_LAYOUT.slotCount)
	// An odd stride over 8 slots never repeats a slot, and two distinct slots
	// are at least ringMin apart on one axis, so footprints cannot overlap.
	const stride = 1 + 2 * rng.nextInt(4)
	const lamps: StructurePiece[] = []
	for (let i = 0; i < count; i++) {
		const dir = SLOT_DIRS[(firstSlot + stride * i) % VILLAGE_LAYOUT.slotCount]
		const distance = VILLAGE_LAYOUT.ringMin + rng.nextInt(VILLAGE_LAYOUT.ringSpan)
		const kind = buildingKind(i)
		const size = footprintOf(kind, rng)
		const offsetX = dir[0] * distance
		const offsetZ = dir[1] * distance
		const rotation = rotationToward(offsetX, offsetZ)
		// Long side along the street the door opens onto.
		const sizeX = rotation % 2 === 1 ? size[1] : size[0]
		const sizeZ = rotation % 2 === 1 ? size[0] : size[1]
		pieces.push({
			kind,
			x: centerX + offsetX - ((sizeX - 1) >> 1),
			y: 0,
			z: centerZ + offsetZ - ((sizeZ - 1) >> 1),
			sizeX,
			sizeY: heightOf(kind),
			sizeZ,
			rotation,
		})
		// A lamp stands beside the path, halfway out to the building.
		const half = distance >> 1
		lamps.push({
			kind: STRUCTURE.Lamp,
			x: centerX + dir[0] * half + dir[1],
			y: 0,
			z: centerZ + dir[1] * half - dir[0],
			sizeX: 1,
			sizeY: PIECE_HEIGHT.lamp,
			sizeZ: 1,
			rotation: 0,
		})
	}
	for (const lamp of lamps) {
		if (pieces.some((piece) => covers(piece, lamp.x, lamp.z))) continue
		pieces.push(lamp)
	}
	return pieces
}

export function createVillagePlanner(terrain: TerrainContext): VillagePlanner {
	const seed = terrain.seed
	const cache = new Map<string, RegionPlan>()

	function compute(regionX: number, regionZ: number): RegionPlan {
		const roll = hash01(seed, SALT_V2.villageRegion, regionX, 0, regionZ) * 100
		if (roll >= VILLAGE.spawnChancePercent) return NO_VILLAGE

		// Jitter stays inside the region, which keeps neighbouring villages at
		// least regionChunks - jitterChunks chunks apart.
		const span = VILLAGE.jitterChunks + 1
		const jitterX = hashU32(seed, SALT_V2.villageJitter, regionX, 0, regionZ) % span
		const jitterZ = hashU32(seed, SALT_V2.villageJitter, regionX, 1, regionZ) % span
		const chunkX = regionX * VILLAGE.regionChunks + jitterX
		const chunkZ = regionZ * VILLAGE.regionChunks + jitterZ
		const centerX = chunkX * CHUNK_X + (CHUNK_X >> 1)
		const centerZ = chunkZ * CHUNK_Z + (CHUNK_Z >> 1)

		const center = terrain.sampleColumn(centerX, centerZ)
		if (!allowedBiome(center.biome) || center.surfaceY <= SEA_LEVEL) return NO_VILLAGE

		const pieces = draftPieces(seed, regionX, regionZ, centerX, centerZ)
		const columns = siteColumns(seed, { seed, regionX, regionZ, centerX, centerZ, pieces })
		let minY = center.surfaceY
		let maxY = center.surfaceY
		for (const [x, z] of columns) {
			const sample = terrain.sampleColumn(x, z)
			// Never over water, never into a biome the contract disallows.
			if (sample.surfaceY <= SEA_LEVEL || !allowedBiome(sample.biome)) return NO_VILLAGE
			if (sample.surfaceY < minY) minY = sample.surfaceY
			if (sample.surfaceY > maxY) maxY = sample.surfaceY
			if (maxY - minY > VILLAGE.maxHeightVariance) return NO_VILLAGE
		}

		// Flatten to the middle of the band, so no column is cut or filled by
		// more than half of maxHeightVariance.
		const groundY = (minY + maxY) >> 1
		if (groundY - VILLAGE_LAYOUT.foundationDepth < 1) return NO_VILLAGE
		if (groundY + MAX_PIECE_HEIGHT + VILLAGE_LAYOUT.clearMargin >= CHUNK_Y) return NO_VILLAGE

		return {
			plan: {
				seed,
				regionX,
				regionZ,
				centerX,
				centerZ,
				pieces: pieces.map((piece) => ({ ...piece, y: groundY })),
			},
			bounds: boundsOf(columns),
		}
	}

	function region(regionX: number, regionZ: number): RegionPlan {
		const key = `${regionX},${regionZ}`
		const hit = cache.get(key)
		if (hit !== undefined) return hit
		const computed = compute(regionX, regionZ)
		cache.set(key, computed)
		return computed
	}

	return {
		planRegion(regionX, regionZ) {
			return region(regionX, regionZ).plan
		},
		plansForChunk(cx, cz) {
			const out: VillagePlan[] = []
			const rx0 = floorDiv(cx - CHUNK_PAD, VILLAGE.regionChunks)
			const rx1 = floorDiv(cx + CHUNK_PAD, VILLAGE.regionChunks)
			const rz0 = floorDiv(cz - CHUNK_PAD, VILLAGE.regionChunks)
			const rz1 = floorDiv(cz + CHUNK_PAD, VILLAGE.regionChunks)
			for (let rz = rz0; rz <= rz1; rz++) {
				for (let rx = rx0; rx <= rx1; rx++) {
					const candidate = region(rx, rz)
					if (candidate.plan === null || candidate.bounds === null) continue
					if (!boundsTouchChunk(candidate.bounds, cx, cz)) continue
					out.push(candidate.plan)
				}
			}
			return out
		},
	}
}
