/**
 * The authoritative game server.
 *
 * One http server, one websocket route, one world. The client is never trusted:
 * it sends intent (Hello, Input, BlockEdit, Chat, Pong) and the server answers
 * with facts (Welcome, Snapshot, ChunkData, BlockChange, EntityRemove, Ping,
 * Kick, TimeSync). Every rejection path ends in a frozen NET_KICK_REASON so a
 * client always learns why it was dropped.
 *
 * Chunk streaming is injected: this file owns the wire format, while the queue
 * and the per-client budget live behind the ChunkStreamer interface.
 */
import { createServer, type Server } from 'node:http'
import {
	NET,
	NET_KICK_REASON,
	NET_OPCODE,
	SAVE_VERSION,
	worldToChunk,
	type BlockId,
	type DimensionId,
	type EntityId,
	type NetEntitySnapshot,
	type NetKickReason,
} from '@voxelcraft/core-types'
import {
	FrameSplitter,
	NetProtocolError,
	SessionRegistry,
	decodeBlockEdit,
	decodeChat,
	decodeHello,
	decodeInput,
	decodePong,
	encodeBlockChange,
	encodeChatBroadcast,
	encodeChunkData,
	encodeChunkPayload,
	encodeEntityRemove,
	encodeFrame,
	encodeKick,
	encodePing,
	encodeSnapshot,
	encodeTimeSync,
	encodeWelcome,
	isClientOpcode,
	isCompatible,
	type NetFrame,
	type Session,
	type SessionTransport,
} from '@voxelcraft/net'
import { attachWsServer, type WsSocket } from '@voxelcraft/net/ws'
import { desiredMoveFor } from './movement'
import { TickLoop, isSnapshotTick } from './tick'
import type { PlayerState, ServerWorld } from './types'
import { clampMovement, createServerWorld, validateBlockEdit } from './world'

/** Entity kind used for players in snapshots. */
export const PLAYER_ENTITY_KIND = 0
/** Ticks in a full day cycle. Server local: the contract does not fix it. */
export const DAY_TICKS = 24000
/** Wall clock resync cadence, in ticks. */
export const TIME_SYNC_TICKS = NET.tickHz * 5
export const DEFAULT_SEED = 1337
export const SPAWN_X = 0.5
export const SPAWN_Z = 0.5
export const MAX_CHAT_CHARS = 256
export const DEFAULT_HEALTH = 20

/** One chunk the streamer decided to ship. */
export interface StreamTarget {
	readonly cx: number
	readonly cz: number
}

/**
 * The queue side of chunk streaming. Structural on purpose so the streamer can
 * be developed and tested without a socket in sight.
 */
export interface ChunkStreamer {
	/** Start streaming around a freshly welcomed player. */
	track(playerId: EntityId, cx: number, cz: number): void
	/** Re-centre the queue after the player crossed a chunk border. */
	recenter(playerId: EntityId, cx: number, cz: number): void
	forget(playerId: EntityId): void
	/** Columns to send this tick, per client budget already applied. */
	next(playerId: EntityId, nowMs: number): readonly StreamTarget[]
}

export interface GameServerOptions {
	readonly seed?: number
	readonly dimension?: DimensionId
	readonly maxPlayers?: number
	/** Websocket route. Defaults to the frozen NET.path. */
	readonly path?: string
	/** Pre-built world, mostly for tests. */
	readonly world?: ServerWorld
	readonly streamer?: ChunkStreamer
	readonly now?: () => number
}

interface Client {
	readonly session: Session
	readonly socket: WsSocket
	/** One reassembly buffer per socket: net frames can straddle ws messages. */
	readonly splitter: FrameSplitter
	player: PlayerState | null
}

export class GameServer {
	readonly http: Server
	readonly world: ServerWorld
	readonly sessions: SessionRegistry
	readonly path: string
	private readonly clients = new Map<number, Client>()
	private readonly streamer: ChunkStreamer | null
	private readonly loop: TickLoop
	private readonly clock: () => number
	private detach: (() => void) | null
	private timeOfDay = 0

