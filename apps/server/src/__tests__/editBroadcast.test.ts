/**
 * rev6 B-1 at the wire. An edit the store cannot retain must not reach other
 * clients as a BlockChange: the store used to accept such a write, delete the
 * column it had just written into, return true anyway, and leave the server
 * telling everyone about a block that does not exist.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { BLOCK, DIMENSION, NET, NET_OPCODE, SAVE_VERSION } from '@voxelcraft/core-types'
import {
	FrameSplitter,
	decodeBlockChange,
	encodeBlockEdit,
	encodeFrame,
	encodeHello,
	type NetFrame,
} from '@voxelcraft/net'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChunkStreamer } from '../gameServer'
import { startGameServer } from '../start'
import { TICK_MS } from '../tick'
import type { PlayerState } from '../types'
import { createServerWorld } from '../world/worldStore'

type Running = Awaited<ReturnType<typeof startGameServer>>

const SEED = 77
const POLL_MS = 5
const TIMEOUT_MS = 10_000
const NO_INBOUND_LIMIT = {
	framesPerSecond: 1e9,
	frameBurst: 1e9,
	bytesPerSecond: 1e9,
	byteBurst: 1e9,
}

/** Streams nothing: the only columns here are the ones an edit asks for. */
const IDLE_STREAMER: ChunkStreamer = {
	track: () => undefined,
	recenter: () => undefined,
	forget: () => undefined,
	next: () => [],
}

const servers: Running[] = []
const sockets: WebSocket[] = []

async function waitFor(frames: NetFrame[], opcode: number): Promise<NetFrame> {
	const deadline = Date.now() + TIMEOUT_MS
	for (;;) {
		const frame = frames.find((candidate) => candidate.opcode === opcode)
		if (frame !== undefined) return frame
		if (Date.now() > deadline) throw new Error(`client: no opcode ${opcode} in time`)
		await sleep(POLL_MS)
	}
}

async function connect(url: string): Promise<{
	frames: NetFrame[]
	send: (bytes: Uint8Array) => void
}> {
	const frames: NetFrame[] = []
	const splitter = new FrameSplitter()
	const socket = new WebSocket(url)
	sockets.push(socket)
	socket.binaryType = 'arraybuffer'
	socket.addEventListener('message', (event) => {
		const data = event.data
		if (!(data instanceof ArrayBuffer)) return
		for (const frame of splitter.push(new Uint8Array(data))) frames.push(frame)
	})
	const deadline = Date.now() + TIMEOUT_MS
	while (socket.readyState === WebSocket.CONNECTING) {
		if (Date.now() > deadline) throw new Error('client: the websocket never opened')
		await sleep(POLL_MS)
	}
	const send = (bytes: Uint8Array): void => {
		if (socket.readyState === WebSocket.OPEN) socket.send(bytes)
	}
	send(
		encodeFrame(
			NET_OPCODE.Hello,
			encodeHello({
				protocolVersion: NET.protocolVersion,
				playerName: 'builder',
				saveVersion: SAVE_VERSION,
			}),
		),
	)
	await waitFor(frames, NET_OPCODE.Welcome)
	return { frames, send }
}

function onlyPlayer(running: Running): PlayerState {
	for (const player of running.server.players()) return player
	throw new Error('the server never welcomed a player')
}

function editFrame(x: number, y: number, z: number): Uint8Array {
	return encodeFrame(
		NET_OPCODE.BlockEdit,
		encodeBlockEdit({ tick: 0, x, y, z, block: BLOCK.STONE }),
	)
}

afterEach(async () => {
	// Vitest hangs on a leaked socket, so this runs even when an assert failed.
	for (const socket of sockets) socket.close()
	sockets.length = 0
	for (const running of servers) await running.close()
	servers.length = 0
})

describe('block change broadcasts', () => {
	it('does not broadcast an edit the world store refused', async () => {
		const refusals: string[] = []
		// One resident column. The spawn column takes it, so an edit in the
		// column next door is one the store has no room to retain.
		const world = createServerWorld(SEED, DIMENSION.Overworld, {
			maxColumns: 1,
			onRefusedWrite: (message) => refusals.push(message),
		})
		const running = await startGameServer({
			port: 0,
			streamer: IDLE_STREAMER,
			world,
			inbound: NO_INBOUND_LIMIT,
			work: { editsPerTick: 1_000_000 },
		})
		servers.push(running)
		const client = await connect(running.url)
		const player = onlyPlayer(running)
		const y = Math.floor(player.y) + 1
		const reference = createServerWorld(SEED)
		const pristine = reference.block(-1, y, 0)
		expect(pristine).not.toBe(BLOCK.STONE)

		// In the spawn column, which the store can retain: accepted, so the
		// server is right to broadcast it.
		client.send(editFrame(0, y, 0))
		const change = await waitFor(client.frames, NET_OPCODE.BlockChange)
		expect(decodeBlockChange(change.payload).x).toBe(0)

		// One block west: in reach and inside the streamed square, but every
		// resident column holds an edit now, so this one cannot be retained.
		client.send(editFrame(-1, y, 0))
		await sleep(10 * TICK_MS)

		expect(refusals).toHaveLength(1)
		const changes = client.frames.filter((frame) => frame.opcode === NET_OPCODE.BlockChange)
		expect(changes).toHaveLength(1)
		expect(world.block(0, y, 0)).toBe(BLOCK.STONE)
		expect(world.block(-1, y, 0)).toBe(pristine)
		// A refused edit is not misbehaviour, so the client stays connected.
		expect(running.server.playerCount).toBe(1)
	}, 30_000)
})
