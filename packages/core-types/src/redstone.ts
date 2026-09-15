import type { Tick } from './ids'

export const REDSTONE_ROLE = {
	Wire: 'wire',
	Lever: 'lever',
	Button: 'button',
	PressurePlate: 'pressurePlate',
	Lamp: 'lamp',
	Piston: 'piston',
	Door: 'door',
	Torch: 'torch',
} as const
export type RedstoneRole = (typeof REDSTONE_ROLE)[keyof typeof REDSTONE_ROLE]

export const REDSTONE = {
	maxPower: 15,
	buttonTicks: 20,
	pistonMoveTicks: 2,
	maxUpdatesPerTick: 2048,
} as const

export interface RedstoneEngine {
	onBlockChanged(x: number, y: number, z: number): void
	setSourcePower(x: number, y: number, z: number, power: number): void
	powerAt(x: number, y: number, z: number): number
	/** Returns the number of cells updated. Deterministic BFS order. */
	tick(now: Tick, budget: number): number
}
