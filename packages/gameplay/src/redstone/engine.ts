import {
	BLOCK,
	FACE,
	FACE_DIRS,
	REDSTONE,
	REDSTONE_ROLE,
	type BlockId,
	type Face,
	type RedstoneEngine,
	type RedstoneRole,
	type Tick,
} from '@voxelcraft/core-types'
import { setDoorPowered } from '../blockEntities/door'
import { BLOCKS, type GameplayBlockRegistry } from '../blocks/registry'
import { posKey, type BlockEntityWorld } from '../support/world'
import {
	clampPower,
	isConsumer,
	isImmovable,
	isReplaceable,
	isSource,
	isWire,
	roleOf,
} from './roles'

/**
 * Redstone simulation.
 *
 * The power field is recomputed from scratch whenever the world or a source
 * changed, which keeps it a pure function of (blocks, sources) and therefore
 * free of the oscillation that incremental propagation invites:
 *
 * - A source cell holds its own level (levers, buttons and plates use
 *   `REDSTONE.maxPower`).
 * - Wires next to a source take the source level, then lose 1 per wire step,
 *   so a chain reaches 0 after `REDSTONE.maxPower` wires.
 * - Relaxation runs highest level first, so every wire is visited once and the
 *   result does not depend on insertion order. Ties are broken by (y, z, x).
 * - `tick` never visits more than `min(budget, REDSTONE.maxUpdatesPerTick)`
 *   cells; if the budget runs out the pass stays dirty and resumes next tick.
 *
 * Consumers next to a powered cell are applied on the rising and falling edge
 * only: doors go through the shared `setDoorPowered`, lamps swap their block id
 * and pistons schedule a move `REDSTONE.pistonMoveTicks` ticks out.
 */

export interface RedstoneOptions {
	registry?: GameplayBlockRegistry
	/** Facing for pistons that were never passed to `setPistonFacing`. */
	defaultPistonFacing?: Face
	onPowerChanged?: (x: number, y: number, z: number, power: number) => void
}

export interface GameplayRedstoneEngine extends RedstoneEngine {
	/** Direction a piston extends towards. Defaults to `defaultPistonFacing`. */
	setPistonFacing(x: number, y: number, z: number, facing: Face): void
	/** True when this cell or one of its six neighbours carries power. */
	isPowered(x: number, y: number, z: number): boolean
	/** Scheduled piston moves plus buttons waiting to pop back out. */
	readonly pendingCount: number
}

interface Cell {
	x: number
	y: number
	z: number
}

interface SourceCell extends Cell {
	power: number
}

interface ConsumerCell extends Cell {
	role: RedstoneRole
}

interface PistonAction extends Cell {
	at: Tick
	extend: boolean
	facing: Face
}

interface PowerField {
	levels: Map<string, number>
	cells: Map<string, Cell>
	visited: number
}

/** Vanilla-sized push limit. */
const MAX_PUSH_BLOCKS = 12

function compareCells(a: Cell, b: Cell): number {
	if (a.y !== b.y) return a.y - b.y
	if (a.z !== b.z) return a.z - b.z
	return a.x - b.x
}

function sortCells<T extends Cell>(cells: T[]): T[] {
	return cells.sort(compareCells)
}

