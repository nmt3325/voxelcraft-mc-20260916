/**
 * Start helpers, kept apart from main.ts so tests can boot a server without
 * importing a module that has side effects.
 */
import { GameServer, type GameServerOptions } from './gameServer'
import { createChunkStreamer } from './stream'
import { NET } from '@voxelcraft/core-types'

/** PORT wins, the frozen default follows. Rubbish in PORT is ignored. */
export function defaultPort(source: Record<string, string | undefined>): number {
	const raw = source.PORT
	if (raw === undefined || raw.trim() === '') return NET.defaultPort
	const parsed = Number.parseInt(raw, 10)
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) return NET.defaultPort
	return parsed
}

export interface StartOptions extends GameServerOptions {
	/** 0 asks the OS for a free port, which is what tests must use. */
	readonly port?: number
	readonly host?: string
}

export interface RunningServer {
	readonly server: GameServer
	readonly port: number
	/** ws://127.0.0.1:<port><path>, ready to hand to a WebSocket client. */
	readonly url: string
	close(): Promise<void>
}

/**
 * GameServer streams nothing unless it is handed a queue, which keeps its own
 * unit tests free of a streaming policy. Every server booted through here is a
 * real one, so it gets the frozen radius 6 / 24 columns per second streamer
 * unless the caller injected one of its own.
 */
export function withDefaultStreamer(options: GameServerOptions): GameServerOptions {
	if (options.streamer !== undefined) return options
	return { ...options, streamer: createChunkStreamer() }
}

export function createGameServer(options: GameServerOptions = {}): GameServer {
	return new GameServer(withDefaultStreamer(options))
}

export async function startGameServer(options: StartOptions = {}): Promise<RunningServer> {
	const server = new GameServer(withDefaultStreamer(options))
	const port = await server.listen(options.port ?? NET.defaultPort, options.host ?? '127.0.0.1')
	return {
		server,
		port,
		url: server.url,
		close: () => server.close(),
	}
}
