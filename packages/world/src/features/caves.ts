/**
 * 3D noise caves. Owned by task world-c.
 *
 * Two independent systems share one pass:
 *   - cheese caves: a single fbm3 field above a threshold, which produces the
 *     large open chambers.
 *   - spaghetti tunnels: two ridged fields that must both be near zero, which
 *     produces long thin tubes.
 *
 * Both fields are evaluated on a coarse lattice and trilinearly interpolated.
 * That is what keeps chunk generation inside the perf budget: a full per-voxel
 * evaluation would be roughly 20x more noise calls. The lattice is anchored to
 * world coordinates, so neighbouring chunks agree on their shared border and
 * carving stays order independent.
 */
import { BLOCK, CHUNK_X, CHUNK_Z, blockIndex } from '@voxelcraft/core-types'
import type { CaveCarver, TerrainContext } from '../internal'
import { CAVES, SALT, columnIndex, isCarvableBlock } from '../internal'

export function createCaveCarver(terrain: TerrainContext): CaveCarver {
	const noise = terrain.noise
	const step = CAVES.latticeStep
	const nx = CHUNK_X / step + 1
	const nz = CHUNK_Z / step + 1
	const ny = Math.floor((CAVES.maxY - CAVES.minY) / step) + 2
	const cheeseField = new Float32Array(nx * nz * ny)
	const tunnelField = new Float32Array(nx * nz * ny)

	function li(ix: number, iy: number, iz: number): number {
		return (iy * nz + iz) * nx + ix
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

			for (let iy = 0; iy < ny; iy++) {
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

			for (let z = 0; z < CHUNK_Z; z++) {
				const fz = z / step
				const iz0 = Math.floor(fz)
				const tz = fz - iz0
				const iz1 = iz0 + 1 < nz ? iz0 + 1 : iz0
				for (let x = 0; x < CHUNK_X; x++) {
					const fx = x / step
					const ix0 = Math.floor(fx)
					const tx = fx - ix0
					const ix1 = ix0 + 1 < nx ? ix0 + 1 : ix0
					// Keep a crust under the surface so caves never strip the terrain.
					const surfaceLimit = heights[columnIndex(x, z)] - CAVES.surfaceMargin
					const top = surfaceLimit < CAVES.maxY ? surfaceLimit : CAVES.maxY
					for (let y = CAVES.minY + 1; y <= top; y++) {
						const fy = (y - CAVES.minY) / step
						const iy0 = Math.floor(fy)
						const ty = fy - iy0
						const iy1 = iy0 + 1 < ny ? iy0 + 1 : iy0
						const cheese = tri(cheeseField, ix0, ix1, iy0, iy1, iz0, iz1, tx, ty, tz)
						let carve = cheese > CAVES.cheeseThreshold
						if (!carve) {
							const tunnel = tri(tunnelField, ix0, ix1, iy0, iy1, iz0, iz1, tx, ty, tz)
							carve = tunnel > CAVES.tunnelThreshold
						}
						if (!carve) continue
						const i = blockIndex(x, y, z)
						if (!isCarvableBlock(blocks[i])) continue
						blocks[i] = BLOCK.AIR
						fluids[i] = 0
					}
				}
			}
		},
	}
}
