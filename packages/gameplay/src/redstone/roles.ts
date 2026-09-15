import {
	BLOCK,
	REDSTONE,
	REDSTONE_ROLE,
	type BlockId,
	type RedstoneRole,
} from '@voxelcraft/core-types'
import { BLOCKS, type GameplayBlockRegistry } from '../blocks/registry'

/**
 * Redstone behaviour is read from the block registry rather than hard-coded id
 * lists, so adding a new lever-like block only needs a `BlockDef`.
 */

export function roleOf(
	id: BlockId,
	registry: GameplayBlockRegistry = BLOCKS,
): RedstoneRole | null {
	return registry.tryById(id)?.redstone ?? null
}

export function isWire(id: BlockId, registry: GameplayBlockRegistry = BLOCKS): boolean {
	return roleOf(id, registry) === REDSTONE_ROLE.Wire
}

/** Blocks that carry a power level of their own: levers, buttons, plates, torches. */
export function isSource(id: BlockId, registry: GameplayBlockRegistry = BLOCKS): boolean {
	const role = roleOf(id, registry)
	return (
		role === REDSTONE_ROLE.Lever ||
		role === REDSTONE_ROLE.Button ||
		role === REDSTONE_ROLE.PressurePlate ||
		role === REDSTONE_ROLE.Torch
	)
}

/** Blocks that react to being powered: doors, lamps, pistons. */
export function isConsumer(id: BlockId, registry: GameplayBlockRegistry = BLOCKS): boolean {
	const role = roleOf(id, registry)
	return (
		role === REDSTONE_ROLE.Door || role === REDSTONE_ROLE.Lamp || role === REDSTONE_ROLE.Piston
	)
}

export function clampPower(power: number): number {
	if (!Number.isFinite(power)) return 0
	return Math.max(0, Math.min(REDSTONE.maxPower, Math.trunc(power)))
}

/** Air and plants get overwritten by a piston head instead of being pushed. */
export function isReplaceable(id: BlockId, registry: GameplayBlockRegistry = BLOCKS): boolean {
	if (id === BLOCK.AIR) return true
	return registry.tryById(id)?.replaceable ?? false
}

/** Pistons refuse to move unbreakable blocks, other pistons and block entities. */
export function isImmovable(id: BlockId, registry: GameplayBlockRegistry = BLOCKS): boolean {
	if (id === BLOCK.PISTON || id === BLOCK.PISTON_HEAD) return true
	const def = registry.tryById(id)
	if (def === undefined) return true
	return def.hardness < 0 || def.blockEntity !== null
}
