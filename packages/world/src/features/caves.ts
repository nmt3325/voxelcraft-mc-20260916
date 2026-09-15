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
 * happens. Two exact optimisations keep the pass well inside the perf budget:
 * the lattice is only filled up to the highest voxel this chunk can carve, and
 * a lattice cell whose eight corners all stay under both thresholds is skipped
 * in a single step. The skip is sound because a trilinear interpolation is a
 * convex combination of its corners and can never exceed their maximum.
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
 */
import {
	BEDROCK_LAYERS,
	BLOCK,
	CHUNK_X,
	CHUNK_Z,
	SEA_LEVEL,
	blockIndex,
} from '@voxelcraft/core-types'
import type { CaveCarver, TerrainContext } from '../internal'
import { CAVES, SALT, columnIndex, isCarvableBlock } from '../internal'

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

export function createCaveCarver(terrain: TerrainContext): CaveCarver {
	const noise = terrain.noise
	const step = CAVES.latticeStep
	const nx = CHUNK_X / step + 1
	const nz = CHUNK_Z / step + 1
	const ny = Math.floor((CAVES.maxY - CAVES.minY) / step) + 2
	const cellsX = nx - 1
	const cellsZ = nz - 1
	const cellsY = ny - 1
	const cheeseField = new Float32Array(nx * nz * ny)
	const tunnelField = new Float32Array(nx * nz * ny)
	const cheeseCellMax = new Float32Array(cellsX * cellsZ * cellsY)
	const tunnelCellMax = new Float32Array(cellsX * cellsZ * cellsY)
	/** Crust height per column of the 18x18 halo, and the eroded per-column top. */
	const haloTop = new Int32Array(HALO * HALO)
	const tops = new Int32Array(CHUNK_X * CHUNK_Z)
	/** Bedrock always wins over caves, whatever CAVES.minY says. */
	const yFloor = BEDROCK_LAYERS > CAVES.minY + 1 ? BEDROCK_LAYERS : CAVES.minY + 1

	function li(ix: number, iy: number, iz: number): number {
		return (iy * nz + iz) * nx + ix
	}

	function cellIndex(ix: number, iy: number, iz: number): number {
		return (iy * cellsZ + iz) * cellsX + ix
	}

	function haloIndex(hx: number, hz: number): number {
		return (hz + 1) * HALO + (hx + 1)
	}

	function cheeseAt(wx: number, wy: number, wz: number): number {
		return noise.fbm3(SALT.caveCheese, wx, wy * CAVES.verticalSquash, wz, CAVES.cheese)
	}

	function tunnelAt(wx: number, wy: number, wz: number): number {
		const sy = wy * CAVES.verticalSquash
		const a = noise.fbm3(SALT.caveTunnelA, wx, sy, wz, CAVES.tunnel)
		const b = noise.fbm3(SALT.caveTunnelB, wx, sy, wz, CAVES.tunnel)
		const absA = a < 0 ? -a : a
		const absB = b < 0 ? -b : b
		return 1 - (absA > absB ? absA : absB)
	}

	/** Highest voxel a column may lose, before the neighbour erosion. */
	function crustTop(surfaceY: number): number {
		let top = surfaceY - CAVES.surfaceMargin
		if (surfaceY < SEA_LEVEL) {
			top -= SUBMERGED_SEAL
		} else if (surfaceY <= SEA_LEVEL + SHORE_BAND && top > SHORE_CEILING) {
			top = SHORE_CEILING
		}
		return top > CAVES.maxY ? CAVES.maxY : top
	}

	function edgeBias(y: number, top: number): number {
		const dTop = top - y
		const dFloor = y - yFloor
		const d = dTop < dFloor ? dTop : dFloor
		if (d >= FADE_BLOCKS) return 0
		return FADE_BIAS * (1 - d / FADE_BLOCKS)
	}

	function max8(field: Float32Array, ix: number, iy: number, iz: number): number {
		let m = field[li(ix, iy, iz)]
		for (let dy = 0; dy <= 1; dy++) {
			for (let dz = 0; dz <= 1; dz++) {
				for (let dx = 0; dx <= 1; dx++) {
					const v = field[li(ix + dx, iy + dy, iz + dz)]
					if (v > m) m = v
				}
			}
		}
		return m
	}

	function tri(
		field: Float32Array,
		ix0: number,
		ix1: number,
		iy0: number,
		iy1: number,
		iz0: number,
		iz1: number,
		tx: number,
		ty: number,
		tz: number,
	): number {
		const a = field[li(ix0, iy0, iz0)]
		const b = field[li(ix1, iy0, iz0)]
		const c = field[li(ix0, iy0, iz1)]
		const d = field[li(ix1, iy0, iz1)]
		const e = field[li(ix0, iy1, iz0)]
		const f = field[li(ix1, iy1, iz0)]
		const g = field[li(ix0, iy1, iz1)]
		const h = field[li(ix1, iy1, iz1)]
		const x00 = a + (b - a) * tx
		const x01 = c + (d - c) * tx
		const x10 = e + (f - e) * tx
		const x11 = g + (h - g) * tx
		const z0 = x00 + (x01 - x00) * tz
		const z1 = x10 + (x11 - x10) * tz
		return z0 + (z1 - z0) * ty
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
					const surfaceY = inside
						? heights[columnIndex(hx, hz)]
						: terrain.surfaceYAt(bx + hx, bz + hz)
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
					tops[columnIndex(x, z)] = top
					if (top > maxTop) maxTop = top
				}
			}
			if (maxTop < yFloor) return

			// Only the lattice levels this chunk can actually read are filled.
			let levels = Math.floor((maxTop - CAVES.minY) / step) + 1
			if (levels > ny - 1) levels = ny - 1
			for (let iy = 0; iy <= levels; iy++) {
				const wy = CAVES.minY + iy * step
				for (let iz = 0; iz < nz; iz++) {
					const wz = bz + iz * step
					for (let ix = 0; ix < nx; ix++) {
						const wx = bx + ix * step
						const k = li(ix, iy, iz)
						cheeseField[k] = cheeseAt(wx, wy, wz)
						tunnelField[k] = tunnelAt(wx, wy, wz)
					}
				}
			}
			for (let iy = 0; iy < levels; iy++) {
				for (let iz = 0; iz < cellsZ; iz++) {
					for (let ix = 0; ix < cellsX; ix++) {
						const k = cellIndex(ix, iy, iz)
						cheeseCellMax[k] = max8(cheeseField, ix, iy, iz)
						tunnelCellMax[k] = max8(tunnelField, ix, iy, iz)
					}
				}
			}

			for (let z = 0; z < CHUNK_Z; z++) {
				const fz = z / step
				const iz0 = Math.floor(fz)
				const tz = fz - iz0
				const iz1 = iz0 + 1 < nz ? iz0 + 1 : iz0
				const izCell = iz0 < cellsZ ? iz0 : cellsZ - 1
				for (let x = 0; x < CHUNK_X; x++) {
					const fx = x / step
					const ix0 = Math.floor(fx)
					const tx = fx - ix0
					const ix1 = ix0 + 1 < nx ? ix0 + 1 : ix0
					const ixCell = ix0 < cellsX ? ix0 : cellsX - 1
					const top = tops[columnIndex(x, z)]
					let y = yFloor
					while (y <= top) {
						const iy0 = Math.floor((y - CAVES.minY) / step)
						const cellTop = CAVES.minY + (iy0 + 1) * step - 1
						const runEnd = cellTop < top ? cellTop : top
						const cell = cellIndex(ixCell, iy0, izCell)
						if (
							cheeseCellMax[cell] <= CAVES.cheeseThreshold &&
							tunnelCellMax[cell] <= CAVES.tunnelThreshold
						) {
							y = runEnd + 1
							continue
						}
						const iy1 = iy0 + 1
						for (; y <= runEnd; y++) {
							const ty = (y - CAVES.minY) / step - iy0
							const bias = edgeBias(y, top)
							const cheese = tri(cheeseField, ix0, ix1, iy0, iy1, iz0, iz1, tx, ty, tz)
							let carve = cheese > CAVES.cheeseThreshold + bias
							if (!carve) {
								const tunnel = tri(tunnelField, ix0, ix1, iy0, iy1, iz0, iz1, tx, ty, tz)
								carve = tunnel > CAVES.tunnelThreshold + bias * TUNNEL_FADE_SCALE
							}
							if (!carve) continue
							const i = blockIndex(x, y, z)
							if (!isCarvableBlock(blocks[i])) continue
							blocks[i] = BLOCK.AIR
							fluids[i] = 0
						}
					}
				}
			}
		},
	}
}
