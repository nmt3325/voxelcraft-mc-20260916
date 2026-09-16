import { setTimeout as sleep } from 'node:timers/promises'
import {
	BLOCK,
	CHUNK_VOLUME,
	NET,
	NET_OPCODE,
	SAVE_VERSION,
	blockIndex,
} from '@voxelcraft/core-types'
import {
	FrameSplitter,
	decodeChunkData,
	decodeChunkPayload,
	decodeFrame,
	encodeFrame,
	encodeHello,
	type NetFrame,
} from '@voxelcraft/net'
import { describe, expect, it } from 'vitest'
import { createGameServer, defaultPort, startGameServer, withDefaultStreamer } from './start'
import { createChunkStreamer } from './stream'

/** Polls instead of racing events, which keeps these tests flat and readable. */
async function waitUntil(done: () => boolean, timeoutMs = 15_000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (!done()) {
		if (Date.now() > deadline) throw new Error('start.test: the server never got there in time')
		await sleep(5)
	}
}

describe('defaultPort', () => {
	it('falls back to the frozen default port', () => {
		expect(defaultPort({})).toBe(NET.defaultPort)
		expect(defaultPort({ PORT: '' })).toBe(NET.defaultPort)
		expect(defaultPort({ PORT: '   ' })).toBe(NET.defaultPort)
	})

	it('honours a usable PORT', () => {
		expect(defaultPort({ PORT: '3000' })).toBe(3000)
		// 0 is meaningful: it asks the OS for a free port.
		expect(defaultPort({ PORT: '0' })).toBe(0)
	})

	it('ignores rubbish rather than crashing on boot', () => {
		expect(defaultPort({ PORT: 'abc' })).toBe(NET.defaultPort)
		expect(defaultPort({ PORT: '99999' })).toBe(NET.defaultPort)
		expect(defaultPort({ PORT: '-1' })).toBe(NET.defaultPort)
	})
})

describe('withDefaultStreamer', () => {
	it('hands a real server a streamer that actually queues columns', () => {
		const { streamer } = withDefaultStreamer({})
		expect(streamer).toBeDefined()
		if (streamer === undefined) return
		streamer.track(1, 0, 0)
		// The first next() only primes the clock; the budget pays out after it.
		expect(streamer.next(1, 0)).toEqual([])
		const first = streamer.next(1, 1000)
		expect(first.length).toBeGreaterThan(0)
		// Nearest first: the column the player stands in leads the queue.
		expect(first[0]).toEqual({ cx: 0, cz: 0 })
	})

	it('never overrides a streamer the caller injected', () => {
		const mine = createChunkStreamer({ radius: 0 })
		expect(withDefaultStreamer({ streamer: mine }).streamer).toBe(mine)
	})
})

describe('createGameServer', () => {
	it('applies the frozen defaults', () => {
		const server = createGameServer()
		expect(server.path).toBe(NET.path)
		expect(server.sessions.maxPlayers).toBe(NET.maxPlayers)
		expect(server.playerCount).toBe(0)
		expect(server.tick).toBe(0)
		// No port until it listens.
		expect(server.port).toBe(0)
	})

	it('encodes a chunk the client can decode', () => {
		const server = createGameServer({ seed: 7 })
		const { frame } = decodeFrame(server.chunkDataFrame(0, 0))
		expect(frame.opcode).toBe(NET_OPCODE.ChunkData)
		const data = decodeChunkData(frame.payload)
		expect(data.cx).toBe(0)
		expect(data.cz).toBe(0)
		expect(data.dimension).toBe(server.dimension)
		const snapshot = decodeChunkPayload(data.bytes)
		expect(snapshot.blocks.length).toBe(CHUNK_VOLUME)
		expect(snapshot.fluids.length).toBe(CHUNK_VOLUME)
		// The floor of the world survives the round trip, the sky stays empty.
		expect(snapshot.blocks[blockIndex(0, 0, 0)]).not.toBe(BLOCK.AIR)
		expect(snapshot.blocks[blockIndex(0, 255, 0)]).toBe(BLOCK.AIR)
	})
})

describe('startGameServer', () => {
	it('binds an ephemeral port and serves only the websocket route', async () => {
		const running = await startGameServer({ port: 0, seed: 11 })
		try {
			expect(running.port).toBeGreaterThan(0)
			expect(running.url).toBe(`ws://127.0.0.1:${running.port}${NET.path}`)
			expect(running.server.port).toBe(running.port)
			// A plain http probe is not a game client.
			const response = await fetch(`http://127.0.0.1:${running.port}/`)
			expect(response.status).toBe(404)
			await response.text()
		} finally {
			await running.close()
		}
	})

	it('releases the port on close', async () => {
		const first = await startGameServer({ port: 0 })
		const port = first.port
		await first.close()
		// Rebinding the same port only works because close() really let go.
		const second = await startGameServer({ port })
		try {
			expect(second.port).toBe(port)
		} finally {
			await second.close()
		}
	})

	it('streams chunks to a client without being handed a streamer', async () => {
		// No streamer option: this is exactly what main.ts boots in production.
		const running = await startGameServer({ port: 0, seed: 21 })
		const socket = new WebSocket(running.url)
		socket.binaryType = 'arraybuffer'
		const frames: NetFrame[] = []
		const splitter = new FrameSplitter()
		socket.addEventListener('message', (event) => {
			if (!(event.data instanceof ArrayBuffer)) return
			for (const frame of splitter.push(new Uint8Array(event.data))) frames.push(frame)
		})
		try {
			await waitUntil(() => socket.readyState !== WebSocket.CONNECTING)
			expect(socket.readyState).toBe(WebSocket.OPEN)
			const hello = encodeHello({
				protocolVersion: NET.protocolVersion,
				playerName: 'solo',
				saveVersion: SAVE_VERSION,
			})
			socket.send(encodeFrame(NET_OPCODE.Hello, hello))
			await waitUntil(() => frames.some((frame) => frame.opcode === NET_OPCODE.ChunkData))
			const frame = frames.find((candidate) => candidate.opcode === NET_OPCODE.ChunkData)
			expect(frame).toBeDefined()
			if (frame === undefined) return
			const chunk = decodeChunkData(frame.payload)
			expect({ cx: chunk.cx, cz: chunk.cz }).toEqual({ cx: 0, cz: 0 })
			expect(decodeChunkPayload(chunk.bytes).blocks).toHaveLength(CHUNK_VOLUME)
		} finally {
			socket.close()
			await running.close()
		}
	}, 20_000)
})
