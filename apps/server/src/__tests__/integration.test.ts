/**
 * Headless acceptance test for the authoritative server.
 *
 * Two real websocket clients against a real listener: the handshake, an
 * authoritative block edit observed by the other player, and streamed chunk
 * columns that round trip through the frozen chunk codec. No browser, no fake
 * timers, and the port is always chosen by the OS.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { BLOCK, CHUNK_VOLUME, NET, NET_OPCODE, SAVE_VERSION } from '@voxelcraft/core-types'
import {
	FrameSplitter,
	decodeBlockChange,
	decodeChunkData,
	decodeChunkPayload,
	decodePing,
	decodeWelcome,
	encodeBlockEdit,
	encodeFrame,
	encodeHello,
	encodePong,
	type NetFrame,
} from '@voxelcraft/net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startGameServer } from '../start'
import { createChunkStreamer } from '../stream'

type Running = Awaited<ReturnType<typeof startGameServer>>
type Welcome = ReturnType<typeof decodeWelcome>

interface Connected {
	readonly client: TestClient
	readonly welcome: Welcome
}

const SEED = 4242
const POLL_MS = 5
const OPEN_TIMEOUT_MS = 10_000
const FRAME_TIMEOUT_MS = 15_000

/** Every socket we opened, so the teardown closes them even after a failure. */
const opened: TestClient[] = []

/**
 * One test client. Frames are kept in arrival order because the test asserts
 * which ChunkData arrived first, and server Pings are answered here so the
 * heartbeat never times a client out mid test.
 */
class TestClient {
	readonly frames: NetFrame[] = []
	private readonly socket: WebSocket
	private readonly splitter = new FrameSplitter()

	constructor(url: string) {
		this.socket = new WebSocket(url)
		// Frames may arrive coalesced, so the splitter always reassembles bytes.
		this.socket.binaryType = 'arraybuffer'
		this.socket.addEventListener('message', (event) => {
			this.consume(event.data)
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

	send(frame: Uint8Array): void {
		this.socket.send(frame)
	}

	close(): void {
		if (this.socket.readyState === WebSocket.CLOSED) return
		this.socket.close()
	}

	first(opcode: number): NetFrame | undefined {
		return this.frames.find((frame) => frame.opcode === opcode)
	}

	/** Resolves with the first frame of that opcode, already received or not. */
	async waitFor(opcode: number): Promise<NetFrame> {
		const deadline = Date.now() + FRAME_TIMEOUT_MS
		for (;;) {
			const frame = this.first(opcode)
			if (frame !== undefined) return frame
			if (Date.now() > deadline) throw new Error(`client: no opcode ${opcode} in time`)
			await sleep(POLL_MS)
		}
	}

	private consume(data: unknown): void {
		if (!(data instanceof ArrayBuffer)) throw new Error('client: expected binary messages')
		for (const frame of this.splitter.push(new Uint8Array(data))) {
			this.frames.push(frame)
			// The server kicks a client that stops answering its heartbeat.
			if (frame.opcode !== NET_OPCODE.Ping) continue
			const { nonce } = decodePing(frame.payload)
			this.send(encodeFrame(NET_OPCODE.Pong, encodePong({ nonce })))
		}
	}
}

async function connect(url: string, playerName: string): Promise<Connected> {
	const client = new TestClient(url)
	opened.push(client)
	await client.open()
	const hello = encodeHello({
		protocolVersion: NET.protocolVersion,
		playerName,
		saveVersion: SAVE_VERSION,
	})
	client.send(encodeFrame(NET_OPCODE.Hello, hello))
	const frame = await client.waitFor(NET_OPCODE.Welcome)
	return { client, welcome: decodeWelcome(frame.payload) }
}

describe('server integration', () => {
	let running: Running | undefined
	let alice: TestClient
	let bob: TestClient
	let aliceWelcome: Welcome
	let bobWelcome: Welcome

	beforeAll(async () => {
		// Port 0: the OS picks a free port, so a parallel run never collides.
		running = await startGameServer({ port: 0, seed: SEED, streamer: createChunkStreamer() })
		const first = await connect(running.url, 'alice')
		const second = await connect(running.url, 'bob')
		alice = first.client
		bob = second.client
		aliceWelcome = first.welcome
		bobWelcome = second.welcome
	})

	afterAll(async () => {
		// Vitest hangs on a leaked socket, so this runs even when an assert failed.
		for (const client of opened) client.close()
		await running?.close()
	})

	it('welcomes two clients with distinct player ids', () => {
		expect(aliceWelcome.playerId).not.toBe(bobWelcome.playerId)
		expect(aliceWelcome.maxPlayers).toBe(NET.maxPlayers)
		expect(bobWelcome.maxPlayers).toBe(NET.maxPlayers)
		expect(aliceWelcome.seed).toBe(SEED)
	})

	it('broadcasts an accepted block edit to the other client', async () => {
		// Spawn is x 0.5, z 0.5, so the column under the feet is well within reach.
		const target = { x: 0, y: Math.floor(aliceWelcome.spawn.y) - 1, z: 0 }
		const edit = encodeBlockEdit({
			tick: aliceWelcome.tick,
			x: target.x,
			y: target.y,
			z: target.z,
			block: BLOCK.STONE,
		})
		alice.send(encodeFrame(NET_OPCODE.BlockEdit, edit))

		const frame = await bob.waitFor(NET_OPCODE.BlockChange)
		const change = decodeBlockChange(frame.payload)
		expect({ x: change.x, y: change.y, z: change.z }).toEqual(target)
		expect(change.block).toBe(BLOCK.STONE)
		expect(change.dimension).toBe(bobWelcome.dimension)
	}, 20_000)

	it('streams the centre column first and round trips the chunk codec', async () => {
		const [aliceFrame, bobFrame] = await Promise.all([
			alice.waitFor(NET_OPCODE.ChunkData),
			bob.waitFor(NET_OPCODE.ChunkData),
		])
		const aliceChunk = decodeChunkData(aliceFrame.payload)
		const bobChunk = decodeChunkData(bobFrame.payload)
		// Nearest first: the column the player is standing in leads the queue.
		expect({ cx: aliceChunk.cx, cz: aliceChunk.cz }).toEqual({ cx: 0, cz: 0 })
		expect({ cx: bobChunk.cx, cz: bobChunk.cz }).toEqual({ cx: 0, cz: 0 })

		expect(CHUNK_VOLUME).toBe(65_536)
		const snapshot = decodeChunkPayload(aliceChunk.bytes)
		expect(snapshot.blocks).toHaveLength(CHUNK_VOLUME)
		expect(snapshot.fluids).toHaveLength(CHUNK_VOLUME)
		// The payload carries no coordinates of its own; the frame header is the
		// source of truth, and for the centre column both read 0,0.
		expect({ cx: snapshot.cx, cz: snapshot.cz }).toEqual({ cx: aliceChunk.cx, cz: aliceChunk.cz })
		// A generated column is not empty, so the round trip really carried terrain.
		expect(snapshot.blocks.some((block) => block !== BLOCK.AIR)).toBe(true)
	}, 20_000)
})
