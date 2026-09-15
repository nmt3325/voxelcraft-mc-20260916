import type { Tick } from './ids'

export const FLUID = { None: 0, Water: 1, Lava: 2 } as const
export type FluidKind = (typeof FLUID)[keyof typeof FLUID]

/** level 0 = source, 1..7 = flowing, 7 is the last step before disappearing. */
export const FLUID_MAX_LEVEL = 7

export interface FluidState {
	kind: FluidKind
	level: number
	falling: boolean
}

/** bits 0..2 level, bit 3 falling, bits 4..5 kind. */
export function packFluid(s: FluidState): number {
	return ((s.kind & 3) << 4) | (s.falling ? 8 : 0) | (s.level & 7)
}
export function unpackFluid(b: number): FluidState {
	return {
		kind: ((b >>> 4) & 3) as FluidKind,
		falling: (b & 8) !== 0,
		level: b & 7,
	}
}
export const FLUID_EMPTY = 0

export const FLUID_TICKS = {
	water: 5,
	lava: 10,
	maxDelay: 32,
	buckets: 33,
	downhillSearchRadius: 4,
	/** Source self-duplication stays disabled in v1 (determinism + runaway growth). */
	selfDuplication: false,
} as const

export interface FluidEngine {
	/** Called for the voxel and its 6 neighbours after any block/fluid change. */
	onNeighborChanged(x: number, y: number, z: number): void
	/** Pure function of the neighbourhood. No side effects: this prevents oscillation. */
	computeFluidAt(x: number, y: number, z: number): FluidState
	/** Returns the number of cells processed. Leftovers carry to the next tick in order. */
	tick(now: Tick, budgetCells: number): number
}
