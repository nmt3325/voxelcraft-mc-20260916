/**
 * Village generation. Owned by task world-f (village), L2.
 *
 * A village only exists where the terrain agrees, so every case scans a block
 * of regions for both seeds and then has to hold for every village found.
 */
import { describe, expect, it } from 'vitest'
import type {
	BlockId,
	StructureKind,
	StructurePiece,
	VillagePlan,
	VoxelEditView,
} from '@voxelcraft/core-types'
import {
	BLOCK,
	BLOCK_V2,
	CHUNK_VOLUME,
	CHUNK_X,
	CHUNK_Y,
	CHUNK_Z,
	SEA_LEVEL,
	STRUCTURE,
	VILLAGE,
	blockIndex,
	worldToChunk,
	worldToLocal,
} from '@voxelcraft/core-types'
import { createNoiseBasis, createTerrain } from '../index'
import type { TerrainContext, VillageBuilder } from '../internal'
import { createVillageBuilder } from '../village'

const SEEDS = [1337, 20260916] as const
/** 7x7 regions per seed: enough that several real sites survive the checks. */
const REGION_SPAN = 3
const BUILDINGS: readonly StructureKind[] = [
	STRUCTURE.House,
	STRUCTURE.Farm,
	STRUCTURE.Church,
	STRUCTURE.Smithy,
]

/** Minimal VoxelEditView: a set of loaded chunks, all air to begin with. */
class FakeView implements VoxelEditView {
	private readonly chunks = new Map<string, Uint16Array>()

	load(cx: number, cz: number): void {
		this.chunks.set(`${cx},${cz}`, new Uint16Array(CHUNK_VOLUME))
	}

	blocks(cx: number, cz: number): Uint16Array {
		const chunk = this.chunks.get(`${cx},${cz}`)
		if (chunk === undefined) throw new Error(`chunk ${cx},${cz} is not loaded`)
		return chunk
	}

	isLoaded(cx: number, cz: number): boolean {
		return this.chunks.has(`${cx},${cz}`)
	}

	getBlock(x: number, y: number, z: number): BlockId {
		if (y < 0 || y >= CHUNK_Y) return BLOCK.AIR
		const chunk = this.chunks.get(`${worldToChunk(x)},${worldToChunk(z)}`)
		if (chunk === undefined) return BLOCK.AIR
		return chunk[blockIndex(worldToLocal(x), y, worldToLocal(z))]
	}

	setBlock(x: number, y: number, z: number, id: BlockId): void {
		if (y < 0 || y >= CHUNK_Y) return
		const chunk = this.chunks.get(`${worldToChunk(x)},${worldToChunk(z)}`)
		if (chunk === undefined) return
		chunk[blockIndex(worldToLocal(x), y, worldToLocal(z))] = id
	}

	getFluid(): number {
		return 0
	}

	setFluid(): void {}

	isSolid(x: number, y: number, z: number): boolean {
		return this.getBlock(x, y, z) !== BLOCK.AIR
	}

	isLiquid(): boolean {
		return false
	}
}

interface Site {
	readonly terrain: TerrainContext
	readonly builder: VillageBuilder
	readonly plans: readonly VillagePlan[]
}

function scan(seed: number): Site {
	const terrain = createTerrain(seed, createNoiseBasis(seed))
	const builder = createVillageBuilder(terrain)
	const plans: VillagePlan[] = []
	for (let rz = -REGION_SPAN; rz <= REGION_SPAN; rz++) {
		for (let rx = -REGION_SPAN; rx <= REGION_SPAN; rx++) {
			const plan = builder.planner.planRegion(rx, rz)
			if (plan !== null) plans.push(plan)
		}
	}
	return { terrain, builder, plans }
}

// One scan per seed, shared by every case; the planner caches per region.
const SITES = new Map<number, Site>(SEEDS.map((seed) => [seed, scan(seed)]))

