/**
 * Nether bulk terrain. Owned by task v2-world (L1-F).
 *
 * One pass builds the whole shell of a nether chunk:
 *   - a rough bedrock floor in [0, NETHER_GEN.floorY),
 *   - solid netherrack from there up to NETHER_GEN.roofY,
 *   - a rough bedrock roof in [roofY, roofY + bedrockLayers) whose topmost
 *     layer is always solid, so no column is ever open to the void,
 *   - caverns carved out of the netherrack wherever the open space field rises
 *     above NETHER_GEN.caveThreshold, with every carved voxel at or below
 *     NETHER_GEN.lavaSeaLevel filled by the lava sea instead of air.
 *
 * The field is evaluated on a coarse lattice anchored to world coordinates and
 * trilinearly interpolated, so two chunks that share a border carve the same
 * voxels and a full per-voxel noise evaluation never happens. A lattice cell
 * whose eight corners all stay under the threshold is skipped in one step,
 * which is sound because a trilinear interpolation is a convex combination of
 * its corners and never exceeds their maximum.
 *
 * `openAt` recomputes that interpolation from the global lattice and keeps its
 * corners in a Float32Array, exactly like the chunk path, so both round the
 * same way and one voxel gets the same answer whether it came from a generated
 * chunk or from a direct query. That is what lets `floorYAt`, `sampleColumn`
 * and the portal landing search agree with a generated chunk voxel for voxel.
 *
 * Everything is a pure function of (seed, wx, y, wz): no wall clock, no global
 * PRNG, and no dependency on generation order.
 */
import {
	BLOCK,
	BLOCK_V2,
	CHUNK_AREA,
	CHUNK_X,
	CHUNK_Z,
	FLUID,
	NETHER_GEN,
	blockIndex,
	hash01,
	packFluid,
} from '@voxelcraft/core-types'
import type { NetherTerrain, NoiseBasis } from '../internal'
import { NETHER_NOISE, NETHER_ROOF_TOP, SALT_V2 } from '../internal'
import { clamp1 } from '../noise'

const LAVA_SOURCE = packFluid({ kind: FLUID.Lava, level: 0, falling: false })
const STEP = NETHER_NOISE.latticeStep
/** Lowest and highest voxel of the carvable netherrack shell. */
const CARVE_LO = NETHER_GEN.floorY
const CARVE_HI = NETHER_GEN.roofY - 1
const LAYERS = NETHER_GEN.bedrockLayers

/**
 * Trilinear blend of eight lattice corners. Both the chunk path and `openAt`
 * call this with corner values that have already been rounded to f32, so they
 * cannot drift apart.
 */
function blend(
	a: number,
	b: number,
	c: number,
	d: number,
	e: number,
	f: number,
	g: number,
	h: number,
	tx: number,
	ty: number,
	tz: number,
): number {
	const x00 = a + (b - a) * tx
	const x01 = c + (d - c) * tx
	const x10 = e + (f - e) * tx
	const x11 = g + (h - g) * tx
	const z0 = x00 + (x01 - x00) * tz
	const z1 = x10 + (x11 - x10) * tz
	return z0 + (z1 - z0) * ty
}

/**
 * Threshold offset near the shell boundary. Caverns taper off towards the roof
 * and the floor instead of slicing the last blocks open.
 */
function edgeBias(y: number): number {
	const dFloor = y - CARVE_LO
	const dRoof = CARVE_HI - y
	const d = dFloor < dRoof ? dFloor : dRoof
	if (d >= NETHER_NOISE.fadeBlocks) return 0
	return NETHER_NOISE.fadeBias * (1 - d / NETHER_NOISE.fadeBlocks)
}

