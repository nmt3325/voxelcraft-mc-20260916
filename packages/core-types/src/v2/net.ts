/**
 * v2 multiplayer contract. The server is authoritative: clients send inputs
 * and receive snapshots plus chunk payloads. Framing is binary and versioned
 * so a mismatched build is rejected instead of silently desyncing.
 */
import type { BlockId, EntityId, Vec3f } from '../ids'
import type { DimensionId } from './world2'

export const NET = {
	protocolVersion: 1,
	/** Server simulation rate. Matches PERF.simTickHz. */
	tickHz: 20,
	/** Snapshots are sent at half the sim rate. */
	snapshotHz: 10,
	maxPlayers: 8,
	maxMessageBytes: 1 << 20,
	/** Chunks streamed around each player. */
	streamRadius: 6,
	chunksPerSecondPerClient: 24,
	heartbeatMs: 2000,
	timeoutMs: 15000,
	/** Client input is buffered this many ticks to absorb jitter. */
	inputBufferTicks: 3,
	defaultPort: 8787,
	path: '/ws',
} as const

export const NET_OPCODE = {
	/** client -> server */
	Hello: 1,
	Input: 2,
	BlockEdit: 3,
	Chat: 4,
	Pong: 5,
	/** server -> client */
	Welcome: 64,
	Snapshot: 65,
	ChunkData: 66,
	BlockChange: 67,
	EntityRemove: 68,
	ChatBroadcast: 69,
	Ping: 70,
	Kick: 71,
	TimeSync: 72,
} as const
export type NetOpcode = (typeof NET_OPCODE)[keyof typeof NET_OPCODE]

export const NET_KICK_REASON = {
	ProtocolMismatch: 'protocol_mismatch',
	ServerFull: 'server_full',
	Timeout: 'timeout',
	BadMessage: 'bad_message',
	Shutdown: 'shutdown',
} as const
export type NetKickReason = (typeof NET_KICK_REASON)[keyof typeof NET_KICK_REASON]

/** Frame layout: u16 magic, u8 version, u8 opcode, u32 payload length. */
export const NET_MAGIC = 0x5643
export const NET_HEADER_BYTES = 8

export interface NetFrameHeader {
	readonly version: number
	readonly opcode: NetOpcode
	readonly payloadLength: number
}

export function encodeFrameHeader(
	view: DataView,
	offset: number,
	opcode: NetOpcode,
	payloadLength: number,
): number {
	if (payloadLength < 0 || payloadLength > NET.maxMessageBytes) {
		throw new Error(`net: payload out of range: ${payloadLength}`)
	}
	view.setUint16(offset, NET_MAGIC, true)
	view.setUint8(offset + 2, NET.protocolVersion)
	view.setUint8(offset + 3, opcode)
	view.setUint32(offset + 4, payloadLength, true)
	return offset + NET_HEADER_BYTES
}

export function decodeFrameHeader(view: DataView, offset: number): NetFrameHeader {
	if (view.byteLength - offset < NET_HEADER_BYTES) {
		throw new Error('net: truncated header')
	}
	const magic = view.getUint16(offset, true)
	if (magic !== NET_MAGIC) throw new Error(`net: bad magic 0x${magic.toString(16)}`)
	const version = view.getUint8(offset + 2)
	const opcode = view.getUint8(offset + 3) as NetOpcode
	const payloadLength = view.getUint32(offset + 4, true)
	if (payloadLength > NET.maxMessageBytes) throw new Error('net: payload too large')
	return { version, opcode, payloadLength }
}

/** True when the peer speaks a protocol this build can serve. */
export function isCompatibleProtocol(version: number): boolean {
	return version === NET.protocolVersion
}

export interface NetHello {
	readonly protocolVersion: number
	readonly playerName: string
	/** Last known save version so the server can refuse stale clients. */
	readonly saveVersion: number
}

export interface NetWelcome {
	readonly playerId: EntityId
	readonly seed: number
	readonly dimension: DimensionId
	readonly spawn: Vec3f
	readonly tick: number
	readonly maxPlayers: number
}

/** One tick of client intent. Bit flags keep it small. */
export const INPUT_BIT = {
	Forward: 1 << 0,
	Back: 1 << 1,
	Left: 1 << 2,
	Right: 1 << 3,
	Jump: 1 << 4,
	Sprint: 1 << 5,
	Sneak: 1 << 6,
	UseItem: 1 << 7,
	Attack: 1 << 8,
} as const
export type InputBit = (typeof INPUT_BIT)[keyof typeof INPUT_BIT]

export interface NetInput {
	readonly tick: number
	readonly bits: number
	readonly yaw: number
	readonly pitch: number
	readonly hotbar: number
}

export interface NetBlockEdit {
	readonly tick: number
	readonly x: number
	readonly y: number
	readonly z: number
	/** AIR means break. */
	readonly block: BlockId
}

export interface NetEntitySnapshot {
	readonly entity: EntityId
	readonly kind: number
	readonly x: number
	readonly y: number
	readonly z: number
	readonly yaw: number
	readonly health: number
	readonly flags: number
}

export interface NetSnapshot {
	readonly tick: number
	readonly dimension: DimensionId
	readonly entities: readonly NetEntitySnapshot[]
	/** Server time of day in ticks, mirrored for the day night cycle. */
	readonly timeOfDay: number
}

export interface NetChunkData {
	readonly dimension: DimensionId
	readonly cx: number
	readonly cz: number
	/** Same codec as the save format: CHUNK_MAGIC + CHUNK_CODEC_VERSION. */
	readonly bytes: Uint8Array
}

export interface NetBlockChange {
	readonly dimension: DimensionId
	readonly x: number
	readonly y: number
	readonly z: number
	readonly block: BlockId
}

/** Touch controls for the mobile client. Sizes are CSS pixels. */
export const TOUCH = {
	joystickRadiusPx: 72,
	joystickDeadZone: 0.15,
	buttonSizePx: 56,
	buttonGapPx: 12,
	/** Tap shorter than this breaks a block; longer starts continuous mining. */
	tapMaxMs: 180,
	longPressMs: 350,
	/** Look sensitivity multiplier applied to drag deltas. */
	dragSensitivity: 0.004,
	/** Pointer types that switch the HUD into touch mode. */
	touchPointerTypes: ['touch', 'pen'] as readonly string[],
} as const