function site(seed: number): Site {
	const found = SITES.get(seed)
	if (found === undefined) throw new Error(`seed ${seed} was not scanned`)
	return found
}

function firstPlan(seed: number): VillagePlan {
	const [plan] = site(seed).plans
	if (plan === undefined) throw new Error(`no village found for seed ${seed}`)
	return plan
}

function buildingsOf(plan: VillagePlan): readonly StructurePiece[] {
	return plan.pieces.filter((piece) => BUILDINGS.includes(piece.kind))
}

function footprint(piece: StructurePiece): Array<readonly [number, number]> {
	const out: Array<readonly [number, number]> = []
	for (let dz = 0; dz < piece.sizeZ; dz++) {
		for (let dx = 0; dx < piece.sizeX; dx++) out.push([piece.x + dx, piece.z + dz])
	}
	return out
}

/** Chunks a plan may write into, derived from its pieces alone. */
function touchesChunk(plan: VillagePlan, cx: number, cz: number): boolean {
	let minX = Infinity
	let maxX = -Infinity
	let minZ = Infinity
	let maxZ = -Infinity
	for (const piece of plan.pieces) {
		minX = Math.min(minX, piece.x)
		maxX = Math.max(maxX, piece.x + piece.sizeX - 1)
		minZ = Math.min(minZ, piece.z)
		maxZ = Math.max(maxZ, piece.z + piece.sizeZ - 1)
	}
	const bx = cx * CHUNK_X
	const bz = cz * CHUNK_Z
	return maxX >= bx && minX <= bx + CHUNK_X - 1 && maxZ >= bz && minZ <= bz + CHUNK_Z - 1
}

function chunkWindow(plan: VillagePlan): Array<readonly [number, number]> {
	const cx = worldToChunk(plan.centerX)
	const cz = worldToChunk(plan.centerZ)
	const out: Array<readonly [number, number]> = []
	for (let dz = -2; dz <= 2; dz++) {
		for (let dx = -2; dx <= 2; dx++) out.push([cx + dx, cz + dz])
	}
	return out
}

type Order = 'forward' | 'reverse' | 'interleaved'

function decorateWindow(builder: VillageBuilder, plan: VillagePlan, order: Order): FakeView {
	const coords = chunkWindow(plan)
	const view = new FakeView()
	for (const [cx, cz] of coords) view.load(cx, cz)
	const even = coords.filter((_, i) => i % 2 === 0)
	const odd = coords.filter((_, i) => i % 2 === 1)
	const visit =
		order === 'forward' ? coords : order === 'reverse' ? [...coords].reverse() : [...even, ...odd]
	for (const [cx, cz] of visit) builder.decorate(cx, cz, view)
	return view
}

/** Exact voxel comparison: a deep matcher over 65k-entry chunks is far too slow. */
function firstDifference(a: FakeView, b: FakeView, plan: VillagePlan): string | null {
	for (const [cx, cz] of chunkWindow(plan)) {
		const left = a.blocks(cx, cz)
		const right = b.blocks(cx, cz)
		for (let i = 0; i < left.length; i++) {
			if (left[i] !== right[i]) {
				return `chunk ${cx},${cz} voxel ${i}: ${left[i]} vs ${right[i]}`
			}
		}
	}
	return null
}

function expectSameWorld(a: FakeView, b: FakeView, plan: VillagePlan): void {
	expect(firstDifference(a, b, plan)).toBeNull()
}

function tally(view: FakeView, plan: VillagePlan): Map<number, number> {
	const counts = new Map<number, number>()
	for (const [cx, cz] of chunkWindow(plan)) {
		for (const id of view.blocks(cx, cz)) {
			if (id === BLOCK.AIR) continue
			counts.set(id, (counts.get(id) ?? 0) + 1)
		}
	}
	return counts
}

