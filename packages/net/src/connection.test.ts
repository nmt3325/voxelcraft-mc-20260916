import {
	NET,
	NET_KICK_REASON,
	NET_OPCODE,
	type NetHello,
	type NetOpcode,
	type NetWelcome,
} from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { ByteReader, ByteWriter } from './bytes'
import {
	ClientConnection,
	MAX_QUEUED_FRAMES,
	RECONNECT,
	reconnectDelayMs,
	type ClientTransport,
	type ConnectionCodec,
	type ConnectionState,
	type TransportHandlers,
} from './connection'
import { decodeFrames, encodeFrame, type NetFrame } from './frame'

const SPAWN = { x: 0, y: 70, z: 0 }

/**
 * Stands in for the real codec. Only the five messages the state machine
 * handles itself are needed, which is exactly what ConnectionCodec asks for.
 */
const codec: ConnectionCodec = {
	encodeHello: (hello: NetHello) =>
		new ByteWriter(32)
			.u16(hello.protocolVersion)
			.u16(hello.saveVersion)
			.str(hello.playerName)
			.finish(),
	decodeWelcome: (payload): NetWelcome => ({
		playerId: new ByteReader(payload).u32(),
		seed: 42,
		dimension: 0,
		spawn: SPAWN,
		tick: 0,
		maxPlayers: NET.maxPlayers,
	}),
	decodePing: (payload) => ({ nonce: new ByteReader(payload).u32() }),
	encodePong: (pong) => new ByteWriter(4).u32(pong.nonce).finish(),
	decodeKick: (payload) => ({ reason: new ByteReader(payload).str() }),
}

const u32 = (value: number): Uint8Array => new ByteWriter(4).u32(value).finish()
const str = (value: string): Uint8Array => new ByteWriter(32).str(value).finish()

class FakeTransport implements ClientTransport {
	readonly sent: Uint8Array[] = []
	closed = false

	constructor(private readonly handlers: TransportHandlers) {}

	send(bytes: Uint8Array): void {
		this.sent.push(bytes)
	}

	close(): void {
		if (this.closed) return
		this.closed = true
		this.handlers.onClose()
	}

	open(): void {
		this.handlers.onOpen()
	}

	deliver(opcode: NetOpcode, payload: Uint8Array = new Uint8Array(0)): void {
		this.handlers.onBinary(encodeFrame(opcode, payload))
	}

	opcodes(): number[] {
		return this.sent.flatMap((bytes) => decodeFrames(bytes).map((frame) => frame.opcode))
	}
}

function harness(options: { autoReconnect?: boolean; maxAttempts?: number } = {}) {
	const clock = { now: 0 }
	const states: ConnectionState[] = []
	const frames: NetFrame[] = []
	const errors: Error[] = []
	let transport: FakeTransport | null = null

	const connection = new ClientConnection({
		playerName: 'ada',
		saveVersion: 1,
		codec,
		autoReconnect: options.autoReconnect,
		maxAttempts: options.maxAttempts,
		now: () => clock.now,
		open: (handlers) => {
			transport = new FakeTransport(handlers)
			return transport
		},
		onFrame: (frame) => frames.push(frame),
		onStateChange: (state) => states.push(state),
		onError: (error) => errors.push(error),
	})

	// Read through a function so the closure assignment is visible to TS.
	const current = (): FakeTransport => {
		if (transport === null) throw new Error('transport was never opened')
		return transport
	}

	/** connect, open and complete the handshake. */
	const ready = (playerId = 7): void => {
		connection.connect()
		current().open()
		current().deliver(NET_OPCODE.Welcome, u32(playerId))
	}

	return { clock, connection, current, ready, states, frames, errors }
}

describe('reconnectDelayMs', () => {
	it('is a capped exponential backoff', () => {
		expect([0, 1, 2, 3, 4, 5, 6, 99].map(reconnectDelayMs)).toEqual([
			0, 500, 1_000, 2_000, 4_000, 8_000, 8_000, 8_000,
		])
		expect(reconnectDelayMs(RECONNECT.maxAttempts)).toBe(RECONNECT.maxDelayMs)
	})
})

describe('ClientConnection handshake', () => {
	it('sends Hello as soon as the transport opens', () => {
		const { connection, current } = harness()
		connection.connect()
		expect(connection.state).toBe('connecting')
		current().open()
		expect(connection.state).toBe('awaitingWelcome')

		const [frame] = decodeFrames(current().sent[0])
		expect(frame.opcode).toBe(NET_OPCODE.Hello)
		const reader = new ByteReader(frame.payload)
		expect(reader.u16()).toBe(NET.protocolVersion)
		expect(reader.u16()).toBe(1)
		expect(reader.str()).toBe('ada')
	})

	it('becomes ready on Welcome and exposes the player id', () => {
		const { connection, ready, states } = harness()
		ready(7)
		expect(connection.state).toBe('ready')
		expect(connection.playerId).toBe(7)
		expect(connection.welcome?.spawn).toEqual(SPAWN)
		expect(states).toEqual(['connecting', 'awaitingWelcome', 'ready'])
	})

	it('ignores a second connect while already connecting', () => {
		const { connection, current, states } = harness()
		connection.connect()
		const first = current()
		connection.connect()
		expect(current()).toBe(first)
		expect(states).toEqual(['connecting'])
	})
})