export function createNetherTerrain(seed: number, noise: NoiseBasis): NetherTerrain {
	const nx = CHUNK_X / STEP + 1
	const nz = CHUNK_Z / STEP + 1
	const ny = Math.floor((CARVE_HI - CARVE_LO) / STEP) + 2
	const cellsX = nx - 1
	const cellsZ = nz - 1
	const cellsY = ny - 1
	const field = new Float32Array(nx * nz * ny)
	const cellMax = new Float32Array(cellsX * cellsZ * cellsY)
	/** Corner cache of the last lattice cell `openAt` touched. */
	const corners = new Float32Array(8)
	let cacheX = Number.NaN
	let cacheY = Number.NaN
	let cacheZ = Number.NaN

	function li(ix: number, iy: number, iz: number): number {
		return (iy * nz + iz) * nx + ix
	}

	function cellIndex(ix: number, iy: number, iz: number): number {
		return (iy * cellsZ + iz) * cellsX + ix
	}

	/** Open space field, scaled into the range the frozen threshold expects. */
	function space(wx: number, wy: number, wz: number): number {
		const v = noise.fbm3(
			SALT_V2.netherSpace,
			wx,
			wy * NETHER_NOISE.verticalSquash,
			wz,
			NETHER_NOISE.space,
		)
		return clamp1(v * NETHER_NOISE.amplitude)
	}

	function max8(ix: number, iy: number, iz: number): number {
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

	/** Bedrock floor, netherrack bulk and bedrock roof, before any carving. */
	function fillShell(bx: number, bz: number, blocks: Uint16Array): void {
		// blockIndex packs one y layer into [y * CHUNK_AREA, (y + 1) * CHUNK_AREA),
		// so the whole netherrack bulk is a handful of contiguous runs.
		for (let y = CARVE_LO; y < NETHER_GEN.roofY; y++) {
			const base = y * CHUNK_AREA
			blocks.fill(BLOCK_V2.NETHERRACK, base, base + CHUNK_AREA)
		}
		// The bedrock layers are rough, so they are written voxel by voxel. y = 0
		// and the top roof layer are always solid: no column opens into the void.
		for (let z = 0; z < CHUNK_Z; z++) {
			const wz = bz + z
			for (let x = 0; x < CHUNK_X; x++) {
				const wx = bx + x
				for (let y = 0; y < CARVE_LO; y++) {
					const solid =
						y === 0 ||
						hash01(seed, SALT_V2.netherBedrock, wx, y, wz) < (CARVE_LO - y) / CARVE_LO
					blocks[blockIndex(x, y, z)] = solid ? BLOCK.BEDROCK : BLOCK_V2.NETHERRACK
				}
				for (let y = NETHER_GEN.roofY; y <= NETHER_ROOF_TOP; y++) {
					const d = NETHER_ROOF_TOP - y
					const solid =
						d === 0 || hash01(seed, SALT_V2.netherBedrock, wx, y, wz) < (LAYERS - d) / LAYERS
					blocks[blockIndex(x, y, z)] = solid ? BLOCK.BEDROCK : BLOCK_V2.NETHERRACK
				}
			}
		}
	}

	function openAt(wx: number, y: number, wz: number): boolean {
		if (y < CARVE_LO || y > CARVE_HI) return false
		const gx = Math.floor(wx / STEP) * STEP
		const gz = Math.floor(wz / STEP) * STEP
		const gy = CARVE_LO + Math.floor((y - CARVE_LO) / STEP) * STEP
		if (gx !== cacheX || gy !== cacheY || gz !== cacheZ) {
			corners[0] = space(gx, gy, gz)
			corners[1] = space(gx + STEP, gy, gz)
			corners[2] = space(gx, gy, gz + STEP)
			corners[3] = space(gx + STEP, gy, gz + STEP)
			corners[4] = space(gx, gy + STEP, gz)
			corners[5] = space(gx + STEP, gy + STEP, gz)
			corners[6] = space(gx, gy + STEP, gz + STEP)
			corners[7] = space(gx + STEP, gy + STEP, gz + STEP)
			cacheX = gx
			cacheY = gy
			cacheZ = gz
		}
		const v = blend(
			corners[0],
			corners[1],
			corners[2],
			corners[3],
			corners[4],
			corners[5],
			corners[6],
			corners[7],
			(wx - gx) / STEP,
			(y - gy) / STEP,
			(wz - gz) / STEP,
		)
		return v > NETHER_GEN.caveThreshold + edgeBias(y)
	}

	return {
		openAt,

		floorYAt(wx: number, wz: number): number {
			// Lowest standable spot above the lava sea: solid ground carrying two
			// open voxels, which is exactly what a player or a portal frame needs.
			for (let y = NETHER_GEN.lavaSeaLevel + 1; y <= CARVE_HI - 2; y++) {
				if (openAt(wx, y, wz)) continue
				if (openAt(wx, y + 1, wz) && openAt(wx, y + 2, wz)) return y
			}
			return NETHER_GEN.lavaSeaLevel
		},

		fillChunk(cx: number, cz: number, blocks: Uint16Array, fluids: Uint8Array): void {
			const bx = cx * CHUNK_X
			const bz = cz * CHUNK_Z

			fillShell(bx, bz, blocks)

			for (let iy = 0; iy < ny; iy++) {
				const wy = CARVE_LO + iy * STEP
				for (let iz = 0; iz < nz; iz++) {
					const wz = bz + iz * STEP
					for (let ix = 0; ix < nx; ix++) {
						field[li(ix, iy, iz)] = space(bx + ix * STEP, wy, wz)
					}
				}
			}
			for (let iy = 0; iy < cellsY; iy++) {
				for (let iz = 0; iz < cellsZ; iz++) {
					for (let ix = 0; ix < cellsX; ix++) {
						cellMax[cellIndex(ix, iy, iz)] = max8(ix, iy, iz)
					}
				}
			}

			for (let z = 0; z < CHUNK_Z; z++) {
				const fz = z / STEP
				const iz0 = Math.floor(fz)
				const tz = fz - iz0
				const iz1 = iz0 + 1 < nz ? iz0 + 1 : iz0
				const izCell = iz0 < cellsZ ? iz0 : cellsZ - 1
				for (let x = 0; x < CHUNK_X; x++) {
					const fx = x / STEP
					const ix0 = Math.floor(fx)
					const tx = fx - ix0
					const ix1 = ix0 + 1 < nx ? ix0 + 1 : ix0
					const ixCell = ix0 < cellsX ? ix0 : cellsX - 1
					let y = CARVE_LO
					while (y <= CARVE_HI) {
						const iy0 = Math.floor((y - CARVE_LO) / STEP)
						const cellTop = CARVE_LO + (iy0 + 1) * STEP - 1
						const runEnd = cellTop < CARVE_HI ? cellTop : CARVE_HI
						// Nothing in this cell can reach the threshold, so the whole
						// run of voxels is solid and skipped in one step.
						if (cellMax[cellIndex(ixCell, iy0, izCell)] <= NETHER_GEN.caveThreshold) {
							y = runEnd + 1
							continue
						}
						const iy1 = iy0 + 1
						const c0 = field[li(ix0, iy0, iz0)]
						const c1 = field[li(ix1, iy0, iz0)]
						const c2 = field[li(ix0, iy0, iz1)]
						const c3 = field[li(ix1, iy0, iz1)]
						const c4 = field[li(ix0, iy1, iz0)]
						const c5 = field[li(ix1, iy1, iz0)]
						const c6 = field[li(ix0, iy1, iz1)]
						const c7 = field[li(ix1, iy1, iz1)]
						for (; y <= runEnd; y++) {
							const ty = (y - CARVE_LO) / STEP - iy0
							const v = blend(c0, c1, c2, c3, c4, c5, c6, c7, tx, ty, tz)
							if (v <= NETHER_GEN.caveThreshold + edgeBias(y)) continue
							const i = blockIndex(x, y, z)
							if (blocks[i] !== BLOCK_V2.NETHERRACK) continue
							if (y <= NETHER_GEN.lavaSeaLevel) {
								blocks[i] = BLOCK.LAVA
								fluids[i] = LAVA_SOURCE
							} else {
								blocks[i] = BLOCK.AIR
								fluids[i] = 0
							}
						}
					}
				}
			}
		},
	}
}