describe('village planning', () => {
	it('finds villages for both seeds', () => {
		for (const seed of SEEDS) expect(site(seed).plans.length).toBeGreaterThan(0)
	})

	it('plans the same villages from two independent builders', () => {
		for (const seed of SEEDS) {
			const mine = site(seed).builder.planner
			const other = createVillageBuilder(createTerrain(seed, createNoiseBasis(seed))).planner
			for (let rz = -REGION_SPAN; rz <= REGION_SPAN; rz++) {
				for (let rx = -REGION_SPAN; rx <= REGION_SPAN; rx++) {
					expect(other.planRegion(rx, rz)).toEqual(mine.planRegion(rx, rz))
				}
			}
		}
	})

	it('lays out different villages for different seeds', () => {
		expect(JSON.stringify(site(SEEDS[0]).plans)).not.toEqual(
			JSON.stringify(site(SEEDS[1]).plans),
		)
	})

	it('keeps the building count inside the frozen budget', () => {
		for (const seed of SEEDS) {
			for (const plan of site(seed).plans) {
				const count = buildingsOf(plan).length
				expect(count).toBeGreaterThanOrEqual(VILLAGE.minBuildings)
				expect(count).toBeLessThanOrEqual(VILLAGE.maxBuildings)
			}
		}
	})

	it('puts exactly one well of the frozen radius at the centre', () => {
		for (const seed of SEEDS) {
			for (const plan of site(seed).plans) {
				const wells = plan.pieces.filter((piece) => piece.kind === STRUCTURE.Well)
				expect(wells).toHaveLength(1)
				const well = wells[0]
				expect(well.sizeX).toBe(VILLAGE.wellRadius * 2 + 1)
				expect(well.sizeZ).toBe(VILLAGE.wellRadius * 2 + 1)
				expect(well.x + VILLAGE.wellRadius).toBe(plan.centerX)
				expect(well.z + VILLAGE.wellRadius).toBe(plan.centerZ)
			}
		}
	})

	it('keeps every footprint inside buildingMaxFootprint', () => {
		for (const seed of SEEDS) {
			for (const plan of site(seed).plans) {
				for (const piece of plan.pieces) {
					expect(piece.sizeX).toBeLessThanOrEqual(VILLAGE.buildingMaxFootprint)
					expect(piece.sizeZ).toBeLessThanOrEqual(VILLAGE.buildingMaxFootprint)
					expect(piece.sizeX).toBeGreaterThan(0)
					expect(piece.sizeZ).toBeGreaterThan(0)
				}
			}
		}
	})

	it('never generates in a disallowed biome and never over water', () => {
		for (const seed of SEEDS) {
			const { terrain, plans } = site(seed)
			for (const plan of plans) {
				expect(VILLAGE.allowedBiomes).toContain(terrain.biomeAt(plan.centerX, plan.centerZ))
				for (const piece of plan.pieces) {
					for (const [x, z] of footprint(piece)) {
						expect(VILLAGE.allowedBiomes).toContain(terrain.biomeAt(x, z))
						expect(terrain.surfaceYAt(x, z)).toBeGreaterThan(SEA_LEVEL)
					}
				}
			}
		}
	})

	it('keeps the terrain under a village inside maxHeightVariance', () => {
		for (const seed of SEEDS) {
			const { terrain, plans } = site(seed)
			for (const plan of plans) {
				let min = Infinity
				let max = -Infinity
				for (const piece of plan.pieces) {
					for (const [x, z] of footprint(piece)) {
						const surfaceY = terrain.surfaceYAt(x, z)
						min = Math.min(min, surfaceY)
						max = Math.max(max, surfaceY)
						// The flattened floor never cuts or fills past the budget.
						expect(Math.abs(piece.y - surfaceY)).toBeLessThanOrEqual(VILLAGE.maxHeightVariance)
					}
				}
				expect(max - min).toBeLessThanOrEqual(VILLAGE.maxHeightVariance)
			}
		}
	})

	it('agrees between plansForChunk and planRegion', () => {
		for (const seed of SEEDS) {
			const { builder, plans } = site(seed)
			const planner = builder.planner
			for (const plan of plans) {
				// Every chunk a piece reaches into lists the plan.
				for (const piece of plan.pieces) {
					for (const [x, z] of footprint(piece)) {
						const listed = planner.plansForChunk(worldToChunk(x), worldToChunk(z))
						expect(
							listed.some((p) => p.regionX === plan.regionX && p.regionZ === plan.regionZ),
						).toBe(true)
					}
				}
				// And what a chunk lists is what planRegion returns, nothing else.
				for (const [cx, cz] of chunkWindow(plan)) {
					for (const listed of planner.plansForChunk(cx, cz)) {
						expect(listed).toEqual(planner.planRegion(listed.regionX, listed.regionZ))
						expect(touchesChunk(listed, cx, cz)).toBe(true)
					}
				}
			}
		}
	})
})

