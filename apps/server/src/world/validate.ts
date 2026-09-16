/**
 * Server side authority over edits and movement. Both functions are pure on
 * purpose: the tick loop decides what to do with a verdict, and every rejection
 * can be exercised in a test without a socket.
 */
import { BLOCK, BLOCK_V2, NET, type NetBlockEdit } from '@voxelcraft/core-types'
import type { DesiredMove, EditVerdict, PlayerState, ServerWorld } from '../types'

export const VALIDATION = {
	reachBlocks: 6,
	maxSpeedBlocksPerTick: 1.5,
	eyeHeight: 1.6,
	minY: 0,
	maxY: 255,
} as const

/** Frozen ids only: 0..63 from v1 plus 64..81 from v2. Built once, hit per edit. */
const KNOWN_BLOCKS: ReadonlySet<number> = new Set<number>([
	...Object.values(BLOCK),
	...Object.values(BLOCK_V2),
])

/** Squared budgets: comparing squares keeps Math.sqrt out of the hot paths. */
const REACH_SQ = VALIDATION.reachBlocks * VALIDATION.reachBlocks
const MAX_STEP_SQ = VALIDATION.maxSpeedBlocksPerTick * VALIDATION.maxSpeedBlocksPerTick
const HALF_PI = Math.PI / 2
const TAU = Math.PI * 2

export function isKnownBlock(block: number): boolean {
	// The experimental range (200..255) is rejected deliberately: a client must
	// never be able to place an id the shared contract has not frozen.
	return Number.isInteger(block) && KNOWN_BLOCKS.has(block)
}

/**
 * Decides whether one client block edit may be applied. Rejection order is part
 * of the protocol: a client that is behind must be told `stale_tick` even if the
 * edit is also nonsense, otherwise it resends the same nonsense forever.
 */
export function validateBlockEdit(
	player: PlayerState,
	edit: NetBlockEdit,
	world: ServerWorld,
): EditVerdict {
	// The world is part of the contract so face/occupancy rules can land later
	// without a signature change; nothing reads it yet, and this function must
	// stay free of side effects regardless.
	void world
	if (edit.tick + NET.inputBufferTicks < player.lastTick) return { ok: false, reason: 'stale_tick' }
	if (edit.y < VALIDATION.minY || edit.y > VALIDATION.maxY) {
		return { ok: false, reason: 'out_of_world' }
	}
	if (!isKnownBlock(edit.block)) return { ok: false, reason: 'unknown_block' }
	const dx = edit.x + 0.5 - player.x
	const dy = edit.y + 0.5 - (player.y + VALIDATION.eyeHeight)
	const dz = edit.z + 0.5 - player.z
	if (dx * dx + dy * dy + dz * dz > REACH_SQ) return { ok: false, reason: 'out_of_reach' }
	return { ok: true, block: edit.block }
}

/** NaN and +-Infinity are the two shapes a buggy or hostile client sends most. */
function finiteOr(value: number, fallback: number): number {
	return Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
	if (value < min) return min
	if (value > max) return max
	return value
}

/** Into [-PI, PI), so +PI and -PI never both appear in a snapshot. */
function wrapYaw(yaw: number): number {
	const shifted = (yaw + Math.PI) % TAU
	return (shifted < 0 ? shifted + TAU : shifted) - Math.PI
}

/**
 * Turns a requested move into one the server is willing to accept. Returns a
 * fresh object and never touches its arguments, so a rejected tick can be
 * replayed from the untouched input.
 */
export function clampMovement(player: PlayerState, desired: DesiredMove): DesiredMove {
	const wantX = finiteOr(desired.x, player.x)
	const wantY = clamp(finiteOr(desired.y, player.y), VALIDATION.minY, VALIDATION.maxY)
	const wantZ = finiteOr(desired.z, player.z)
	let dx = wantX - player.x
	let dy = wantY - player.y
	let dz = wantZ - player.z
	const stepSq = dx * dx + dy * dy + dz * dz
	if (stepSq > MAX_STEP_SQ) {
		// One tick of travel is all a client may claim; the rest is rubber banded.
		const scale = VALIDATION.maxSpeedBlocksPerTick / Math.sqrt(stepSq)
		dx *= scale
		dy *= scale
		dz *= scale
	}
	return {
		x: player.x + dx,
		// Clamped again: a player who is somehow already outside the world gets
		// pulled back in rather than left there.
		y: clamp(player.y + dy, VALIDATION.minY, VALIDATION.maxY),
		z: player.z + dz,
		yaw: wrapYaw(finiteOr(desired.yaw, player.yaw)),
		pitch: clamp(finiteOr(desired.pitch, player.pitch), -HALF_PI, HALF_PI),
	}
}