describe('ClientConnection messaging', () => {
	it('queues frames until ready, then flushes them in order', () => {
		const { connection, current, ready } = harness()
		connection.send(NET_OPCODE.Input, u32(1))
		connection.send(NET_OPCODE.Chat, str('hi'))
		expect(connection.pendingCount).toBe(2)

		ready()
		expect(connection.pendingCount).toBe(0)
		expect(current().opcodes()).toEqual([NET_OPCODE.Hello, NET_OPCODE.Input, NET_OPCODE.Chat])
	})

	it('caps the offline queue instead of growing without bound', () => {
		const { connection } = harness()
		for (let i = 0; i < MAX_QUEUED_FRAMES + 5; i++) connection.send(NET_OPCODE.Input, u32(i))
		expect(connection.pendingCount).toBe(MAX_QUEUED_FRAMES)
	})

	it('answers a Ping with the same nonce', () => {
		const { connection, current, ready } = harness()
		ready()
		current().deliver(NET_OPCODE.Ping, u32(1234))
		const sent = current().sent
		const [pong] = decodeFrames(sent[sent.length - 1])
		expect(pong.opcode).toBe(NET_OPCODE.Pong)
		expect(new ByteReader(pong.payload).u32()).toBe(1234)
		expect(connection.state).toBe('ready')
	})

	it('hands every other server message to onFrame', () => {
		const { current, ready, frames } = harness()
		ready()
		current().deliver(NET_OPCODE.Snapshot, u32(9))
		current().deliver(NET_OPCODE.BlockChange, u32(3))
		expect(frames.map((frame) => frame.opcode)).toEqual([
			NET_OPCODE.Snapshot,
			NET_OPCODE.BlockChange,
		])
	})

	it('refuses a client-only opcode arriving from the server', () => {
		const { connection, current, ready, errors } = harness()
		ready()
		current().deliver(NET_OPCODE.BlockEdit, u32(1))
		expect(errors).toHaveLength(1)
		expect(errors[0].message).toContain('not a server message')
		expect(connection.state).toBe('closed')
	})
})

describe('ClientConnection lifecycle', () => {
	it('schedules a retry after an unexpected drop', () => {
		const { connection, current, ready } = harness()
		ready()
		current().close()
		expect(connection.state).toBe('waitingToReconnect')
		expect(connection.attempts).toBe(1)
		expect(connection.nextRetryDelayMs).toBe(RECONNECT.baseDelayMs)

		// A completed second handshake clears the attempt counter.
		connection.connect()
		current().open()
		current().deliver(NET_OPCODE.Welcome, u32(8))
		expect(connection.state).toBe('ready')
		expect(connection.attempts).toBe(0)
		expect(connection.playerId).toBe(8)
	})

	it('stops retrying once maxAttempts is spent', () => {
		const { connection, current, ready } = harness({ maxAttempts: 2 })
		ready()
		for (let i = 0; i < 2; i++) {
			current().close()
			expect(connection.state).toBe('waitingToReconnect')
			connection.connect()
			current().open()
		}
		expect(connection.attempts).toBe(2)
		current().close()
		expect(connection.state).toBe('closed')
	})

	it('never retries when autoReconnect is off', () => {
		const { connection, current, ready } = harness({ autoReconnect: false })
		ready()
		current().close()
		expect(connection.state).toBe('closed')
		expect(connection.attempts).toBe(0)
	})

	it('treats a Kick as final and records the frozen reason', () => {
		const { connection, current, ready } = harness()
		ready()
		current().deliver(NET_OPCODE.Kick, str(NET_KICK_REASON.ServerFull))
		expect(connection.kickReason).toBe(NET_KICK_REASON.ServerFull)
		expect(connection.state).toBe('closed')
		expect(current().closed).toBe(true)
	})

	it('drops the connection when the server goes silent', () => {
		const { connection, current, ready } = harness()
		ready()
		expect(connection.tick(NET.timeoutMs - 1)).toBe(false)
		expect(connection.tick(NET.timeoutMs)).toBe(true)
		expect(current().closed).toBe(true)
		expect(connection.state).toBe('waitingToReconnect')
		expect(connection.attempts).toBe(1)
	})

	it('keeps the connection alive while traffic arrives', () => {
		const { clock, connection, current, ready } = harness()
		ready()
		clock.now = NET.timeoutMs - 1
		current().deliver(NET_OPCODE.Snapshot, u32(1))
		expect(connection.tick(NET.timeoutMs)).toBe(false)
		expect(connection.heartbeat?.lastSeenMs).toBe(NET.timeoutMs - 1)
	})

	it('disconnect is deliberate and suppresses the backoff', () => {
		const { connection, current, ready } = harness()
		ready()
		connection.disconnect()
		expect(connection.state).toBe('closed')
		expect(connection.attempts).toBe(0)
		expect(current().closed).toBe(true)
	})
})
