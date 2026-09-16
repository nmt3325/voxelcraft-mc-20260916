/**
 * Nether ores, patches and glowstone clusters: the implementation of the
 * CreateNetherDecoration seam declared in `../internal`. `../dimension.ts`
 * calls placeChunk right after the terrain fill and decorate once the
 * neighbourhood of a chunk is loaded.
 *
 * The work is split the way the seam splits it. placeChunk owns the features
 * that fit inside one chunk: quartz veins, soul sand and magma patches. Each of
 * them is column local on purpose. The frozen constants are per column chances,
 * so a feature that leaked into a neighbouring column would make
 * quartzOreChancePerColumn stop being the per column frequency of quartz in the
 * finished world, and there would be nothing left to measure. decorate owns the
 * one feature that may cross a border, the glowstone clusters, and reaches into
 * the neighbours through the VoxelEditView.
 *
 * Determinism. Whether a feature exists and what it looks like is a pure
 * function of (seed, world coordinates): every roll is a coordinate hash under
 * one of the frozen nether salts, so the outcome cannot depend on generation
 * order, on a neighbour arriving late, or on how often a chunk is visited. The
 * one stream RNG is the per chunk glowstone stream built from
 * (seed, SALT_V2.netherGlowstone, cx, cz), whose iteration order is fixed by the
 * chunk it belongs to. There is no wall clock and no global PRNG.
 *
 * Cluster anchors come from the terrain field, never from the view: openAt says
 * where the cavern ceilings of a column are, and the view is only ever used to
 * refuse a write. A missing neighbour therefore cannot change what is placed,
 * and a second pass finds its own voxels already filled and changes nothing.
 *
 * Pass order does not matter either. A voxel counts as rock when the cavern
 * field left it closed, which is exactly what the filled chunk holds, and every
 * block written here is solid, so that answer is the same before and after any
 * other pass.
 *
 * The shell invariants hold by construction: no AIR, LAVA or BEDROCK is ever
 * written, every write is clamped to [floorY, roofY), and an ore or a patch only
 * overwrites netherrack through isNetherReplaceable. Glowstone is the one
 * exception to that last rule, and deliberately so: a cluster hangs in the open,
 * so it is neither an ore nor a patch, it replaces open air above the lava sea
 * and never eats into the rock around it.
 */
import {
	BLOCK,
	BLOCK_V2,
	CHUNK_X,
	CHUNK_Z,
	NETHER_GEN,
	blockIndex,
	hash01,
	makeRng,
} from '@voxelcraft/core-types'
import type { VoxelEditView } from '@voxelcraft/core-types'
import type {
	CreateNetherDecoration,
	NetherDecoration,
	NetherTerrain,
	NoiseBasis,
} from '../internal'
import { SALT_V2, isNetherGround, isNetherReplaceable } from '../internal'

/** The carvable shell: bedrock below floorY, the roof layers from roofY up. */
const SHELL_LO = NETHER_GEN.floorY
const SHELL_HI = NETHER_GEN.roofY - 1
const SEA = NETHER_GEN.lavaSeaLevel

/**
 * y channels of the per column rolls. Every real voxel is at y >= floorY, so a
 * negative y can never collide with a per voxel roll of the same salt.
 */
const CH_GATE = -1
const CH_ROOT = -2

/** Vein root candidates; the first one that is rock carries the vein. */
const ROOT_TRIES = 4
/** How far a vein may reach from its root, and the roll that grows it there. */
const VEIN_REACH = 2
const VEIN_GROW = 0.62

/** Magma hugs the shore: the frozen chance holds within this band above it. */
const MAGMA_NEAR = 8
/** Far above the sea the magma chance falls to this share of the frozen one. */
const MAGMA_FAR = 0.35

/** A cluster spreads one block sideways at most and hangs one block deeper. */
const CLUSTER_SPREAD = 0.55
const CLUSTER_DEPTH = 0.6
/**
 * Chebyshev distance, y included, that two anchors of a chunk keep. A blob
 * reaches one voxel from its anchor on every axis, so a gap of four leaves at
 * least one empty voxel between two blobs and they can never merge into one.
 */
const CLUSTER_GAP = 4
/** Hashed ceiling probes tried before the sweep over the whole chunk. */
const CLUSTER_PROBES = 8

/** Sideways reach of a cluster. */
const LATERALS: ReadonlyArray<readonly [number, number]> = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
]

interface Site {
	readonly wx: number
	readonly y: number
	readonly wz: number
}

