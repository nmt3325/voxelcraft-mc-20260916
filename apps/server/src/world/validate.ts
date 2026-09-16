/**
 * Server side authority over edits and movement. Every function is pure on
 * purpose: the tick loop decides what to do with a verdict, and every rejection
 * can be exercised in a test without a socket.
 *
 * Purity is also a security property here. validateBlockEdit must be able to
 * judge an edit before anything touches a column, because touching one
 * generates it: a caller that reads the world first hands a client an unbounded
 * terrain generator.
 */
import {
	BLOCK,
	BLOCK_V2,
	NET,
	PHYSICS,
	worldToChunk,
	type NetBlockEdit,
} from '@voxelcraft/core-types'
import type { DesiredMove, EditVerdict, PlayerState, ServerWorld } from '../types'

export const VALIDATION = {
	/**
	 * The frozen PHYSICS.reach plus a small tolerance: a client measures from
	 * its camera to the face it clicked, the server measures from the eye to the
	 * centre of the block, so a legal edit at the far end of the reach can come
	 * out slightly longer on this side.
	 */
	reachBlocks: PHYSICS.reach + 0.5,
	maxSpeedBlocksPerTick: 1.5,
	/** Columns away from its own an edit may land in: the streamed square. */
	streamRadiusChunks: NET.streamRadius,
	eyeHeight: PHYSICS.playerEyeHeight,
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

/** True when the edited column is inside the square the player is streamed. */
export function isInStreamRadius(
	player: PlayerState,
	edit: { readonly x: number; readonly z: number },
): boolean {
	const dcx = Math.abs(worldToChunk(edit.x) - worldToChunk(Math.floor(player.x)))
	const dcz = Math.abs(worldToChunk(edit.z) - worldToChunk(Math.floor(player.z)))
	return Math.max(dcx, dcz) <= VALIDATION.streamRadiusChunks
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
	// The world is part of the contract so face and occupancy rules can land
	// later without a signature change. Nothing reads it, and nothing may: see
	// the note at the top of this file.
	void world
	if (edit.tick + NET.inputBufferTicks < player.lastTick) return { ok: false, reason: 'stale_tick' }
	if (edit.y < VALIDATION.minY || edit.y > VALIDATION.maxY) {
		return { ok: false, reason: 'out_of_world' }
	}
	if (!isKnownBlock(edit.block)) return { ok: false, reason: 'unknown_block' }
	const dx = edit.x + 0.5 - player.x
	const dy = edit.y + 0.5 - (player.y + VALIDATION.eyeHeight)
	const dz = edit.z + 0.5 - player.z
	// Negated rather than `>`, so a NaN coordinate is out of reach instead of
	// slipping through every comparison.
	if (!(dx * dx + dy * dy + dz * dz <= REACH_SQ)) return { ok: false, reason: 'out_of_reach' }
	// Defence in depth: reach already bounds x and z, but these are raw i32 from
	// the wire, so the column must also be one this client is streamed.
	if (!isInStreamRadius(player, edit)) return { ok: false, reason: 'out_of_stream' }
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
 *
 * This is a per message cap, which is why it is not a speed limit on its own:
 * the per tick budget in inputGate.ts is what stops a client from buying more
 * of these steps by sending more packets.
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

/**
 * Caps the horizontal part of an already clamped move at `maxBlocks`.
 *
 * The vertical axis is the server's own terrain answer, so it is left alone.
 * What a client can inflate by sending more inputs is the ground it covers, and
 * that is exactly what the per tick budget pays for.
 */
export function clampHorizontalStep(
	player: PlayerState,
	desired: DesiredMove,
	maxBlocks: number,
): DesiredMove {
	const budget = Number.isFinite(maxBlocks) ? Math.max(0, maxBlocks) : 0
	const dx = desired.x - player.x
	const dz = desired.z - player.z
	const distance = Math.hypot(dx, dz)
	// A non finite request is not a move at all: stay where the player is.
	if (!Number.isFinite(distance)) return { ...desired, x: player.x, z: player.z }
	if (distance <= budget) return desired
	const scale = budget / distance
	return { ...desired, x: player.x + dx * scale, z: player.z + dz * scale }
}
