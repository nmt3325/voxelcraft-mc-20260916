import { describe, expect, it } from 'vitest'
import { BLOCK, BLOCK_V2, NET, type NetBlockEdit } from '@voxelcraft/core-types'
import type { DesiredMove, PlayerState } from '../types'
import { VALIDATION, clampMovement, isKnownBlock, validateBlockEdit } from './validate'
import { createServerWorld } from './worldStore'

/** Shared on purpose: a verdict must never touch the world, so this stays cold. */
const world = createServerWorld(4242)

function player(overrides: Partial<PlayerState> = {}): PlayerState {
	return {
		id: 1,
		name: 'tester',
		x: 8.5,
		y: 70,
		z: 8.5,
		yaw: 0,
		pitch: 0,
		health: 20,
		hotbar: 0,
		bits: 0,
		lastTick: 100,
		...overrides,
	}
}

function edit(overrides: Partial<NetBlockEdit> = {}): NetBlockEdit {
	return { tick: 100, x: 9, y: 70, z: 8, block: BLOCK.STONE, ...overrides }
}

function move(from: PlayerState, overrides: Partial<DesiredMove> = {}): DesiredMove {
	return { x: from.x, y: from.y, z: from.z, yaw: from.yaw, pitch: from.pitch, ...overrides }
}

