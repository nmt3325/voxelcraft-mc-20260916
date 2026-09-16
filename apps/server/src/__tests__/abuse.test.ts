/**
 * Abuse tests: one real listener, one real websocket, one client that
 * misbehaves on purpose.
 *
 * Every case here was first reported against a running server, so every case
 * here drives the whole wire path instead of the unit underneath it. The
 * server is authoritative, and these are the things it must refuse to do for a
 * peer that asks nicely but often.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import {
	BLOCK,
	INPUT_BIT,
	NET,
	NET_KICK_REASON,
	NET_OPCODE,
	SAVE_VERSION,
} from '@voxelcraft/core-types'
import {
	FrameSplitter,
	decodeKick,
	encodeBlockEdit,
	encodeFrame,
	encodeHello,
	encodeInput,
	type NetFrame,
} from '@voxelcraft/net'
import { afterEach, describe, expect, it } from 'vitest'
import { SPAWN_X, SPAWN_Z, type ChunkStreamer } from '../gameServer'
import { WALK_SPEED } from '../movement'
import { startGameServer, type StartOptions } from '../start'
import { TICK_MS } from '../tick'
import type { PlayerState } from '../types'

type Running = Awaited<ReturnType<typeof startGameServer>>

const POLL_MS = 5
const OPEN_TIMEOUT_MS = 10_000
const FRAME_TIMEOUT_MS = 10_000

/** Lifts the inbound budget, for the tests that are not about rate limiting. */
const NO_INBOUND_LIMIT = {
	framesPerSecond: 1e9,
	frameBurst: 1e9,
	bytesPerSecond: 1e9,
	byteBurst: 1e9,
}

/**
 * Streams nothing. Background streaming would generate columns of its own,
 * and the world growth tests need the loaded column count to stand still
 * unless the abuse itself moved it.
 */
const IDLE_STREAMER: ChunkStreamer = {
	track: () => undefined,
	recenter: () => undefined,
	forget: () => undefined,
	next: () => [],
}

class TestClient {
	readonly frames: NetFrame[] = []
	private readonly socket: WebSocket
	private readonly splitter = new FrameSplitter()

	constructor(url: string) {
		this.socket = new WebSocket(url)
		this.socket.binaryType = 'arraybuffer'
		this.socket.addEventListener('message', (event) => {
			const data = event.data
			if (!(data instanceof ArrayBuffer)) return
			for (const frame of this.splitter.push(new Uint8Array(data))) this.frames.push(frame)
		})
	}

	async open(): Promise<void> {
		const deadline = Date.now() + OPEN_TIMEOUT_MS
		while (this.socket.readyState === WebSocket.CONNECTING) {
			if (Date.now() > deadline) throw new Error('client: the websocket never opened')
			await sleep(POLL_MS)
		}
		if (this.socket.readyState !== WebSocket.OPEN) {
			throw new Error('client: the websocket closed during the handshake')
		}
	}

	/** Silently drops a send after a kick: the point of the test is the kick. */
	send(bytes: Uint8Array): void {
		if (this.socket.readyState !== WebSocket.OPEN) return
		this.socket.send(bytes)
	}

	close(): void {
		if (this.socket.readyState === WebSocket.CLOSED) return
		this.socket.close()
	}

	async waitFor(opcode: number): Promise<NetFrame> {
		const deadline = Date.now() + FRAME_TIMEOUT_MS
		for (;;) {
			const frame = this.frames.find((candidate) => candidate.opcode === opcode)
			if (frame !== undefined) return frame
			if (Date.now() > deadline) throw new Error(`client: no opcode ${opcode} in time`)
			await sleep(POLL_MS)
		}
	}
}

const servers: Running[] = []
const clients: TestClient[] = []

async function start(options: StartOptions): Promise<Running> {
	// Port 0: the OS picks a free port, so a parallel run never collides.
	const running = await startGameServer({ port: 0, streamer: IDLE_STREAMER, ...options })
	servers.push(running)
	return running
}

async function open(url: string): Promise<TestClient> {
	const client = new TestClient(url)
	clients.push(client)
	await client.open()
	return client
}

async function connect(url: string, playerName: string): Promise<TestClient> {
	const client = await open(url)
	client.send(
		encodeFrame(
			NET_OPCODE.Hello,
			encodeHello({ protocolVersion: NET.protocolVersion, playerName, saveVersion: SAVE_VERSION }),
		),
	)
	await client.waitFor(NET_OPCODE.Welcome)
	return client
}

/** The live player object, so a position survives the client being kicked. */
function onlyPlayer(running: Running): PlayerState {
	for (const player of running.server.players()) return player
	throw new Error('the server never welcomed a player')
}

function travelled(player: PlayerState): number {
	return Math.hypot(player.x - SPAWN_X, player.z - SPAWN_Z)
}

function inputFrame(tick: number, bits: number): Uint8Array {
	return encodeFrame(NET_OPCODE.Input, encodeInput({ tick, bits, yaw: 0, pitch: 0, hotbar: 0 }))
}