describe('village decoration', () => {
	it('raises the village into the chunks it covers', () => {
		const { builder } = site(SEEDS[0])
		const plan = firstPlan(SEEDS[0])
		const view = decorateWindow(builder, plan, 'forward')
		const groundY = plan.pieces[0].y
		expect(view.getBlock(plan.centerX, groundY, plan.centerZ)).toBe(BLOCK.COBBLESTONE)
		const counts = tally(view, plan)
		expect(counts.get(BLOCK_V2.COBBLESTONE_WALL) ?? 0).toBeGreaterThan(0)
		expect(counts.get(BLOCK_V2.GRAVEL_PATH) ?? 0).toBeGreaterThan(0)
		expect(counts.get(BLOCK_V2.FARMLAND) ?? 0).toBeGreaterThan(0)
		expect(counts.get(BLOCK.DOOR_LOWER) ?? 0).toBeGreaterThan(0)
		expect(counts.get(BLOCK.TORCH) ?? 0).toBeGreaterThan(0)
	})

	it('writes the same world whatever order the chunks come in', () => {
		for (const seed of SEEDS) {
			const { builder } = site(seed)
			const plan = firstPlan(seed)
			const forward = decorateWindow(builder, plan, 'forward')
			expectSameWorld(forward, decorateWindow(builder, plan, 'reverse'), plan)
			expectSameWorld(forward, decorateWindow(builder, plan, 'interleaved'), plan)
		}
	})

	it('is a no-op when a chunk is decorated twice', () => {
		const { builder } = site(SEEDS[0])
		const plan = firstPlan(SEEDS[0])
		const once = decorateWindow(builder, plan, 'forward')
		const twice = decorateWindow(builder, plan, 'forward')
		for (const [cx, cz] of chunkWindow(plan)) builder.decorate(cx, cz, twice)
		expectSameWorld(once, twice, plan)
	})

	it('never writes outside the chunk it was given', () => {
		const { builder } = site(SEEDS[0])
		const plan = firstPlan(SEEDS[0])
		const coords = chunkWindow(plan)
		const view = new FakeView()
		for (const [cx, cz] of coords) view.load(cx, cz)
		const cx0 = worldToChunk(plan.centerX)
		const cz0 = worldToChunk(plan.centerZ)
		builder.decorate(cx0, cz0, view)
		for (const [cx, cz] of coords) {
			if (cx === cx0 && cz === cz0) continue
			expect(view.blocks(cx, cz).every((id) => id === BLOCK.AIR)).toBe(true)
		}
	})

	it('leaves a chunk with no village untouched', () => {
		const { builder } = site(SEEDS[0])
		let target: readonly [number, number] | null = null
		for (let cx = 0; cx < 64 && target === null; cx++) {
			if (builder.planner.plansForChunk(cx, 0).length === 0) target = [cx, 0]
		}
		expect(target).not.toBeNull()
		const [cx, cz] = target as readonly [number, number]
		const view = new FakeView()
		view.load(cx, cz)
		builder.decorate(cx, cz, view)
		expect(view.blocks(cx, cz).every((id) => id === BLOCK.AIR)).toBe(true)
	})
})
