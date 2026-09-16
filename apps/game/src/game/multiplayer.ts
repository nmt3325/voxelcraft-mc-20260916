/**
 * Opt-in multiplayer client.
 *
 * Single player stays the default: nothing here connects unless the page is
 * opened with `?mp=1` or the pause menu turns it on. The protocol, the framing,
 * the heartbeat and the reconnect backoff are all `@voxelcraft/net`, the same
 * code `apps/server` speaks, so this module only owns the browser WebSocket
 * transport, the address to dial and the status the HUD reads.
 */
import {
	NET,
	NET_OPCODE,
	SAVE_VERSION,
	type NetInput,
	type NetSnapshot,
	type NetWelcome,
} from '@voxelcraft/core-types'
import {
	ClientConnection,
	decodeKick,
	decodePing,
	decodeSnapshot,
	decodeWelcome,
	encodeHello,
	encodeInput,
	encodePong,
	type ClientTransport,
	type ConnectionCodec,
	type ConnectionState,
	type TransportHandlers,
} from '@voxelcraft/net'

/** `off` is single player; the rest mirror the connection state machine. */
export type MultiplayerState = ConnectionState | 'off'

export interface MultiplayerStatus {
	enabled: boolean
	state: MultiplayerState
	/** Players in the last snapshot, including the local one. */
	players: number
	address: string
}

export interface MultiplayerOptions {
	/** Page query: `mp=1` opts in, `server=` overrides the address. */
	params: URLSearchParams
	playerName?: string
	onWelcome?: (welcome: NetWelcome) => void
	onSnapshot?: (snapshot: NetSnapshot) => void
	onError?: (message: string) => void
}

export interface MultiplayerSession {
	status(): MultiplayerStatus
	/** Connects when off, hangs up when on. */
	toggle(): void
	/** Sends one tick of intent. Ignored while off. */
	sendInput(input: NetInput): void
	/** Drives the heartbeat timeout. Called once per frame. */
	tick(nowMs: number): void
	close(): void
}

/** The subset of the codec the connection state machine needs. */
const CODEC: ConnectionCodec = { encodeHello, decodeWelcome, decodePing, encodePong, decodeKick }

/** Same host as the page, with the contract's port and path. */
function defaultAddress(): string {
	const host = window.location.hostname === '' ? '127.0.0.1' : window.location.hostname
	const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
	return `${scheme}://${host}:${NET.defaultPort}${NET.path}`
}

function openSocket(address: string, handlers: TransportHandlers): ClientTransport {
	const socket = new WebSocket(address)
	socket.binaryType = 'arraybuffer'
	socket.addEventListener('open', () => {
		handlers.onOpen()
	})
	socket.addEventListener('message', (event: MessageEvent) => {
		const data: unknown = event.data
		// Frames are always binary; text would be a protocol violation.
		if (data instanceof ArrayBuffer) handlers.onBinary(new Uint8Array(data))
	})
	socket.addEventListener('close', () => {
		handlers.onClose()
	})
	socket.addEventListener('error', () => {
		handlers.onError(new Error(`websocket failed: ${address}`))
	})
	return {
		send(bytes: Uint8Array): void {
			if (socket.readyState === WebSocket.OPEN) socket.send(bytes)
		},
		close(): void {
			socket.close()
		},
	}
}

export function createMultiplayer(options: MultiplayerOptions): MultiplayerSession {
	const address = options.params.get('server') ?? defaultAddress()
	let enabled = options.params.get('mp') === '1'
	let players = 0
	let connection: ClientConnection | null = null

	const build = (): ClientConnection =>
		new ClientConnection({
			playerName: options.playerName ?? 'player',
			saveVersion: SAVE_VERSION,
			codec: CODEC,
			open: (handlers) => openSocket(address, handlers),
			onFrame: (frame) => {
				if (frame.opcode !== NET_OPCODE.Snapshot) return
				const snapshot = decodeSnapshot(frame.payload)
				// The server streams the other entities, so the local player is the
				// one this count adds.
				players = snapshot.entities.length + 1
				options.onSnapshot?.(snapshot)
			},
			onStateChange: (state) => {
				if (state === 'ready') {
					const welcome = connection?.welcome ?? null
					if (welcome !== null) options.onWelcome?.(welcome)
				}
				if (state === 'closed') players = 0
			},
			onError: (error) => {
				options.onError?.(error.message)
			},
		})

	const start = (): void => {
		connection ??= build()
		connection.connect()
	}
	if (enabled) start()

	return {
		status(): MultiplayerStatus {
			return {
				enabled,
				state: enabled ? (connection?.state ?? 'idle') : 'off',
				players,
				address,
			}
		},
		toggle(): void {
			enabled = !enabled
			if (enabled) {
				start()
				return
			}
			connection?.disconnect()
			players = 0
		},
		sendInput(input: NetInput): void {
			if (!enabled || connection === null) return
			connection.send(NET_OPCODE.Input, encodeInput(input))
		},
		tick(nowMs: number): void {
			connection?.tick(nowMs)
		},
		close(): void {
			connection?.disconnect()
			connection = null
			enabled = false
			players = 0
		},
	}
}
