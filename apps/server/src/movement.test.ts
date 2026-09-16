import {
	BLOCK,
	CHUNK_VOLUME,
	DIMENSION,
	INPUT_BIT,
	type NetInput,
} from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import {
	JUMP_HEIGHT,
	SNEAK_MULTIPLIER,
	SPRINT_MULTIPLIER,
	WALK_SPEED,
	desiredMoveFor,
	moveAxes,
	speedFor,
} from './movement'
import type { PlayerState, ServerWorld } from './types'

const GROUND = 64

/** A world with one flat surface everywhere, so movement is the only variable. */
function flatWorld(surface = GROUND): ServerWorld {
	return {
		seed: 1,
		dimension: DIMENSION.Overworld,
		chunk: (cx, cz) => ({
			cx,
			cz,
			blocks: new Uint16Array(CHUNK_VOLUME),
			fluids: new Uint8Array(CHUNK_VOLUME),
		}),
		hasColumn: () => true,
		block: () => BLOCK.AIR,
		setBlock: () => true,
		surfaceY: () => surface,
		loadedChunks: 0,
	}
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
	return {
		id: 1,
		name: 'ada',
		x: 0.5,
		y: GROUND,
		z: 0.5,
		yaw: 0,
		pitch: 0,
		health: 20,
		hotbar: 0,
		bits: 0,
		lastTick: 0,
		...overrides,
	}
}

function input(overrides: Partial<NetInput> = {}): NetInput {
	return { tick: 1, bits: 0, yaw: 0, pitch: 0, hotbar: 0, ...overrides }
}

describe('moveAxes', () => {
	it('reads one axis per direction pair', () => {
		expect(moveAxes(INPUT_BIT.Forward)).toEqual({ forward: 1, strafe: 0 })
		expect(moveAxes(INPUT_BIT.Back)).toEqual({ forward: -1, strafe: 0 })
		expect(moveAxes(INPUT_BIT.Right)).toEqual({ forward: 0, strafe: 1 })
		expect(moveAxes(INPUT_BIT.Left)).toEqual({ forward: 0, strafe: -1 })
	})

	it('cancels opposite directions instead of trusting the client', () => {
		expect(moveAxes(INPUT_BIT.Forward | INPUT_BIT.Back)).toEqual({ forward: 0, strafe: 0 })
		expect(moveAxes(INPUT_BIT.Left | INPUT_BIT.Right)).toEqual({ forward: 0, strafe: 0 })
	})

	it('ignores bits that are not movement', () => {
		expect(moveAxes(INPUT_BIT.Attack | INPUT_BIT.UseItem | INPUT_BIT.Jump)).toEqual({
			forward: 0,
			strafe: 0,
		})
	})
})

describe('speedFor', () => {
	it('walks at the base speed', () => {
		expect(speedFor(0)).toBeCloseTo(WALK_SPEED, 10)
	})

	it('multiplies for sprint and sneak', () => {
		expect(speedFor(INPUT_BIT.Sprint)).toBeCloseTo(WALK_SPEED * SPRINT_MULTIPLIER, 10)
		expect(speedFor(INPUT_BIT.Sneak)).toBeCloseTo(WALK_SPEED * SNEAK_MULTIPLIER, 10)
		expect(speedFor(INPUT_BIT.Sprint | INPUT_BIT.Sneak)).toBeCloseTo(
			WALK_SPEED * SPRINT_MULTIPLIER * SNEAK_MULTIPLIER,
			10,
		)
	})
})

describe('desiredMoveFor', () => {
	const world = flatWorld()

	it('stands still without movement bits', () => {
		const start = player()
		const move = desiredMoveFor(start, input(), world)
		expect(move.x).toBe(start.x)
		expect(move.z).toBe(start.z)
		expect(move.y).toBe(GROUND)
	})

	it('walks toward +z at yaw 0', () => {
		const move = desiredMoveFor(player(), input({ bits: INPUT_BIT.Forward }), world)
		expect(move.z).toBeCloseTo(0.5 + WALK_SPEED, 10)
		expect(move.x).toBeCloseTo(0.5, 10)
	})

	it('turns toward -x as yaw increases', () => {
		const move = desiredMoveFor(
			player(),
			input({ bits: INPUT_BIT.Forward, yaw: Math.PI / 2 }),
			world,
		)
		expect(move.x).toBeCloseTo(0.5 - WALK_SPEED, 6)
		expect(move.z).toBeCloseTo(0.5, 6)
	})

	it('does not let a diagonal beat a straight line', () => {
		const start = player()
		const move = desiredMoveFor(start, input({ bits: INPUT_BIT.Forward | INPUT_BIT.Right }), world)
		expect(Math.hypot(move.x - start.x, move.z - start.z)).toBeCloseTo(WALK_SPEED, 10)
	})

	it('sprints faster than it walks', () => {
		const start = player()
		const walk = desiredMoveFor(start, input({ bits: INPUT_BIT.Forward }), world)
		const sprint = desiredMoveFor(
			start,
			input({ bits: INPUT_BIT.Forward | INPUT_BIT.Sprint }),
			world,
		)
		expect(sprint.z - start.z).toBeCloseTo((walk.z - start.z) * SPRINT_MULTIPLIER, 10)
	})

	it('lifts the player on a jump and settles on the ground otherwise', () => {
		expect(desiredMoveFor(player(), input({ bits: INPUT_BIT.Jump }), world).y).toBeCloseTo(
			GROUND + JUMP_HEIGHT,
			10,
		)
		// A client that claims it is flying is put back on the surface.
		expect(desiredMoveFor(player({ y: 200 }), input(), world).y).toBe(GROUND)
	})

	it('takes the look angles straight from the input', () => {
		const move = desiredMoveFor(player(), input({ yaw: 1.25, pitch: -0.5 }), world)
		expect(move.yaw).toBe(1.25)
		expect(move.pitch).toBe(-0.5)
	})

	it('follows the terrain it is given', () => {
		expect(desiredMoveFor(player(), input(), flatWorld(11)).y).toBe(11)
	})
})
