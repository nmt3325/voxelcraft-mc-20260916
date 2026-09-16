import { BLOCK, CHUNK_VOLUME, NET, NET_OPCODE, blockIndex } from '@voxelcraft/core-types'
import { decodeChunkData, decodeChunkPayload, decodeFrame } from '@voxelcraft/net'
import { describe, expect, it } from 'vitest'
import { createGameServer, defaultPort, startGameServer } from './start'

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
})