describe('isKnownBlock', () => {
	it('accepts the frozen v1 and v2 ids', () => {
		expect(isKnownBlock(BLOCK.AIR)).toBe(true)
		expect(isKnownBlock(BLOCK.WATER)).toBe(true)
		expect(isKnownBlock(BLOCK.LAVA_FLOWING)).toBe(true)
		expect(isKnownBlock(BLOCK_V2.NETHERRACK)).toBe(true)
		expect(isKnownBlock(81)).toBe(true)
	})

	it('rejects everything outside the frozen ranges', () => {
		for (const bad of [82, 99, 200, 255, 999, -1, -64]) expect(isKnownBlock(bad)).toBe(false)
	})

	it('rejects values that are not integers', () => {
		for (const bad of [1.5, 0.1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
			expect(isKnownBlock(bad)).toBe(false)
		}
	})
})

describe('validateBlockEdit', () => {
	it('accepts an edit next to the player', () => {
		expect(validateBlockEdit(player(), edit(), world)).toEqual({ ok: true, block: BLOCK.STONE })
	})

	it('accepts a v2 id inside reach', () => {
		expect(validateBlockEdit(player(), edit({ block: BLOCK_V2.NETHERRACK }), world)).toEqual({
			ok: true,
			block: BLOCK_V2.NETHERRACK,
		})
	})

	it('rejects an edit 20 blocks away', () => {
		expect(validateBlockEdit(player(), edit({ x: 28 }), world)).toEqual({
			ok: false,
			reason: 'out_of_reach',
		})
		expect(validateBlockEdit(player(), edit({ z: -12 }), world)).toEqual({
			ok: false,
			reason: 'out_of_reach',
		})
	})

	it('rejects edits below and above the world', () => {
		for (const y of [VALIDATION.minY - 1, VALIDATION.maxY + 1]) {
			expect(validateBlockEdit(player(), edit({ y }), world)).toEqual({
				ok: false,
				reason: 'out_of_world',
			})
		}
	})

	it('rejects ids the contract has not frozen', () => {
		for (const block of [999, 200]) {
			expect(validateBlockEdit(player(), edit({ block }), world)).toEqual({
				ok: false,
				reason: 'unknown_block',
			})
		}
	})

	it('rejects an edit older than the input buffer, but not one inside it', () => {
		const p = player({ lastTick: 100 })
		const stale = edit({ tick: p.lastTick - NET.inputBufferTicks - 1 })
		expect(validateBlockEdit(p, stale, world)).toEqual({ ok: false, reason: 'stale_tick' })
		const late = edit({ tick: p.lastTick - NET.inputBufferTicks })
		expect(validateBlockEdit(p, late, world)).toEqual({ ok: true, block: BLOCK.STONE })
	})

	it('keeps the rejection order when several rules fail at once', () => {
		const p = player()
		// stale beats everything: a client that is behind must resync first.
		expect(validateBlockEdit(p, edit({ tick: 0, y: -5, block: 999, x: 900 }), world)).toEqual({
			ok: false,
			reason: 'stale_tick',
		})
		expect(validateBlockEdit(p, edit({ y: 300, block: 999, x: 900 }), world)).toEqual({
			ok: false,
			reason: 'out_of_world',
		})
		expect(validateBlockEdit(p, edit({ block: 999, x: 900 }), world)).toEqual({
			ok: false,
			reason: 'unknown_block',
		})
	})

	it('never mutates the player or the world', () => {
		const p = player()
		const snapshot = { ...p }
		const loadedBefore = world.loadedChunks
		validateBlockEdit(p, edit(), world)
		validateBlockEdit(p, edit({ x: 900 }), world)
		expect(p).toEqual(snapshot)
		expect(world.loadedChunks).toBe(loadedBefore)
	})
})

describe('clampMovement', () => {
	it('scales a 50 block teleport down to one tick of travel', () => {
		const p = player()
		const moved = clampMovement(p, move(p, { x: p.x + 50 }))
		const travelled = Math.hypot(moved.x - p.x, moved.y - p.y, moved.z - p.z)
		expect(travelled).toBeCloseTo(VALIDATION.maxSpeedBlocksPerTick, 9)
		expect(moved.x).toBeCloseTo(p.x + VALIDATION.maxSpeedBlocksPerTick, 9)
	})

	it('leaves a legal step alone', () => {
		const p = player()
		const moved = clampMovement(p, move(p, { x: p.x + 1, z: p.z + 0.5 }))
		expect(moved.x).toBeCloseTo(p.x + 1, 9)
		expect(moved.z).toBeCloseTo(p.z + 0.5, 9)
	})

	it('clamps y into the buildable range', () => {
		const low = player({ y: 0.5 })
		expect(clampMovement(low, move(low, { y: -40 })).y).toBe(VALIDATION.minY)
		const high = player({ y: VALIDATION.maxY - 0.5 })
		expect(clampMovement(high, move(high, { y: 900 })).y).toBe(VALIDATION.maxY)
		const mid = player()
		const far = clampMovement(mid, move(mid, { y: 5000 }))
		expect(far.y).toBeLessThanOrEqual(VALIDATION.maxY)
		expect(far.y).toBeGreaterThanOrEqual(VALIDATION.minY)
	})

	it('wraps yaw into [-PI, PI)', () => {
		const p = player()
		expect(clampMovement(p, move(p, { yaw: Math.PI })).yaw).toBeCloseTo(-Math.PI, 9)
		expect(clampMovement(p, move(p, { yaw: Math.PI * 3 })).yaw).toBeCloseTo(-Math.PI, 9)
		expect(clampMovement(p, move(p, { yaw: -Math.PI * 3 })).yaw).toBeCloseTo(-Math.PI, 9)
		expect(clampMovement(p, move(p, { yaw: Math.PI * 2 + 0.5 })).yaw).toBeCloseTo(0.5, 9)
		for (const yaw of [12.3, -12.3, 100, -100]) {
			const wrapped = clampMovement(p, move(p, { yaw })).yaw
			expect(wrapped).toBeGreaterThanOrEqual(-Math.PI)
			expect(wrapped).toBeLessThan(Math.PI)
		}
	})

	it('clamps pitch to straight up and straight down', () => {
		const p = player()
		expect(clampMovement(p, move(p, { pitch: 3 })).pitch).toBeCloseTo(Math.PI / 2, 9)
		expect(clampMovement(p, move(p, { pitch: -3 })).pitch).toBeCloseTo(-Math.PI / 2, 9)
		expect(clampMovement(p, move(p, { pitch: 0.25 })).pitch).toBeCloseTo(0.25, 9)
	})

	it('falls back to the player value for a non finite field', () => {
		const p = player({ x: 4.25, z: -3.5, yaw: 0.25, pitch: -0.5 })
		const moved = clampMovement(p, {
			x: Number.NaN,
			y: Number.POSITIVE_INFINITY,
			z: Number.NEGATIVE_INFINITY,
			yaw: Number.NaN,
			pitch: Number.NaN,
		})
		expect(moved.x).toBe(p.x)
		expect(moved.y).toBe(p.y)
		expect(moved.z).toBe(p.z)
		expect(moved.yaw).toBeCloseTo(p.yaw, 9)
		expect(moved.pitch).toBe(p.pitch)
	})

	it('mutates neither argument and returns a fresh object', () => {
		const p = player()
		const desired: DesiredMove = { x: 500, y: -20, z: 500, yaw: 99, pitch: 99 }
		const playerBefore = { ...p }
		const desiredBefore = { ...desired }
		const moved = clampMovement(p, desired)
		expect(p).toEqual(playerBefore)
		expect(desired).toEqual(desiredBefore)
		expect(moved).not.toBe(desired)
	})
})