	constructor(options: GameServerOptions = {}) {
		this.clock = options.now ?? (() => Date.now())
		this.world =
			options.world ?? createServerWorld(options.seed ?? DEFAULT_SEED, options.dimension)
		this.sessions = new SessionRegistry(options.maxPlayers ?? NET.maxPlayers)
		this.streamer = options.streamer ?? null
		this.path = options.path ?? NET.path
		this.http = createServer((_req, res) => {
			// The websocket upgrade is the only route; anything else is a probe.
			res.writeHead(404, { 'content-type': 'text/plain' })
			res.end('voxelcraft server: websocket only\n')
		})
		this.detach = attachWsServer(this.http, {
			path: this.path,
			maxMessageBytes: NET.maxMessageBytes,
			onConnection: (socket) => this.accept(socket),
		})
		this.loop = new TickLoop({
			now: this.clock,
			onTick: (tick, nowMs) => this.step(tick, nowMs),
		})
	}

	get tick(): number {
		return this.loop.tick
	}

	get dimension(): DimensionId {
		return this.world.dimension
	}

	get playerCount(): number {
		return this.sessions.activeCount
	}

	/** Bound port, or 0 before listen() resolves. */
	get port(): number {
		const address = this.http.address()
		return typeof address === 'object' && address !== null ? address.port : 0
	}

	get url(): string {
		return `ws://127.0.0.1:${this.port}${this.path}`
	}

	players(): PlayerState[] {
		const players: PlayerState[] = []
		for (const client of this.clients.values()) {
			if (client.session.stage === 'active' && client.player !== null) players.push(client.player)
		}
		return players
	}

	/** Port 0 asks the OS for a free port, which is what tests must use. */
	async listen(port: number = NET.defaultPort, host = '127.0.0.1'): Promise<number> {
		await new Promise<void>((resolve, reject) => {
			const onError = (error: Error): void => reject(error)
			this.http.once('error', onError)
			this.http.listen(port, host, () => {
				this.http.removeListener('error', onError)
				resolve()
			})
		})
		this.loop.start(this.clock())
		return this.port
	}

	async close(): Promise<void> {
		this.loop.stop()
		this.detach?.()
		this.detach = null
		this.sessions.closeAll(NET_KICK_REASON.Shutdown)
		for (const client of this.clients.values()) client.socket.destroy()
		this.clients.clear()
		await new Promise<void>((resolve) => {
			this.http.close(() => resolve())
		})
	}

	/** Runs due ticks by hand. Only for tests with an injected clock. */
	advanceTo(nowMs: number): number {
		return this.loop.advanceTo(nowMs)
	}

	private accept(socket: WsSocket): void {
		const transport: SessionTransport = {
			send: (bytes) => {
				if (!socket.isClosed) socket.sendBinary(bytes)
			},
			close: (reason) => {
				// Always say why before hanging up.
				if (socket.isClosed) return
				socket.sendBinary(encodeFrame(NET_OPCODE.Kick, encodeKick({ reason })))
				socket.close()
			},
			remote: socket.remote,
		}
		const session = this.sessions.open(transport, this.clock())
		const client: Client = { session, socket, splitter: new FrameSplitter(), player: null }
		this.clients.set(session.id, client)
		socket.on({
			onBinary: (payload) => this.receive(client, payload),
			onClose: () => this.drop(client),
			onError: () => this.drop(client),
		})
	}

	private receive(client: Client, payload: Uint8Array): void {
		try {
			for (const frame of client.splitter.push(payload)) this.handle(client, frame)
		} catch (error) {
			this.kick(
				client,
				error instanceof NetProtocolError ? error.reason : NET_KICK_REASON.BadMessage,
			)
		}
	}

	private handle(client: Client, frame: NetFrame): void {
		// A server opcode arriving from a client means the peer is confused.
		if (!isClientOpcode(frame.opcode)) throw new NetProtocolError(NET_KICK_REASON.BadMessage)
		const nowMs = this.clock()
		client.session.heartbeat.markSeen(nowMs)
		switch (frame.opcode) {
			case NET_OPCODE.Hello:
				this.onHello(client, frame.payload, nowMs)
				return
			case NET_OPCODE.Input:
				this.onInput(client, frame.payload)
				return
			case NET_OPCODE.BlockEdit:
				this.onBlockEdit(client, frame.payload)
				return
			case NET_OPCODE.Chat:
				this.onChat(client, frame.payload)
				return
			case NET_OPCODE.Pong:
				this.onPong(client, frame.payload, nowMs)
				return
			default:
				throw new NetProtocolError(NET_KICK_REASON.BadMessage)
		}
	}

