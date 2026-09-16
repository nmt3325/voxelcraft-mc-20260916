/**
 * One encoder/decoder pair per opcode, payload only: frame.ts owns the 8 byte
 * header, so nothing here writes magic, version or opcode.
 *
 * Every decoder ends with requireEnd(). Trailing bytes mean the peer and this
 * build disagree about a layout, and that is exactly the case the server
 * answers with NET_KICK_REASON.BadMessage instead of acting on a
 * half-understood message.
 */
import {
	NET_KICK_REASON,
	isCompatibleProtocol,
	type DimensionId,
	type EntityId,
	type NetBlockChange,
	type NetBlockEdit,
	type NetChunkData,
	type NetEntitySnapshot,
	type NetHello,
	type NetInput,
	type NetKickReason,
	type NetSnapshot,
	type NetWelcome,
} from '@voxelcraft/core-types'
import { ByteReader, ByteWriter } from '../bytes'
import { ENTITY_RECORD_BYTES, readEntity, writeEntity } from './entity'

/** Widest count a u16-prefixed list can carry. */
const MAX_U16 = 0xffff

// Messages the frozen contract does not model as an interface.

export interface NetChat {
	readonly text: string
}

export interface NetPong {
	readonly nonce: number
}

export interface NetPing {
	readonly nonce: number
	readonly serverTimeMs: number
}

export interface NetKick {
	readonly reason: NetKickReason
}

export interface NetTimeSync {
	readonly tick: number
	readonly timeOfDay: number
	readonly serverTimeMs: number
}

export interface NetEntityRemove {
	readonly entities: readonly EntityId[]
}

export interface NetChatBroadcast {
	readonly playerId: EntityId
	readonly name: string
	readonly text: string
}

/** Whether a client's Hello can be served by this build. */
export function isCompatible(hello: NetHello): boolean {
	return isCompatibleProtocol(hello.protocolVersion)
}

const KICK_REASONS: readonly string[] = Object.values(NET_KICK_REASON)

/** Narrows a wire string to the frozen reason set instead of trusting the peer. */
export function assertKickReason(value: string): NetKickReason {
	if (!KICK_REASONS.includes(value)) throw new Error(`net: unknown kick reason: ${value}`)
	return value as NetKickReason
}

// client -> server

export function encodeHello(msg: NetHello): Uint8Array {
	const w = new ByteWriter(32)
	w.u16(msg.protocolVersion)
	w.u16(msg.saveVersion)
	w.str(msg.playerName)
	return w.finish()
}

export function decodeHello(payload: Uint8Array): NetHello {
	const r = new ByteReader(payload)
	const protocolVersion = r.u16()
	const saveVersion = r.u16()
	const playerName = r.str()
	r.requireEnd()
	return { protocolVersion, playerName, saveVersion }
}

export function encodeInput(msg: NetInput): Uint8Array {
	const w = new ByteWriter(16)
	w.u32(msg.tick)
	w.u16(msg.bits)
	w.f32(msg.yaw)
	w.f32(msg.pitch)
	w.u8(msg.hotbar)
	return w.finish()
}

export function decodeInput(payload: Uint8Array): NetInput {
	const r = new ByteReader(payload)
	const tick = r.u32()
	const bits = r.u16()
	const yaw = r.f32()
	const pitch = r.f32()
	const hotbar = r.u8()
	r.requireEnd()
	return { tick, bits, yaw, pitch, hotbar }
}

export function encodeBlockEdit(msg: NetBlockEdit): Uint8Array {
	const w = new ByteWriter(18)
	w.u32(msg.tick)
	w.i32(msg.x)
	w.i32(msg.y)
	w.i32(msg.z)
	w.u16(msg.block)
	return w.finish()
}

export function decodeBlockEdit(payload: Uint8Array): NetBlockEdit {
	const r = new ByteReader(payload)
	const tick = r.u32()
	const x = r.i32()
	const y = r.i32()
	const z = r.i32()
	const block = r.u16()
	r.requireEnd()
	return { tick, x, y, z, block }
}

export function encodeChat(msg: NetChat): Uint8Array {
	const w = new ByteWriter(64)
	w.str(msg.text)
	return w.finish()
}

export function decodeChat(payload: Uint8Array): NetChat {
	const r = new ByteReader(payload)
	const text = r.str()
	r.requireEnd()
	return { text }
}

export function encodePong(msg: NetPong): Uint8Array {
	const w = new ByteWriter(4)
	w.u32(msg.nonce)
	return w.finish()
}

export function decodePong(payload: Uint8Array): NetPong {
	const r = new ByteReader(payload)
	const nonce = r.u32()
	r.requireEnd()
	return { nonce }
}

// server -> client

export function encodeWelcome(msg: NetWelcome): Uint8Array {
	const w = new ByteWriter(26)
	w.u32(msg.playerId)
	w.u32(msg.seed)
	w.u8(msg.dimension)
	w.f32(msg.spawn.x)
	w.f32(msg.spawn.y)
	w.f32(msg.spawn.z)
	w.u32(msg.tick)
	w.u8(msg.maxPlayers)
	return w.finish()
}

