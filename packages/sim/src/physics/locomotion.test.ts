import { PHYSICS, fallDamage } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import type { IntentComp } from '../ecs'
import { SIM_DT } from '../schedule'
import { SIM_HALF_PI } from '../shared'
import { createFlatTestWorld, createTestArena } from '../testing'
import { entityBox } from './aabb'
import {
	ZERO_INTENT,
	createLocomotionState,
	intentToWorld,
	stepLocomotion,
	targetSpeed,
} from './locomotion'
import type { LocomotionState } from './locomotion'

function intent(partial: Partial<IntentComp>): IntentComp {
	return { ...ZERO_INTENT, ...partial }
}

/** yaw = pi/2 turns "forward" into +X, which keeps the assertions readable. */
const FORWARD_PLUS_X = SIM_HALF_PI
const FORWARD_MINUS_X = -SIM_HALF_PI

function simulate(
	state: LocomotionState,
	input: IntentComp,
	world: Parameters<typeof stepLocomotion>[2],
	ticks: number,
): { state: LocomotionState; damage: number } {
	let current = state
	let damage = 0
	for (let tick = 0; tick < ticks; tick++) {
		const step = stepLocomotion(current, input, world, SIM_DT)
		current = step.state
		damage += step.damage
	}
	return { state: current, damage }
}

describe('intent mapping', () => {
	it('maps forward to +Z at yaw 0 and to +X at yaw pi/2', () => {
		const atZero = intentToWorld(intent({ forward: 1 }))
		expect(atZero.z).toBeCloseTo(1, 6)
		expect(atZero.x).toBeCloseTo(0, 6)
		const atHalfPi = intentToWorld(intent({ forward: 1, yaw: FORWARD_PLUS_X }))
		expect(atHalfPi.x).toBeCloseTo(1, 6)
		expect(atHalfPi.z).toBeCloseTo(0, 6)
	})

	it('never exceeds a unit wish vector', () => {
		const diagonal = intentToWorld(intent({ forward: 1, strafe: 1 }))
		expect(Math.sqrt(diagonal.x * diagonal.x + diagonal.z * diagonal.z)).toBeCloseTo(1, 6)
	})

	it('uses the contract speeds, with sneak winning over sprint', () => {
		expect(targetSpeed(ZERO_INTENT, false)).toBe(PHYSICS.walkSpeed)
		expect(targetSpeed(intent({ sprint: true }), false)).toBe(PHYSICS.sprintSpeed)
		expect(targetSpeed(intent({ sneak: true }), false)).toBe(PHYSICS.sneakSpeed)
		expect(targetSpeed(intent({ sneak: true, sprint: true }), false)).toBe(PHYSICS.sneakSpeed)
		expect(targetSpeed(intent({ sprint: true }), true)).toBe(PHYSICS.swimSpeed)
	})
})

describe('ground movement', () => {
	it('reaches the contract walk, sprint and sneak speeds', () => {
		const { world, floorTop } = createFlatTestWorld()
		const base = createLocomotionState(entityBox(0, floorTop, 0))
		const walk = stepLocomotion(base, intent({ forward: 1, yaw: FORWARD_PLUS_X }), world, SIM_DT)
		expect(walk.state.vx).toBeCloseTo(PHYSICS.walkSpeed, 6)
		expect(walk.state.vz).toBeCloseTo(0, 10)
		const sprint = stepLocomotion(
			base,
			intent({ forward: 1, sprint: true, yaw: FORWARD_PLUS_X }),
			world,
			SIM_DT,
		)
		expect(sprint.state.vx).toBeCloseTo(PHYSICS.sprintSpeed, 6)
		const sneak = stepLocomotion(
			base,
			intent({ forward: 1, sneak: true, yaw: FORWARD_PLUS_X }),
			world,
			SIM_DT,
		)
		expect(sneak.state.vx).toBeCloseTo(PHYSICS.sneakSpeed, 6)
	})

	it('stays on the ground while walking on a flat floor', () => {
		const { world, floorTop } = createFlatTestWorld()
		const start = createLocomotionState(entityBox(0, floorTop, 0))
		const after = simulate(start, intent({ forward: 1, yaw: FORWARD_PLUS_X }), world, 40)
		expect(after.state.onGround).toBe(true)
		expect(after.state.box.minY).toBeLessThan(floorTop + 0.01)
		expect(after.state.box.minX).toBeGreaterThan(1)
		expect(after.damage).toBe(0)
	})
})

