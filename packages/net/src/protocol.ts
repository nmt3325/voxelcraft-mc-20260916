/**
 * Protocol guards. Two peers that disagree about the version or about who may
 * send an opcode must fail loudly and with a frozen kick reason, otherwise a
 * mismatched client shows up later as corrupted world state.
 */
import {
	NET,
	NET_KICK_REASON,
	NET_OPCODE,
	isCompatibleProtocol,
	type NetKickReason,
	type NetOpcode,
} from '@voxelcraft/core-types'

/** Opcodes a client is allowed to send. Everything else is a bad message. */
export const CLIENT_OPCODES: readonly NetOpcode[] = [
	NET_OPCODE.Hello,
	NET_OPCODE.Input,
	NET_OPCODE.BlockEdit,
	NET_OPCODE.Chat,
	NET_OPCODE.Pong,
]

/** Opcodes only the server may send. */
export const SERVER_OPCODES: readonly NetOpcode[] = [
	NET_OPCODE.Welcome,
	NET_OPCODE.Snapshot,
	NET_OPCODE.ChunkData,
	NET_OPCODE.BlockChange,
	NET_OPCODE.EntityRemove,
	NET_OPCODE.ChatBroadcast,
	NET_OPCODE.Ping,
	NET_OPCODE.Kick,
	NET_OPCODE.TimeSync,
]

export const KICK_REASONS: readonly NetKickReason[] = Object.values(NET_KICK_REASON)

/**
 * Carries the kick reason the peer should be told about, so the socket layer
 * never has to guess which of the frozen reasons applies to a failure.
 */
export class NetProtocolError extends Error {
	readonly reason: NetKickReason

	constructor(reason: NetKickReason, message?: string) {
		super(message ?? `net: ${reason}`)
		this.name = 'NetProtocolError'
		this.reason = reason
	}
}

export function isClientOpcode(opcode: number): boolean {
	return CLIENT_OPCODES.includes(opcode as NetOpcode)
}

export function isServerOpcode(opcode: number): boolean {
	return SERVER_OPCODES.includes(opcode as NetOpcode)
}

export function isKickReason(value: string): value is NetKickReason {
	return KICK_REASONS.includes(value as NetKickReason)
}

/** Throws a ProtocolMismatch error unless the peer speaks our version. */
export function assertCompatibleProtocol(version: number): void {
	if (isCompatibleProtocol(version)) return
	throw new NetProtocolError(
		NET_KICK_REASON.ProtocolMismatch,
		`net: protocol ${version} != ${NET.protocolVersion}`,
	)
}

/** Throws a BadMessage error unless a client is allowed to send this opcode. */
export function assertClientOpcode(opcode: number): void {
	if (isClientOpcode(opcode)) return
	throw new NetProtocolError(NET_KICK_REASON.BadMessage, `net: unexpected opcode ${opcode}`)
}

/**
 * Kick reason for any thrown value. A decode failure deep inside a codec is a
 * malformed message from the peer's point of view, not a server fault.
 */
export function kickReasonFor(error: unknown): NetKickReason {
	return error instanceof NetProtocolError ? error.reason : NET_KICK_REASON.BadMessage
}