	private onHello(client: Client, payload: Uint8Array, nowMs: number): void {
		if (client.session.stage !== 'handshaking') {
			throw new NetProtocolError(NET_KICK_REASON.BadMessage)
		}
		const hello = decodeHello(payload)
		if (!isCompatible(hello)) throw new NetProtocolError(NET_KICK_REASON.ProtocolMismatch)
		// A client built on a newer save format would misread our chunk payloads.
		if (hello.saveVersion > SAVE_VERSION) {
			throw new NetProtocolError(NET_KICK_REASON.ProtocolMismatch)
		}
		const session = this.sessions.activate(client.session, hello.playerName, nowMs)
		if (session === null) {
			this.kick(client, NET_KICK_REASON.ServerFull)
			return
		}
		const playerId = session.playerId ?? 0
		const player: PlayerState = {
			id: playerId,
			name: session.name,
			x: SPAWN_X,
			y: this.world.surfaceY(Math.floor(SPAWN_X), Math.floor(SPAWN_Z)),
			z: SPAWN_Z,
			yaw: 0,
			pitch: 0,
			health: DEFAULT_HEALTH,
			hotbar: 0,
			bits: 0,
			lastTick: 0,
		}
		client.player = player
		session.transport.send(
			encodeFrame(
				NET_OPCODE.Welcome,
				encodeWelcome({
					playerId,
					seed: this.world.seed,
					dimension: this.world.dimension,
					spawn: { x: player.x, y: player.y, z: player.z },
					tick: this.loop.tick,
					maxPlayers: this.sessions.maxPlayers,
				}),
			),
		)
		session.transport.send(this.timeSyncFrame(this.loop.tick, nowMs))
		this.streamer?.track(playerId, worldToChunk(Math.floor(player.x)), worldToChunk(Math.floor(player.z)))
	}

	private onInput(client: Client, payload: Uint8Array): void {
		const player = this.requirePlayer(client)
		const input = decodeInput(payload)
		// Replays and reordered packets must never rewind the authority.
		if (input.tick < player.lastTick) return
		const beforeCx = worldToChunk(Math.floor(player.x))
		const beforeCz = worldToChunk(Math.floor(player.z))
		const moved = clampMovement(player, desiredMoveFor(player, input, this.world))
		player.x = moved.x
		player.y = moved.y
		player.z = moved.z
		player.yaw = moved.yaw
		player.pitch = moved.pitch
		player.bits = input.bits
		player.hotbar = input.hotbar
		player.lastTick = input.tick
		client.session.lastTick = input.tick
		const cx = worldToChunk(Math.floor(player.x))
		const cz = worldToChunk(Math.floor(player.z))
		if (cx !== beforeCx || cz !== beforeCz) this.streamer?.recenter(player.id, cx, cz)
	}

	private onBlockEdit(client: Client, payload: Uint8Array): void {
		const player = this.requirePlayer(client)
		const edit = decodeBlockEdit(payload)
		const verdict = validateBlockEdit(player, edit, this.world)
		if (!verdict.ok) {
			// Hand the authoritative block back so the client reverts its guess.
			// Out of world coordinates have no block to quote, so stay silent.
			if (verdict.reason !== 'out_of_world') {
				const current = this.world.block(edit.x, edit.y, edit.z)
				client.session.transport.send(this.blockChangeFrame(edit.x, edit.y, edit.z, current))
			}
			return
		}
		if (!this.world.setBlock(edit.x, edit.y, edit.z, verdict.block)) return
		// Including the editor: it must confirm against the server, not its guess.
		this.sessions.broadcast(this.blockChangeFrame(edit.x, edit.y, edit.z, verdict.block))
	}

	private onChat(client: Client, payload: Uint8Array): void {
		const player = this.requirePlayer(client)
		const text = decodeChat(payload).text.slice(0, MAX_CHAT_CHARS).trim()
		if (text.length === 0) return
		this.sessions.broadcast(
			encodeFrame(
				NET_OPCODE.ChatBroadcast,
				encodeChatBroadcast({ playerId: player.id, name: player.name, text }),
			),
		)
	}