export function createRedstoneEngine(
	world: BlockEntityWorld,
	options: RedstoneOptions = {},
): GameplayRedstoneEngine {
	const registry = options.registry ?? BLOCKS
	const defaultPistonFacing: Face = options.defaultPistonFacing ?? FACE.PosY
	const sources = new Map<string, SourceCell>()
	/** `null` means "pressed, release tick not anchored yet". */
	const buttonRelease = new Map<string, Tick | null>()
	const pistonFacing = new Map<string, Face>()
	const pistonSchedule = new Map<string, PistonAction>()
	let levels = new Map<string, number>()
	let powerCells = new Map<string, Cell>()
	let poweredConsumers = new Map<string, ConsumerCell>()
	let dirty = true

	const blockAt = (x: number, y: number, z: number): BlockId => world.getBlock(x, y, z)

	const computeField = (cap: number): PowerField => {
		const nextLevels = new Map<string, number>()
		const cells = new Map<string, Cell>()
		const buckets: Cell[][] = []
		for (let level = 0; level <= REDSTONE.maxPower; level++) buckets.push([])

		const offer = (x: number, y: number, z: number, level: number): void => {
			if (level <= 0) return
			const key = posKey(x, y, z)
			const current = nextLevels.get(key)
			if (current !== undefined && current >= level) return
			nextLevels.set(key, level)
			cells.set(key, { x, y, z })
			buckets[level].push({ x, y, z })
		}

		for (const source of sortCells([...sources.values()])) {
			const key = posKey(source.x, source.y, source.z)
			if (!isSource(blockAt(source.x, source.y, source.z), registry)) {
				// The lever or plate was mined: forget the stale source.
				sources.delete(key)
				buttonRelease.delete(key)
				continue
			}
			if (source.power <= 0) continue
			nextLevels.set(key, source.power)
			cells.set(key, { x: source.x, y: source.y, z: source.z })
			for (const dir of FACE_DIRS) {
				const nx = source.x + dir.x
				const ny = source.y + dir.y
				const nz = source.z + dir.z
				if (isWire(blockAt(nx, ny, nz), registry)) offer(nx, ny, nz, source.power)
			}
		}

		let visited = 0
		for (let level = REDSTONE.maxPower; level >= 1; level--) {
			for (const cell of sortCells(buckets[level])) {
				const key = posKey(cell.x, cell.y, cell.z)
				if (nextLevels.get(key) !== level) continue
				if (visited >= cap) return { levels: nextLevels, cells, visited }
				visited += 1
				for (const dir of FACE_DIRS) {
					const nx = cell.x + dir.x
					const ny = cell.y + dir.y
					const nz = cell.z + dir.z
					if (isWire(blockAt(nx, ny, nz), registry)) offer(nx, ny, nz, level - 1)
				}
			}
		}
		return { levels: nextLevels, cells, visited }
	}

	const discoverConsumers = (field: PowerField): Map<string, ConsumerCell> => {
		const found = new Map<string, ConsumerCell>()
		for (const cell of sortCells([...field.cells.values()])) {
			const key = posKey(cell.x, cell.y, cell.z)
			if ((field.levels.get(key) ?? 0) <= 0) continue
			for (const dir of FACE_DIRS) {
				const nx = cell.x + dir.x
				const ny = cell.y + dir.y
				const nz = cell.z + dir.z
				const id = blockAt(nx, ny, nz)
				if (!isConsumer(id, registry)) continue
				const role = roleOf(id, registry)
				if (role === null) continue
				found.set(posKey(nx, ny, nz), { x: nx, y: ny, z: nz, role })
			}
		}
		return found
	}

	const movePiston = (action: PistonAction): number => {
		const dir = FACE_DIRS[action.facing]
		const hx = action.x + dir.x
		const hy = action.y + dir.y
		const hz = action.z + dir.z
		if (!action.extend) {
			if (blockAt(hx, hy, hz) !== BLOCK.PISTON_HEAD) return 0
			world.setBlock(hx, hy, hz, BLOCK.AIR)
			return 1
		}
		if (blockAt(hx, hy, hz) === BLOCK.PISTON_HEAD) return 0
		const pushed: { x: number; y: number; z: number; id: BlockId }[] = []
		let cx = hx
		let cy = hy
		let cz = hz
		for (let step = 0; step < MAX_PUSH_BLOCKS; step++) {
			const id = blockAt(cx, cy, cz)
			if (isReplaceable(id, registry)) break
			if (isImmovable(id, registry)) return 0
			pushed.push({ x: cx, y: cy, z: cz, id })
			cx += dir.x
			cy += dir.y
			cz += dir.z
		}
		if (!isReplaceable(blockAt(cx, cy, cz), registry)) return 0
		// Far end first, so each block moves into a cell that was just vacated.
		for (let i = pushed.length - 1; i >= 0; i--) {
			const cell = pushed[i]
			world.setBlock(cell.x + dir.x, cell.y + dir.y, cell.z + dir.z, cell.id)
			world.setBlock(cell.x, cell.y, cell.z, BLOCK.AIR)
		}
		world.setBlock(hx, hy, hz, BLOCK.PISTON_HEAD)
		return 1 + pushed.length
	}

	const applyConsumer = (cell: ConsumerCell, powered: boolean, now: Tick): number => {
		if (cell.role === REDSTONE_ROLE.Door) {
			return setDoorPowered(world, cell.x, cell.y, cell.z, powered) ? 1 : 0
		}
		if (cell.role === REDSTONE_ROLE.Lamp) {
			const id = blockAt(cell.x, cell.y, cell.z)
			if (powered && id === BLOCK.REDSTONE_LAMP) {
				world.setBlock(cell.x, cell.y, cell.z, BLOCK.REDSTONE_LAMP_LIT)
				return 1
			}
			if (!powered && id === BLOCK.REDSTONE_LAMP_LIT) {
				world.setBlock(cell.x, cell.y, cell.z, BLOCK.REDSTONE_LAMP)
				return 1
			}
			return 0
		}
		if (cell.role === REDSTONE_ROLE.Piston) {
			// Only the body reacts; the head follows whatever the body does.
			if (blockAt(cell.x, cell.y, cell.z) !== BLOCK.PISTON) return 0
			const key = posKey(cell.x, cell.y, cell.z)
			pistonSchedule.set(key, {
				x: cell.x,
				y: cell.y,
				z: cell.z,
				at: now + REDSTONE.pistonMoveTicks,
				extend: powered,
				facing: pistonFacing.get(key) ?? defaultPistonFacing,
			})
			return 1
		}
		return 0
	}

	const releaseButtons = (now: Tick): void => {
		for (const key of [...buttonRelease.keys()].sort()) {
			const releaseAt = buttonRelease.get(key)
			if (releaseAt === undefined) continue
			if (releaseAt === null) {
				buttonRelease.set(key, now + REDSTONE.buttonTicks)
				continue
			}
			if (releaseAt > now) continue
			buttonRelease.delete(key)
			if (sources.delete(key)) dirty = true
		}
	}

	const refreshField = (cap: number, now: Tick): number => {
		let updates = 0
		const field = computeField(cap)
		// Budget exhausted: keep the pass dirty so the next tick finishes it.
		dirty = field.visited >= cap && cap > 0

		const changed: Cell[] = []
		for (const [key, cell] of field.cells) {
			if ((levels.get(key) ?? 0) !== (field.levels.get(key) ?? 0)) changed.push(cell)
		}
		for (const [key, cell] of powerCells) {
			if (field.cells.has(key)) continue
			if ((levels.get(key) ?? 0) !== 0) changed.push(cell)
		}
		levels = field.levels
		powerCells = field.cells
		for (const cell of sortCells(changed)) {
			updates += 1
			options.onPowerChanged?.(
				cell.x,
				cell.y,
				cell.z,
				levels.get(posKey(cell.x, cell.y, cell.z)) ?? 0,
			)
		}

		const nextConsumers = discoverConsumers(field)
		for (const [key, cell] of nextConsumers) {
			if (poweredConsumers.has(key)) continue
			updates += applyConsumer(cell, true, now)
		}
		for (const [key, cell] of poweredConsumers) {
			if (nextConsumers.has(key)) continue
			updates += applyConsumer(cell, false, now)
		}
		poweredConsumers = nextConsumers
		return updates
	}

	return {
		get pendingCount(): number {
			return pistonSchedule.size + buttonRelease.size
		},

		onBlockChanged(): void {
			dirty = true
		},

		setSourcePower(x: number, y: number, z: number, power: number): void {
			const key = posKey(x, y, z)
			const level = clampPower(power)
			if (level === 0) {
				if (sources.delete(key)) dirty = true
				buttonRelease.delete(key)
				return
			}
			const existing = sources.get(key)
			if (existing === undefined || existing.power !== level) dirty = true
			sources.set(key, { x, y, z, power: level })
			if (roleOf(world.getBlock(x, y, z), registry) === REDSTONE_ROLE.Button) {
				buttonRelease.set(key, null)
			}
		},

		setPistonFacing(x: number, y: number, z: number, facing: Face): void {
			pistonFacing.set(posKey(x, y, z), facing)
		},

		powerAt(x: number, y: number, z: number): number {
			return levels.get(posKey(x, y, z)) ?? 0
		},

		isPowered(x: number, y: number, z: number): boolean {
			if ((levels.get(posKey(x, y, z)) ?? 0) > 0) return true
			for (const dir of FACE_DIRS) {
				if ((levels.get(posKey(x + dir.x, y + dir.y, z + dir.z)) ?? 0) > 0) return true
			}
			return false
		},

		tick(now: Tick, budget: number): number {
			const cap = Math.max(0, Math.min(Math.trunc(budget), REDSTONE.maxUpdatesPerTick))
			let updates = 0
			releaseButtons(now)
			if (dirty) updates += refreshField(cap, now)
			for (const action of sortCells([...pistonSchedule.values()])) {
				if (action.at > now) continue
				pistonSchedule.delete(posKey(action.x, action.y, action.z))
				const moved = movePiston(action)
				if (moved > 0) {
					updates += moved
					// The world changed, so the field is re-derived next tick.
					dirty = true
				}
			}
			return updates
		},
	}
}