describe('jumping', () => {
	it('has an apex above one block and below 1.5 blocks', () => {
		const analytic = (PHYSICS.jumpVelocity * PHYSICS.jumpVelocity) / (2 * PHYSICS.gravity)
		expect(analytic).toBeGreaterThan(1)
		expect(analytic).toBeLessThan(1.5)
		// The simulated apex is the number that decides whether a 1.0 ledge can be
		// cleared, so it is held to the same bounds.
		const { world, floorTop } = createFlatTestWorld()
		let state = createLocomotionState(entityBox(0, floorTop, 0))
		const input = intent({ jump: true })
		let apex = state.box.minY
		for (let tick = 0; tick < 20; tick++) {
			state = stepLocomotion(state, input, world, SIM_DT).state
			apex = Math.max(apex, state.box.minY)
		}
		expect(apex - floorTop).toBeGreaterThan(1)
		expect(apex - floorTop).toBeLessThan(1.5)
	})

	it('clears a one block ledge that auto-stepping cannot', () => {
		const arena = createTestArena()
		let state = createLocomotionState(entityBox(3.5, arena.floorTop, 0))
		const input = intent({ forward: 1, jump: true, yaw: FORWARD_PLUS_X })
		// Stop at the first landing on the ledge: holding forward for longer just
		// walks off its far side again.
		let landedOnLedge = false
		for (let tick = 0; tick < 60 && !landedOnLedge; tick++) {
			state = stepLocomotion(state, input, arena.world, SIM_DT).state
			landedOnLedge = state.onGround && state.box.minY >= arena.lowLedge.top
		}
		expect(landedOnLedge).toBe(true)
		expect(state.box.minX).toBeGreaterThan(arena.lowLedge.xFrom)
	})

	it('cannot clear a two block ledge', () => {
		const arena = createTestArena()
		let state = createLocomotionState(entityBox(-2.5, arena.floorTop, 0))
		const input = intent({ forward: 1, jump: true, yaw: FORWARD_MINUS_X })
		let highest = state.box.minY
		for (let tick = 0; tick < 120; tick++) {
			state = stepLocomotion(state, input, arena.world, SIM_DT).state
			highest = Math.max(highest, state.box.minY)
		}
		// No amount of jumping reaches the top of a two block wall.
		expect(highest).toBeLessThan(arena.highLedge.top)
		expect(state.box.minY).toBeLessThan(arena.floorTop + 0.01)
		expect(state.box.minX).toBeGreaterThan(arena.highLedge.xTo)
	})
})

describe('water', () => {
	it('damps horizontal velocity by the contract water drag', () => {
		const arena = createTestArena()
		const start = createLocomotionState(entityBox(0, arena.floorTop + 1, 9))
		start.vx = 4
		const step = stepLocomotion(start, ZERO_INTENT, arena.world, SIM_DT)
		expect(step.state.inWater).toBe(true)
		expect(step.state.vx).toBeCloseTo(4 * PHYSICS.waterDrag, 10)
		expect(Math.abs(step.state.vx)).toBeLessThan(4)
	})

	it('sinks slower than in air thanks to buoyancy', () => {
		const arena = createTestArena()
		const inWater = stepLocomotion(
			createLocomotionState(entityBox(0, arena.floorTop + 2, 9)),
			ZERO_INTENT,
			arena.world,
			SIM_DT,
		)
		expect(inWater.state.vy).toBeCloseTo(
			-PHYSICS.gravity * (1 - PHYSICS.waterBuoyancy) * SIM_DT,
			10,
		)
		const inAir = stepLocomotion(
			createLocomotionState(entityBox(0, arena.floorTop + 8, 0)),
			ZERO_INTENT,
			arena.world,
			SIM_DT,
		)
		expect(inAir.state.vy).toBeCloseTo(-PHYSICS.gravity * SIM_DT, 10)
		expect(inWater.state.vy).toBeGreaterThan(inAir.state.vy)
	})

	it('swims upwards while holding jump', () => {
		const arena = createTestArena()
		const step = stepLocomotion(
			createLocomotionState(entityBox(0, arena.floorTop + 1, 9)),
			intent({ jump: true }),
			arena.world,
			SIM_DT,
		)
		expect(step.state.vy).toBeGreaterThan(0)
		expect(step.state.box.minY).toBeGreaterThan(arena.floorTop + 1)
	})
})

describe('fall damage', () => {
	it('matches the contract fallDamage for every drop height', () => {
		for (const height of [1, 2, 3, 4, 5, 10, 24]) {
			const { world, floorTop } = createFlatTestWorld()
			let state = createLocomotionState(entityBox(0, floorTop + height + PHYSICS.epsilon, 0))
			let damage = 0
			let landed = false
			for (let tick = 0; tick < 400 && !landed; tick++) {
				const step = stepLocomotion(state, ZERO_INTENT, world, SIM_DT)
				state = step.state
				damage += step.damage
				landed = state.onGround
			}
			expect(landed).toBe(true)
			expect(damage).toBe(fallDamage(height))
		}
	})

	it('gives the first three blocks for free', () => {
		expect(fallDamage(PHYSICS.fallDamageFreeBlocks)).toBe(0)
		expect(fallDamage(PHYSICS.fallDamageFreeBlocks + 1)).toBe(1)
	})

	it('does no damage when landing in water', () => {
		const arena = createTestArena()
		const start = createLocomotionState(entityBox(0, arena.floorTop + 12, 9))
		const after = simulate(start, ZERO_INTENT, arena.world, 120)
		expect(after.state.inWater).toBe(true)
		expect(after.damage).toBe(0)
	})
})