export function decodeWelcome(payload: Uint8Array): NetWelcome {
	const r = new ByteReader(payload)
	const playerId = r.u32()
	const seed = r.u32()
	// The wire carries the flat spawn triple; the contract models it as a Vec3f.
	const dimension = r.u8() as DimensionId
	const spawnX = r.f32()
	const spawnY = r.f32()
	const spawnZ = r.f32()
	const tick = r.u32()
	const maxPlayers = r.u8()
	r.requireEnd()
	return {
		playerId,
		seed,
		dimension,
		spawn: { x: spawnX, y: spawnY, z: spawnZ },
		tick,
		maxPlayers,
	}
}

export function encodeSnapshot(msg: NetSnapshot): Uint8Array {
	if (msg.entities.length > MAX_U16) {
		throw new RangeError(`net: too many entities in one snapshot: ${msg.entities.length}`)
	}
	const w = new ByteWriter(11 + msg.entities.length * ENTITY_RECORD_BYTES)
	w.u32(msg.tick)
	w.u8(msg.dimension)
	w.u32(msg.timeOfDay)
	w.u16(msg.entities.length)
	for (const entity of msg.entities) writeEntity(w, entity)
	return w.finish()
}

export function decodeSnapshot(payload: Uint8Array): NetSnapshot {
	const r = new ByteReader(payload)
	const tick = r.u32()
	const dimension = r.u8() as DimensionId
	const timeOfDay = r.u32()
	const count = r.u16()
	const entities: NetEntitySnapshot[] = []
	for (let i = 0; i < count; i++) entities.push(readEntity(r))
	r.requireEnd()
	return { tick, dimension, entities, timeOfDay }
}

export function encodeChunkData(msg: NetChunkData): Uint8Array {
	const w = new ByteWriter(13 + msg.bytes.length)
	w.u8(msg.dimension)
	w.i32(msg.cx)
	w.i32(msg.cz)
	w.blob(msg.bytes)
	return w.finish()
}

export function decodeChunkData(payload: Uint8Array): NetChunkData {
	const r = new ByteReader(payload)
	const dimension = r.u8() as DimensionId
	const cx = r.i32()
	const cz = r.i32()
	const bytes = r.blob()
	r.requireEnd()
	return { dimension, cx, cz, bytes }
}

export function encodeBlockChange(msg: NetBlockChange): Uint8Array {
	const w = new ByteWriter(16)
	w.u8(msg.dimension)
	w.i32(msg.x)
	w.i32(msg.y)
	w.i32(msg.z)
	w.u16(msg.block)
	return w.finish()
}

export function decodeBlockChange(payload: Uint8Array): NetBlockChange {
	const r = new ByteReader(payload)
	const dimension = r.u8() as DimensionId
	const x = r.i32()
	const y = r.i32()
	const z = r.i32()
	const block = r.u16()
	r.requireEnd()
	return { dimension, x, y, z, block }
}

export function encodeEntityRemove(msg: NetEntityRemove): Uint8Array {
	if (msg.entities.length > MAX_U16) {
		throw new RangeError(`net: too many entity removals: ${msg.entities.length}`)
	}
	const w = new ByteWriter(2 + msg.entities.length * 4)
	w.u16(msg.entities.length)
	for (const entity of msg.entities) w.u32(entity)
	return w.finish()
}

export function decodeEntityRemove(payload: Uint8Array): NetEntityRemove {
	const r = new ByteReader(payload)
	const count = r.u16()
	const entities: EntityId[] = []
	for (let i = 0; i < count; i++) entities.push(r.u32())
	r.requireEnd()
	return { entities }
}

export function encodeChatBroadcast(msg: NetChatBroadcast): Uint8Array {
	const w = new ByteWriter(128)
	w.u32(msg.playerId)
	w.str(msg.name)
	w.str(msg.text)
	return w.finish()
}

export function decodeChatBroadcast(payload: Uint8Array): NetChatBroadcast {
	const r = new ByteReader(payload)
	const playerId = r.u32()
	const name = r.str()
	const text = r.str()
	r.requireEnd()
	return { playerId, name, text }
}

export function encodePing(msg: NetPing): Uint8Array {
	const w = new ByteWriter(12)
	w.u32(msg.nonce)
	w.f64(msg.serverTimeMs)
	return w.finish()
}

export function decodePing(payload: Uint8Array): NetPing {
	const r = new ByteReader(payload)
	const nonce = r.u32()
	const serverTimeMs = r.f64()
	r.requireEnd()
	return { nonce, serverTimeMs }
}

export function encodeKick(msg: NetKick): Uint8Array {
	const w = new ByteWriter(32)
	w.str(msg.reason)
	return w.finish()
}

export function decodeKick(payload: Uint8Array): NetKick {
	const r = new ByteReader(payload)
	const reason = assertKickReason(r.str())
	r.requireEnd()
	return { reason }
}

export function encodeTimeSync(msg: NetTimeSync): Uint8Array {
	const w = new ByteWriter(16)
	w.u32(msg.tick)
	w.u32(msg.timeOfDay)
	w.f64(msg.serverTimeMs)
	return w.finish()
}

export function decodeTimeSync(payload: Uint8Array): NetTimeSync {
	const r = new ByteReader(payload)
	const tick = r.u32()
	const timeOfDay = r.u32()
	const serverTimeMs = r.f64()
	r.requireEnd()
	return { tick, timeOfDay, serverTimeMs }
}
