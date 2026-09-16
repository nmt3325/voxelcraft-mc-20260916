/**
 * Redstone: wire propagation, levers, buttons, pressure plates, doors, lamps
 * and pistons. See `engine.ts` for the convergence and budget rules.
 */

export {
	createRedstoneEngine,
	type GameplayRedstoneEngine,
	type RedstoneOptions,
} from './engine'
export {
	clampPower,
	isConsumer,
	isImmovable,
	isReplaceable,
	isSource,
	isWire,
	roleOf,
} from './roles'
