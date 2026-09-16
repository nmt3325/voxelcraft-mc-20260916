import { NET, NET_KICK_REASON, NET_OPCODE } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import {
	CLIENT_OPCODES,
	KICK_REASONS,
	NetProtocolError,
	SERVER_OPCODES,
	assertClientOpcode,
	assertCompatibleProtocol,
	isClientOpcode,
	isKickReason,
	isServerOpcode,
	kickReasonFor,
} from './protocol'

describe('opcode direction', () => {
	it('partitions every frozen opcode into exactly one direction', () => {
		const all = Object.values(NET_OPCODE)
		expect(CLIENT_OPCODES.length + SERVER_OPCODES.length).toBe(all.length)
		for (const opcode of all) {
			expect(isClientOpcode(opcode) !== isServerOpcode(opcode)).toBe(true)
		}
	})

	it('classifies client messages', () => {
		for (const opcode of [
			NET_OPCODE.Hello,
			NET_OPCODE.Input,
			NET_OPCODE.BlockEdit,
			NET_OPCODE.Chat,
			NET_OPCODE.Pong,
		]) {
			expect(isClientOpcode(opcode)).toBe(true)
		}
	})

	it('rejects unknown opcodes in both directions', () => {
		for (const opcode of [0, 99, 255, -1]) {
			expect(isClientOpcode(opcode)).toBe(false)
			expect(isServerOpcode(opcode)).toBe(false)
		}
	})

	it('assertClientOpcode rejects a server-only opcode with BadMessage', () => {
		expect(() => assertClientOpcode(NET_OPCODE.Hello)).not.toThrow()
		let caught: unknown
		try {
			assertClientOpcode(NET_OPCODE.Snapshot)
		} catch (error) {
			caught = error
		}
		expect(caught).toBeInstanceOf(NetProtocolError)
		expect((caught as NetProtocolError).reason).toBe(NET_KICK_REASON.BadMessage)
	})
})

describe('protocol compatibility', () => {
	it('accepts our own version', () => {
		expect(() => assertCompatibleProtocol(NET.protocolVersion)).not.toThrow()
	})

	it('rejects any other version with ProtocolMismatch', () => {
		for (const version of [0, NET.protocolVersion + 1, 255]) {
			let caught: unknown
			try {
				assertCompatibleProtocol(version)
			} catch (error) {
				caught = error
			}
			expect(caught).toBeInstanceOf(NetProtocolError)
			expect((caught as NetProtocolError).reason).toBe(NET_KICK_REASON.ProtocolMismatch)
			expect((caught as NetProtocolError).message).toContain(String(version))
		}
	})
})

describe('kick reasons', () => {
	it('recognises every frozen reason and nothing else', () => {
		expect(KICK_REASONS).toHaveLength(Object.keys(NET_KICK_REASON).length)
		for (const reason of Object.values(NET_KICK_REASON)) {
			expect(isKickReason(reason)).toBe(true)
		}
		expect(isKickReason('nope')).toBe(false)
		expect(isKickReason('')).toBe(false)
	})

	it('maps a thrown value to a reason', () => {
		expect(kickReasonFor(new NetProtocolError(NET_KICK_REASON.Timeout))).toBe(
			NET_KICK_REASON.Timeout,
		)
		// A decode failure is the peer's fault, so it becomes BadMessage.
		expect(kickReasonFor(new Error('net: truncated payload'))).toBe(NET_KICK_REASON.BadMessage)
		expect(kickReasonFor('boom')).toBe(NET_KICK_REASON.BadMessage)
	})

	it('defaults its message from the reason', () => {
		expect(new NetProtocolError(NET_KICK_REASON.ServerFull).message).toBe(
			`net: ${NET_KICK_REASON.ServerFull}`,
		)
		expect(new NetProtocolError(NET_KICK_REASON.ServerFull).name).toBe('NetProtocolError')
	})
})