	private onPong(client: Client, payload: Uint8Array, nowMs: number): void {
		client.session.heartbeat.onPong(decodePong(payload).nonce, nowMs)
	}

	private requirePlayer(client: Client): PlayerState {
		if (client.session.stage !== 'active' || client.player === null) {
			// Anything before Welcome is a client that skipped the handshake.
			throw new NetProtocolError(NET_KICK_REASON.BadMessage)
		}
		return client.player
	}

	private step(tick: number, nowMs: number): void {
		this.timeOfDay = (this.timeOfDay + 1) % DAY_TICKS
		this.expire(nowMs)
		this.beat(nowMs)
		this.stream(nowMs)
		if (isSnapshotTick(tick)) this.sendSnapshot(tick)
		if (tick % TIME_SYNC_TICKS === 0) this.sessions.broadcast(this.timeSyncFrame(tick, nowMs))
	}

	private expire(nowMs: number): void {
		for (const session of this.sessions.timedOut(nowMs)) {
			const client = this.clients.get(session.id)
			if (client === undefined) this.sessions.close(session, NET_KICK_REASON.Timeout)
			else this.kick(client, NET_KICK_REASON.Timeout)
		}
	}

	private beat(nowMs: number): void {
		for (const session of this.sessions.all()) {
			if (!session.heartbeat.shouldPing(nowMs)) continue
			session.heartbeat.nextPing(nowMs)
			const nonce = session.heartbeat.pendingNonce ?? 0
			session.transport.send(
				encodeFrame(NET_OPCODE.Ping, encodePing({ nonce, serverTimeMs: nowMs })),
			)
		}
	}

	private stream(nowMs: number): void {
		const streamer = this.streamer
		if (streamer === null) return
		for (const session of this.sessions.active()) {
			const playerId = session.playerId
			if (playerId === null) continue
			for (const target of streamer.next(playerId, nowMs)) {
				session.transport.send(this.chunkDataFrame(target.cx, target.cz))
			}
		}
	}

	private sendSnapshot(tick: number): void {
		const entities: NetEntitySnapshot[] = []
		for (const player of this.players()) {
			entities.push({
				entity: player.id,
				kind: PLAYER_ENTITY_KIND,
				x: player.x,
				y: player.y,
				z: player.z,
				yaw: player.yaw,
				health: player.health,
				flags: player.bits,
			})
		}
		if (entities.length === 0) return
		this.sessions.broadcast(
			encodeFrame(
				NET_OPCODE.Snapshot,
				encodeSnapshot({
					tick,
					dimension: this.world.dimension,
					entities,
					timeOfDay: this.timeOfDay,
				}),
			),
		)
	}

	/** Encodes one column exactly as the client expects to receive it. */
	chunkDataFrame(cx: number, cz: number): Uint8Array {
		const column = this.world.chunk(cx, cz)
		return encodeFrame(
			NET_OPCODE.ChunkData,
			encodeChunkData({
				dimension: this.world.dimension,
				cx,
				cz,
				bytes: encodeChunkPayload(column),
			}),
		)
	}

	private blockChangeFrame(x: number, y: number, z: number, block: BlockId): Uint8Array {
		return encodeFrame(
			NET_OPCODE.BlockChange,
			encodeBlockChange({ dimension: this.world.dimension, x, y, z, block }),
		)
	}

	private timeSyncFrame(tick: number, nowMs: number): Uint8Array {
		return encodeFrame(
			NET_OPCODE.TimeSync,
			encodeTimeSync({ tick, timeOfDay: this.timeOfDay, serverTimeMs: nowMs }),
		)
	}

	private kick(client: Client, reason: NetKickReason): void {
		this.sessions.close(client.session, reason)
		this.forget(client)
	}

	private drop(client: Client): void {
		// The socket is already gone: release the slot, the kick frame is moot.
		this.sessions.close(client.session, NET_KICK_REASON.Shutdown)
		this.forget(client)
	}

	private forget(client: Client): void {
		this.clients.delete(client.session.id)
		const player = client.player
		client.player = null
		if (player === null) return
		this.streamer?.forget(player.id)
		this.sessions.broadcast(
			encodeFrame(NET_OPCODE.EntityRemove, encodeEntityRemove({ entities: [player.id] })),
		)
	}
}