export const createNetherDecoration: CreateNetherDecoration = (
	seed: number,
	_noise: NoiseBasis,
	terrain: NetherTerrain,
): NetherDecoration => {
	/** Rock of the shell. Read from the filled chunk, so the passes commute. */
	const isRock = (blocks: Uint16Array, x: number, y: number, z: number): boolean => {
		if (y < SHELL_LO || y > SHELL_HI) return false
		const id = blocks[blockIndex(x, y, z)]
		return id !== BLOCK.AIR && id !== BLOCK.LAVA
	}

	/** An ore or patch voxel, which may only ever replace netherrack. */
	const replace = (blocks: Uint16Array, x: number, y: number, z: number, id: number): void => {
		if (y < SHELL_LO || y > SHELL_HI) return
		const i = blockIndex(x, y, z)
		if (!isNetherReplaceable(blocks[i])) return
		blocks[i] = id
	}

	/**
	 * Depth of the vein of a column, or -1 when the column carries none. The gate
	 * is the frozen per column chance; the root is the first of a few hashed
	 * depths that is rock, so a column whose first pick landed in a cavern still
	 * gets its vein and the frozen chance stays the observable frequency.
	 */
	const veinRootY = (blocks: Uint16Array, x: number, z: number, wx: number, wz: number): number => {
		const gate = hash01(seed, SALT_V2.netherQuartz, wx, CH_GATE, wz)
		if (gate >= NETHER_GEN.quartzOreChancePerColumn) return -1
		const span = SHELL_HI - SHELL_LO - 1
		for (let k = 0; k < ROOT_TRIES; k++) {
			const pick = hash01(seed, SALT_V2.netherQuartz, wx, CH_ROOT - k, wz)
			const y = SHELL_LO + 1 + Math.floor(pick * span)
			if (isRock(blocks, x, y, z)) return y
		}
		return -1
	}

	/**
	 * A vein is a short run through the rock of its own column. Growing it
	 * sideways would seed quartz into neighbouring columns and the frozen per
	 * column chance would no longer be measurable in the finished world.
	 */
	const placeVein = (
		blocks: Uint16Array,
		x: number,
		rootY: number,
		z: number,
		wx: number,
		wz: number,
	): void => {
		replace(blocks, x, rootY, z, BLOCK_V2.QUARTZ_ORE)
		for (const step of [1, -1]) {
			for (let k = 1; k <= VEIN_REACH; k++) {
				const y = rootY + step * k
				if (hash01(seed, SALT_V2.netherQuartz, wx, y, wz) >= VEIN_GROW) break
				if (!isRock(blocks, x, y, z)) break
				replace(blocks, x, y, z, BLOCK_V2.QUARTZ_ORE)
			}
		}
	}

	/**
	 * Lowest cavern floor of a column above the lava sea, or -1. Same shape as
	 * NetherTerrain.floorYAt, a closed voxel with two open ones of headroom over
	 * it, read from the filled chunk because the whole column is already at hand.
	 */
	const cavernFloorY = (blocks: Uint16Array, x: number, z: number): number => {
		for (let y = SEA + 1; y <= SHELL_HI - 2; y++) {
			if (!isRock(blocks, x, y, z)) continue
			if (!isRock(blocks, x, y + 1, z) && !isRock(blocks, x, y + 2, z)) return y
		}
		return -1
	}

	/**
	 * Magma prefers the shore of the lava sea: the frozen chance holds over the
	 * shore band and tapers with height, so the frozen number is exactly the
	 * chance a shore floor is covered.
	 */
	const magmaChance = (y: number): number => {
		const above = y - SEA
		if (above <= MAGMA_NEAR) return NETHER_GEN.magmaPatchChance
		const reach = SHELL_HI - SEA - MAGMA_NEAR
		const far = Math.min(1, (above - MAGMA_NEAR) / reach)
		return NETHER_GEN.magmaPatchChance * (1 - (1 - MAGMA_FAR) * far)
	}

	/** A patch lands on the floor it was found on, carried by solid ground. */
	const placePatch = (blocks: Uint16Array, x: number, y: number, z: number, id: number): void => {
		if (y - 1 < SHELL_LO) return
		if (!isNetherGround(blocks[blockIndex(x, y - 1, z)])) return
		replace(blocks, x, y, z, id)
	}

	/** Every ceiling of a column: an open voxel with rock directly above it. */
	const ceilingsInColumn = (wx: number, wz: number, out: Site[]): void => {
		// The roof over SHELL_HI is closed, so the scan starts under rock.
		let openAbove = false
		for (let y = SHELL_HI; y > SEA; y--) {
			const open = terrain.openAt(wx, y, wz)
			if (open && !openAbove) out.push({ wx, y, wz })
			openAbove = open
		}
	}

	/** Two anchors this far apart carry two clusters that cannot touch. */
	const apart = (a: Site, b: Site): boolean =>
		Math.max(Math.abs(a.wx - b.wx), Math.abs(a.y - b.y), Math.abs(a.wz - b.wz)) >= CLUSTER_GAP

	/**
	 * The anchors of the clusters of a chunk, pure in (seed, cx, cz). A few
	 * hashed probes normally answer at once; the sweep over the remaining columns
	 * is what holds the count at the frozen glowstoneClustersPerChunk even in a
	 * chunk whose caverns are hard to hit, and taking every ceiling of a column
	 * lets two stacked caverns carry the two clusters. A chunk with no two
	 * ceilings far enough apart carries what it can.
	 */
	const clusterSites = (cx: number, cz: number): Site[] => {
		const rng = makeRng(seed, SALT_V2.netherGlowstone, cx, cz)
		const bx = cx * CHUNK_X
		const bz = cz * CHUNK_Z
		const columns: Array<readonly [number, number]> = []
		for (let probe = 0; probe < CLUSTER_PROBES; probe++) {
			columns.push([rng.nextInt(CHUNK_X), rng.nextInt(CHUNK_Z)])
		}
		for (let z = 0; z < CHUNK_Z; z++) {
			for (let x = 0; x < CHUNK_X; x++) columns.push([x, z])
		}
		const picked: Site[] = []
		const ceilings: Site[] = []
		for (const [x, z] of columns) {
			if (picked.length >= NETHER_GEN.glowstoneClustersPerChunk) break
			ceilings.length = 0
			ceilingsInColumn(bx + x, bz + z, ceilings)
			for (const site of ceilings) {
				if (picked.length >= NETHER_GEN.glowstoneClustersPerChunk) break
				if (picked.every((other) => apart(other, site))) picked.push(site)
			}
		}
		return picked
	}

	/** Refuses the write unless the chunk is loaded and the voxel is open air. */
	const placeGlow = (view: VoxelEditView, wx: number, y: number, wz: number): boolean => {
		if (y <= SEA || y > SHELL_HI) return false
		if (!view.isLoaded(Math.floor(wx / CHUNK_X), Math.floor(wz / CHUNK_Z))) return false
		if (view.getBlock(wx, y, wz) !== BLOCK.AIR) return false
		view.setBlock(wx, y, wz, BLOCK.GLOWSTONE)
		return true
	}

	/**
	 * A cluster hangs from the ceiling it was anchored to. The top layer only
	 * takes voxels the field left open directly under rock, and the layer below
	 * only hangs off a voxel of the top layer, so no glowstone ever floats.
	 */
	const buildCluster = (view: VoxelEditView, site: Site): void => {
		const { wx, y, wz } = site
		const top: Array<readonly [number, number]> = []
		if (placeGlow(view, wx, y, wz)) top.push([wx, wz])
		for (const [dx, dz] of LATERALS) {
			const lx = wx + dx
			const lz = wz + dz
			if (hash01(seed, SALT_V2.netherGlowstone, lx, y, lz) >= CLUSTER_SPREAD) continue
			if (!terrain.openAt(lx, y, lz)) continue
			// The roof above SHELL_HI is closed, so only the field can open y + 1.
			if (y < SHELL_HI && terrain.openAt(lx, y + 1, lz)) continue
			if (placeGlow(view, lx, y, lz)) top.push([lx, lz])
		}
		for (const [gx, gz] of top) {
			if (hash01(seed, SALT_V2.netherGlowstone, gx, y - 1, gz) >= CLUSTER_DEPTH) continue
			if (!terrain.openAt(gx, y - 1, gz)) continue
			placeGlow(view, gx, y - 1, gz)
		}
	}

	return {
		placeChunk(cx: number, cz: number, blocks: Uint16Array, _fluids: Uint8Array): void {
			const bx = cx * CHUNK_X
			const bz = cz * CHUNK_Z
			for (let z = 0; z < CHUNK_Z; z++) {
				for (let x = 0; x < CHUNK_X; x++) {
					const root = veinRootY(blocks, x, z, bx + x, bz + z)
					if (root >= 0) placeVein(blocks, x, root, z, bx + x, bz + z)
				}
			}
			for (let z = 0; z < CHUNK_Z; z++) {
				for (let x = 0; x < CHUNK_X; x++) {
					const y = cavernFloorY(blocks, x, z)
					if (y < 0) continue
					const wx = bx + x
					const wz = bz + z
					// Magma rolls first because it is the feature that wants the
					// shore of the lava sea. Soul sand then takes the floors magma
					// left, so it covers the frozen share of the floors minus the
					// few per cent magma claimed before it.
					if (hash01(seed, SALT_V2.netherMagma, wx, CH_GATE, wz) < magmaChance(y)) {
						placePatch(blocks, x, y, z, BLOCK_V2.MAGMA_BLOCK)
						continue
					}
					const soul = hash01(seed, SALT_V2.netherSoulSand, wx, CH_GATE, wz)
					if (soul < NETHER_GEN.soulSandPatchChance) {
						placePatch(blocks, x, y, z, BLOCK_V2.SOUL_SAND)
					}
				}
			}
		},

		decorate(cx: number, cz: number, view: VoxelEditView): void {
			for (const site of clusterSites(cx, cz)) buildCluster(view, site)
		},
	}
}
