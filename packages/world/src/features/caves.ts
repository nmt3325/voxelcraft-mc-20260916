/**
 * 3D noise caves. Owned by task world-c.
 *
 * Two independent systems share one pass:
 *   - cheese caves: a single fbm3 field above a threshold, which produces the
 *     large open chambers.
 *   - ridged spaghetti tunnels: two ridged fields that must both be near zero,
 *     which produces the long thin tubes.
 *
 * Both fields are evaluated on a coarse lattice anchored to world coordinates
 * and trilinearly interpolated, so neighbouring chunks agree on their shared
 * border and a full per-voxel evaluation (roughly 20x the noise calls) never
 * happens. Three exact optimisations keep the pass inside the perf budget, and
 * all of them leave the carved result bit for bit identical:
 *   - the lattice is only filled up to the highest voxel this chunk can carve,
 *   - a lattice cell whose eight corners all stay under both thresholds is
 *     skipped in one step, which is sound because a trilinear interpolation is
 *     a convex combination of its corners and never exceeds their maximum,
 *   - the second ridged field is only evaluated where it can matter. A tunnel
 *     needs both fields near zero, so 1 - |a| is an upper bound of the tunnel
 *     value; where that bound already stays under the threshold the cell can
 *     never hold a tunnel and the second field is never sampled. The same
 *     bound also removes the per voxel tunnel interpolation in those cells.
 *
 * Three limits keep the result playable. Each one is a pure function of a world
 * column, so they stay seamless across chunk borders:
 *   1. the bedrock shell (y < BEDROCK_LAYERS) is never touched,
 *   2. a crust is kept under every surface: thicker under water so that no cave
 *      can drain the ocean, capped along the shoreline, and eroded down to the
 *      lowest of the four neighbouring columns so a steep slope is never left
 *      with a one-voxel ceiling,
 *   3. both thresholds fade out towards the crust and towards bedrock, so a
 *      cave tapers off instead of slicing the last blocks open.
 *
 * H-06 hot-path notes. Every change below is value preserving, never a change
 * of the arithmetic itself: no float operation is reassociated, reordered or
 * turned into a reciprocal multiplication.
 *   - The trilinear weights of a column (tx, tz) and of a y level (iy0, ty) are
 *     loop invariants, so the eight corner values, the four x interpolations
 *     and the two z interpolations of a lattice cell are computed once per run
 *     of voxels inside that cell instead of once per voxel. What is left per
 *     voxel is `z0 + (z1 - z0) * ty`, with the subtraction hoisted as well.
 *   - Lattice indices are reached through precomputed corner offsets rather
 *     than a multiply-heavy index helper.
 *   - The fade bias, the per-column lattice weights and the carvable block
 *     predicate are precomputed tables; the bias table stores exactly the
 *     expression the scalar version evaluated.
 *   - Frozen constants are read into module locals once.
 */
import { BEDROCK_LAYERS, BLOCK, CHUNK_X, CHUNK_Z, SEA_LEVEL } from '@voxelcraft/core-types'
import type { CaveCarver, TerrainContext } from '../internal'
import { CAVES, SALT, isCarvableBlock } from '../internal'

/** Extra crust under a submerged column, on top of CAVES.surfaceMargin. */
const SUBMERGED_SEAL = 6
/** Columns at most this far above sea level count as shoreline. */
const SHORE_BAND = 6
/** Shoreline columns are never carved above this height. */
const SHORE_CEILING = SEA_LEVEL - 2
/** Distance over which the thresholds fade out near the crust and bedrock. */
const FADE_BLOCKS = 6
/** Threshold offset at the very edge of the carvable band. */
const FADE_BIAS = 0.25
/** Tunnels are allowed to approach the crust closer than chambers. */
const TUNNEL_FADE_SCALE = 0.3

const HALO = CHUNK_X + 2

/* Frozen constants, read once instead of per voxel. Same values. */
const MIN_Y = CAVES.minY
const MAX_Y = CAVES.maxY
const STEP = CAVES.latticeStep
const SURFACE_MARGIN = CAVES.surfaceMargin
const CHEESE_THRESHOLD = CAVES.cheeseThreshold
const TUNNEL_THRESHOLD = CAVES.tunnelThreshold
const SQUASH = CAVES.verticalSquash
const CHEESE_FBM = CAVES.cheese
const TUNNEL_FBM = CAVES.tunnel
const SALT_CHEESE = SALT.caveCheese
const SALT_TUNNEL_A = SALT.caveTunnelA
const SALT_TUNNEL_B = SALT.caveTunnelB
const AIR = BLOCK.AIR