afterEach(async () => {
	// Vitest hangs on a leaked socket, so this runs even when an assert failed.
	for (const client of clients) client.close()
	clients.length = 0
	for (const running of servers) await running.close()
	servers.length = 0
})

describe('movement abuse', () => {
	// B-1. Movement used to be applied per message, so packet rate was speed:
	// 200 Input frames carrying one tick walked 43.17 blocks against a budget of
	// 0.21585 blocks per tick.
	it('caps travel at one tick of walking however many inputs arrive', async () => {
		const running = await start({ seed: 31, inbound: NO_INBOUND_LIMIT })
		const client = await connect(running.url, 'sprinter')
		const player = onlyPlayer(running)
		const startTick = running.server.tick
		let clientTick = 1
		// Five inputs per server tick, each with a fresh tick number: five times
		// the legal rate, and still well inside the flood threshold.
		for (let batch = 0; batch < 24; batch++) {
			for (let i = 0; i < 5; i++) client.send(inputFrame(clientTick++, INPUT_BIT.Forward))
			await sleep(TICK_MS)
		}
		await sleep(4 * TICK_MS)
		const ticks = running.server.tick - startTick
		expect(ticks).toBeGreaterThan(0)
		expect(running.server.playerCount).toBe(1)
		// It walked, and it walked no further than the ticks it spent walking.
		expect(travelled(player)).toBeGreaterThan(0)
		expect(travelled(player)).toBeLessThanOrEqual((ticks + 1) * WALK_SPEED + 1e-6)
	}, 30_000)

	it('kicks a client that floods a single tick with inputs', async () => {
		// The inbound budget is lifted, so this kick has to come from the gate.
		const running = await start({ seed: 33, inbound: NO_INBOUND_LIMIT })
		const client = await connect(running.url, 'flooder')
		const player = onlyPlayer(running)
		for (let i = 0; i < 200; i++) client.send(inputFrame(1, INPUT_BIT.Forward))
		const kick = await client.waitFor(NET_OPCODE.Kick)
		expect(decodeKick(kick.payload).reason).toBe(NET_KICK_REASON.BadMessage)
		expect(running.server.playerCount).toBe(0)
		// One tick of the contract's walk speed, not 200 messages worth of it.
		expect(travelled(player)).toBeLessThanOrEqual(WALK_SPEED + 1e-6)
	}, 30_000)
})

describe('world abuse', () => {
	// B-2. Block edit validation bounded y only and the rejected path read the
	// block back, so 300 out of reach edits generated and cached 300 columns.
	it('does not let out of reach edits grow the world', async () => {
		const running = await start({
			seed: 41,
			inbound: NO_INBOUND_LIMIT,
			// The per tick edit budget would drop most of the burst on its own, and
			// this test is about what validation does with the edits it sees.
			work: { editsPerTick: 1_000_000 },
		})
		const client = await connect(running.url, 'digger')
		const before = running.server.world.loadedChunks
		expect(before).toBeGreaterThan(0)
		for (let i = 0; i < 300; i++) {
			client.send(
				encodeFrame(
					NET_OPCODE.BlockEdit,
					encodeBlockEdit({ tick: 0, x: 512 + i * 16, y: 70, z: 512 + i * 16, block: BLOCK.STONE }),
				),
			)
		}
		await sleep(10 * TICK_MS)
		// Not one column, and the client is still connected: rejected edits are
		// not worth a kick, they are just worth nothing.
		expect(running.server.world.loadedChunks).toBe(before)
		expect(running.server.playerCount).toBe(1)
	}, 30_000)
})

describe('protocol abuse', () => {
	// M-1. The header version byte was decoded and then ignored.
	it('kicks a frame that claims another protocol version', async () => {
		const running = await start({ seed: 51 })
		const client = await open(running.url)
		const frame = encodeFrame(
			NET_OPCODE.Hello,
			encodeHello({
				protocolVersion: NET.protocolVersion,
				playerName: 'timeTraveller',
				saveVersion: SAVE_VERSION,
			}),
		)
		// The payload is impeccable. Only the header version byte is from the
		// future, which is exactly the case that used to be read field by field.
		frame[2] = NET.protocolVersion + 1
		client.send(frame)
		const kick = await client.waitFor(NET_OPCODE.Kick)
		expect(decodeKick(kick.payload).reason).toBe(NET_KICK_REASON.ProtocolMismatch)
		expect(running.server.playerCount).toBe(0)
	}, 30_000)

	// M-2. There was no inbound rate limit at all.
	it('kicks a client that floods the socket past the frozen budget', async () => {
		// Default limits this time: the inbound buckets are the subject.
		const running = await start({ seed: 53 })
		const client = await connect(running.url, 'hoser')
		for (let i = 0; i < 500; i++) client.send(inputFrame(i + 1, 0))
		const kick = await client.waitFor(NET_OPCODE.Kick)
		expect(decodeKick(kick.payload).reason).toBe(NET_KICK_REASON.BadMessage)
		expect(running.server.playerCount).toBe(0)
	}, 30_000)
})