/** FADE_BIAS * (1 - d / FADE_BLOCKS) for every distance inside the band. */
const FADE_BY_DISTANCE = ((): Float64Array => {
	const table = new Float64Array(FADE_BLOCKS)
	for (let d = 0; d < FADE_BLOCKS; d++) table[d] = FADE_BIAS * (1 - d / FADE_BLOCKS)
	return table
})()

/**
 * isCarvableBlock as a table, built by asking the real predicate, so the two can
 * never disagree. Ids outside the table fall back to the predicate itself.
 */
const CARVABLE_LIMIT = 1024
const CARVABLE = ((): Uint8Array => {
	const table = new Uint8Array(CARVABLE_LIMIT)
	for (let id = 0; id < CARVABLE_LIMIT; id++) table[id] = isCarvableBlock(id) ? 1 : 0
	return table
})()

export function createCaveCarver(terrain: TerrainContext): CaveCarver {
	const noise = terrain.noise
	const step = STEP
	const nx = CHUNK_X / step + 1
	const nz = CHUNK_Z / step + 1
	const ny = Math.floor((MAX_Y - MIN_Y) / step) + 2
	const cellsX = nx - 1
	const cellsZ = nz - 1
	const cellsY = ny - 1
	const cheeseField = new Float32Array(nx * nz * ny)
	/** |a| of the first ridged field, the cheap half of the tunnel test. */
	const absAField = new Float32Array(nx * nz * ny)
	/** Exact tunnel value, only filled where a tunnel is still possible. */
	const tunnelField = new Float32Array(nx * nz * ny)
	const tunnelReady = new Uint8Array(nx * nz * ny)
	const cheeseCellMax = new Float32Array(cellsX * cellsZ * cellsY)
	const tunnelCellMax = new Float32Array(cellsX * cellsZ * cellsY)
	/** Crust height per column of the 18x18 halo, and the eroded per-column top. */
	const haloTop = new Int32Array(HALO * HALO)
	const tops = new Int32Array(CHUNK_X * CHUNK_Z)
	/** Bedrock always wins over caves, whatever CAVES.minY says. */
	const yFloor = BEDROCK_LAYERS > MIN_Y + 1 ? BEDROCK_LAYERS : MIN_Y + 1
	/** Lattice index strides: +1 in x, +nx in z, +nx*nz in y. */
	const zStride = nx
	const yStride = nx * nz

	/* Per-voxel lattice weights. x and z only ever run over one chunk and y over
	 * the carvable band, so every floor and division below happens once here
	 * instead of once per voxel, with exactly the same values. */
	const latIx0 = new Int32Array(CHUNK_X)
	const latTx = new Float64Array(CHUNK_X)
	const latDx = new Int32Array(CHUNK_X)
	const latCellX = new Int32Array(CHUNK_X)
	for (let x = 0; x < CHUNK_X; x++) {
		const fx = x / step
		const ix0 = Math.floor(fx)
		latIx0[x] = ix0
		latTx[x] = fx - ix0
		latDx[x] = (ix0 + 1 < nx ? ix0 + 1 : ix0) - ix0
		latCellX[x] = ix0 < cellsX ? ix0 : cellsX - 1
	}
	const latIz0 = new Int32Array(CHUNK_Z)
	const latTz = new Float64Array(CHUNK_Z)
	const latDz = new Int32Array(CHUNK_Z)
	const latCellZ = new Int32Array(CHUNK_Z)
	for (let z = 0; z < CHUNK_Z; z++) {
		const fz = z / step
		const iz0 = Math.floor(fz)
		latIz0[z] = iz0
		latTz[z] = fz - iz0
		latDz[z] = ((iz0 + 1 < nz ? iz0 + 1 : iz0) - iz0) * zStride
		latCellZ[z] = iz0 < cellsZ ? iz0 : cellsZ - 1
	}
	const latIy0 = new Int32Array(MAX_Y + 1)
	const latTy = new Float64Array(MAX_Y + 1)
	for (let y = 0; y <= MAX_Y; y++) {
		const iy0 = Math.floor((y - MIN_Y) / step)
		latIy0[y] = iy0
		latTy[y] = (y - MIN_Y) / step - iy0
	}

	function li(ix: number, iy: number, iz: number): number {
		return (iy * nz + iz) * nx + ix
	}

	function cellIndex(ix: number, iy: number, iz: number): number {
		return (iy * cellsZ + iz) * cellsX + ix
	}

	function haloIndex(hx: number, hz: number): number {
		return (hz + 1) * HALO + (hx + 1)
	}

	/** Completes the exact tunnel value on the eight corners of one cell. */
	function fillTunnelCorners(
		base: number,
		ix: number,
		iy: number,
		iz: number,
		bx: number,
		bz: number,
	): void {
		for (let dy = 0; dy <= 1; dy++) {
			const wy = MIN_Y + (iy + dy) * step
			const sy = wy * SQUASH
			for (let dz = 0; dz <= 1; dz++) {
				const wz = bz + (iz + dz) * step
				for (let dx = 0; dx <= 1; dx++) {
					const k = base + dx + dz * zStride + dy * yStride
					if (tunnelReady[k] === 1) continue
					const absA = absAField[k]
					const b = noise.fbm3(SALT_TUNNEL_B, bx + (ix + dx) * step, sy, wz, TUNNEL_FBM)
					const absB = b < 0 ? -b : b
					tunnelField[k] = 1 - (absA > absB ? absA : absB)
					tunnelReady[k] = 1
				}
			}
		}
	}

	/** Highest voxel a column may lose, before the neighbour erosion. */
	function crustTop(surfaceY: number): number {
		let top = surfaceY - SURFACE_MARGIN
		if (surfaceY < SEA_LEVEL) {
			top -= SUBMERGED_SEAL
		} else if (surfaceY <= SEA_LEVEL + SHORE_BAND && top > SHORE_CEILING) {
			top = SHORE_CEILING
		}
		return top > MAX_Y ? MAX_Y : top
	}

	/** Largest of the eight corner values of a cell whose base corner is `o`. */
	function max8(field: Float32Array, o: number): number {
		const oz = o + zStride
		const oy = o + yStride
		const oyz = oy + zStride
		let m = field[o]
		let v = field[o + 1]
		if (v > m) m = v
		v = field[oz]
		if (v > m) m = v
		v = field[oz + 1]
		if (v > m) m = v
		v = field[oy]
		if (v > m) m = v
		v = field[oy + 1]
		if (v > m) m = v
		v = field[oyz]
		if (v > m) m = v
		v = field[oyz + 1]
		if (v > m) m = v
		return m
	}

	/** Smallest of the eight corner values of a cell whose base corner is `o`. */
	function min8(field: Float32Array, o: number): number {
		const oz = o + zStride
		const oy = o + yStride
		const oyz = oy + zStride
		let m = field[o]
		let v = field[o + 1]
		if (v < m) m = v
		v = field[oz]
		if (v < m) m = v
		v = field[oz + 1]
		if (v < m) m = v
		v = field[oy]
		if (v < m) m = v
		v = field[oy + 1]
		if (v < m) m = v
		v = field[oyz]
		if (v < m) m = v
		v = field[oyz + 1]
		if (v < m) m = v
		return m
	}

	return {
		carveChunk(cx, cz, blocks, fluids, heights): void {
			const bx = cx * CHUNK_X
			const bz = cz * CHUNK_Z

			// Crust of the chunk plus a one column halo. The halo is sampled from
			// the terrain, so the erosion below is a pure function of the world
			// column and both sides of a chunk border agree on it.
			for (let hz = -1; hz <= CHUNK_Z; hz++) {
				const inZ = hz >= 0 && hz < CHUNK_Z
				for (let hx = -1; hx <= CHUNK_X; hx++) {
					const inside = inZ && hx >= 0 && hx < CHUNK_X
					const surfaceY = inside ? heights[(hz << 4) | hx] : terrain.surfaceYAt(bx + hx, bz + hz)
					haloTop[haloIndex(hx, hz)] = crustTop(surfaceY)
				}
			}

			let maxTop = yFloor - 1
			for (let z = 0; z < CHUNK_Z; z++) {
				for (let x = 0; x < CHUNK_X; x++) {
					let top = haloTop[haloIndex(x, z)]
					const west = haloTop[haloIndex(x - 1, z)]
					const east = haloTop[haloIndex(x + 1, z)]
					const north = haloTop[haloIndex(x, z - 1)]
					const south = haloTop[haloIndex(x, z + 1)]
					if (west < top) top = west
					if (east < top) top = east
					if (north < top) top = north
					if (south < top) top = south
					tops[(z << 4) | x] = top
					if (top > maxTop) maxTop = top
				}
			}
			if (maxTop < yFloor) return

			// Only the lattice levels this chunk can actually read are filled.
			let levels = Math.floor((maxTop - MIN_Y) / step) + 1
			if (levels > ny - 1) levels = ny - 1
			tunnelReady.fill(0, 0, (levels + 1) * yStride)
			for (let iy = 0; iy <= levels; iy++) {
				const sy = (MIN_Y + iy * step) * SQUASH
				for (let iz = 0; iz < nz; iz++) {
					const wz = bz + iz * step
					let k = li(0, iy, iz)
					for (let ix = 0; ix < nx; ix++, k++) {
						const wx = bx + ix * step
						cheeseField[k] = noise.fbm3(SALT_CHEESE, wx, sy, wz, CHEESE_FBM)
						const a = noise.fbm3(SALT_TUNNEL_A, wx, sy, wz, TUNNEL_FBM)
						absAField[k] = a < 0 ? -a : a
					}
				}
			}
			for (let iy = 0; iy < levels; iy++) {
				for (let iz = 0; iz < cellsZ; iz++) {
					for (let ix = 0; ix < cellsX; ix++) {
						const k = cellIndex(ix, iy, iz)
						const base = li(ix, iy, iz)
						cheeseCellMax[k] = max8(cheeseField, base)
						// 1 - min|a| is the largest tunnel value this cell could
						// reach. Under the threshold it is already excluded, so the
						// second field stays unsampled.
						const bound = 1 - min8(absAField, base)
						if (bound <= TUNNEL_THRESHOLD) {
							tunnelCellMax[k] = bound
							continue
						}
						fillTunnelCorners(base, ix, iy, iz, bx, bz)
						tunnelCellMax[k] = max8(tunnelField, base)
					}
				}
			}

			for (let z = 0; z < CHUNK_Z; z++) {
				const iz0 = latIz0[z]
				const tz = latTz[z]
				const dzOff = latDz[z]
				const izCell = latCellZ[z]
				const zBase = z << 4
				for (let x = 0; x < CHUNK_X; x++) {
					const ix0 = latIx0[x]
					const tx = latTx[x]
					const dxOff = latDx[x]
					const ixCell = latCellX[x]
					const colBase = zBase | x
					const top = tops[colBase]
					let y = yFloor
					while (y <= top) {
						const iy0 = latIy0[y]
						const cellTop = MIN_Y + (iy0 + 1) * step - 1
						const runEnd = cellTop < top ? cellTop : top
						const cell = (iy0 * cellsZ + izCell) * cellsX + ixCell
						// A cell above the tunnel threshold always has its eight exact
						// corner values filled in, so the interpolation below is safe.
						const tunnelPossible = tunnelCellMax[cell] > TUNNEL_THRESHOLD
						if (!tunnelPossible && cheeseCellMax[cell] <= CHEESE_THRESHOLD) {
							y = runEnd + 1
							continue
						}
						// Everything except the y weight is constant across the run, so
						// the eight corner reads and the x/z interpolations happen once.
						const o000 = (iy0 * nz + iz0) * nx + ix0
						const o001 = o000 + dzOff
						const o010 = o000 + yStride
						const o011 = o010 + dzOff
						const ca = cheeseField[o000]
						const cb = cheeseField[o000 + dxOff]
						const cc = cheeseField[o001]
						const cd = cheeseField[o001 + dxOff]
						const ce = cheeseField[o010]
						const cf = cheeseField[o010 + dxOff]
						const cg = cheeseField[o011]
						const ch = cheeseField[o011 + dxOff]
						const cx00 = ca + (cb - ca) * tx
						const cx01 = cc + (cd - cc) * tx
						const cx10 = ce + (cf - ce) * tx
						const cx11 = cg + (ch - cg) * tx
						const cheeseBase = cx00 + (cx01 - cx00) * tz
						const cheeseSpan = cx10 + (cx11 - cx10) * tz - cheeseBase
						let tunnelBase = 0
						let tunnelSpan = 0
						if (tunnelPossible) {
							const ta = tunnelField[o000]
							const tb = tunnelField[o000 + dxOff]
							const tc = tunnelField[o001]
							const td = tunnelField[o001 + dxOff]
							const te = tunnelField[o010]
							const tf = tunnelField[o010 + dxOff]
							const tg = tunnelField[o011]
							const th = tunnelField[o011 + dxOff]
							const tx00 = ta + (tb - ta) * tx
							const tx01 = tc + (td - tc) * tx
							const tx10 = te + (tf - te) * tx
							const tx11 = tg + (th - tg) * tx
							tunnelBase = tx00 + (tx01 - tx00) * tz
							tunnelSpan = tx10 + (tx11 - tx10) * tz - tunnelBase
						}
						for (; y <= runEnd; y++) {
							const ty = latTy[y]
							const dTop = top - y
							const dFloor = y - yFloor
							const d = dTop < dFloor ? dTop : dFloor
							const bias = d >= FADE_BLOCKS ? 0 : FADE_BY_DISTANCE[d]
							let carve = cheeseBase + cheeseSpan * ty > CHEESE_THRESHOLD + bias
							if (!carve && tunnelPossible) {
								carve = tunnelBase + tunnelSpan * ty > TUNNEL_THRESHOLD + bias * TUNNEL_FADE_SCALE
							}
							if (!carve) continue
							const i = (y << 8) | colBase
							const id = blocks[i]
							if (id < CARVABLE_LIMIT ? CARVABLE[id] === 0 : !isCarvableBlock(id)) continue
							blocks[i] = AIR
							fluids[i] = 0
						}
					}
				}
			}
		},
	}
}
