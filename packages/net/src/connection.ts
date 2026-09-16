/**
 * Client side connection state machine with reconnect backoff.
 *
 * Transport agnostic: the caller injects `open`, so the same machine drives a
 * browser WebSocket, the node global WebSocket in tests, or a fake in unit
 * tests. The handful of codecs the transport itself needs are injected too, as
 * a structural interface the codec module happens to satisfy, which keeps this
 * file free of an import cycle.
 */
import { NET, NET_OPCODE, type NetHello, type NetOpcode, type NetWelcome } from '@voxelcraft/core-types'
import { FrameSplitter, encodeFrame, type NetFrame } from './frame'
import { Heartbeat } from './heartbeat'
import { isServerOpcode } from './protocol'

export type ConnectionState =
	| 'idle'
	| 'connecting'
	| 'awaitingWelcome'
	| 'ready'
	| 'waitingToReconnect'
	| 'closed'

export const RECONNECT = {
	baseDelayMs: 500,
	maxDelayMs: 8000,
	maxAttempts: 6,
} as const

/** Frames kept while offline. Roughly a second of input at NET.tickHz. */
export const MAX_QUEUED_FRAMES = 64

/** Exponential backoff, capped and deterministic so tests can assert it. */
export function reconnectDelayMs(attempt: number): number {
	if (attempt <= 0) return 0
	return Math.min(RECONNECT.maxDelayMs, RECONNECT.baseDelayMs * 2 ** (attempt - 1))
}

export interface ClientTransport {
	send(bytes: Uint8Array): void
	close(): void
}

export interface TransportHandlers {
	onOpen(): void
	onBinary(bytes: Uint8Array): void
	onClose(): void
	onError(error: Error): void
}

/** The subset of the codec the transport layer needs by itself. */
export interface ConnectionCodec {
	encodeHello(hello: NetHello): Uint8Array
	decodeWelcome(payload: Uint8Array): NetWelcome
	decodePing(payload: Uint8Array): { nonce: number }
	encodePong(pong: { nonce: number }): Uint8Array
	decodeKick(payload: Uint8Array): { reason: string }
}

export interface ConnectionOptions {
	readonly playerName: string
	readonly saveVersion: number
	readonly codec: ConnectionCodec
	open(handlers: TransportHandlers): ClientTransport
	/** Defaults to true. A kick always disables it for that attempt. */
	readonly autoReconnect?: boolean
	readonly maxAttempts?: number
	readonly now?: () => number
	onFrame?(frame: NetFrame): void
	onStateChange?(state: ConnectionState, previous: ConnectionState): void
	onError?(error: Error): void
}

export class ClientConnection {
	private readonly options: ConnectionOptions
	private readonly splitter = new FrameSplitter()
	private readonly outbox: Uint8Array[] = []
	private transport: ClientTransport | null = null
	private heart: Heartbeat | null = null
	private currentState: ConnectionState = 'idle'
	private welcomeMessage: NetWelcome | null = null
	private attemptCount = 0
	private kick: string | null = null
	private intentional = false
	private lastError: Error | null = null

	constructor(options: ConnectionOptions) {
		this.options = options
	}

	get state(): ConnectionState {
		return this.currentState
	}

	get welcome(): NetWelcome | null {
		return this.welcomeMessage
	}

	get playerId(): number | null {
		return this.welcomeMessage?.playerId ?? null
	}

	get attempts(): number {
		return this.attemptCount
	}

	/** Set only when the server sent a Kick, which suppresses reconnecting. */
	get kickReason(): string | null {
		return this.kick
	}

	get error(): Error | null {
		return this.lastError
	}

	get pendingCount(): number {
		return this.outbox.length
	}

	get nextRetryDelayMs(): number {
		return reconnectDelayMs(this.attemptCount)
	}

	get heartbeat(): Heartbeat | null {
		return this.heart
	}

	connect(): void {
		if (
			this.currentState === 'connecting' ||
			this.currentState === 'awaitingWelcome' ||
			this.currentState === 'ready'
		) {
			return
		}
		this.intentional = false
		this.kick = null
		this.splitter.reset()
		this.setState('connecting')
		this.transport = this.options.open({
			onOpen: () => this.handleOpen(),
			onBinary: (bytes) => this.handleBinary(bytes),
			onClose: () => this.handleClose(),
			onError: (error) => this.handleError(error),
		})
	}

	/** Deliberate hang up: no reconnect follows. */
	disconnect(): void {
		this.intentional = true
		const transport = this.transport
		this.transport = null
		transport?.close()
		this.setState('closed')
	}

	/** Queues the frame while offline instead of dropping player input. */
	send(opcode: NetOpcode, payload: Uint8Array): void {
		const bytes = encodeFrame(opcode, payload)
		if (this.currentState === 'ready' && this.transport !== null) {
			this.transport.send(bytes)
			return
		}
		if (this.outbox.length >= MAX_QUEUED_FRAMES) this.outbox.shift()
		this.outbox.push(bytes)
	}

	/**
	 * Drives the timeout. Returns true when the peer went silent, which is
	 * recoverable and so hands over to the reconnect backoff.
	 */
	tick(nowMs: number): boolean {
		if (this.heart === null) return false
		if (this.currentState !== 'ready' && this.currentState !== 'awaitingWelcome') return false
		if (!this.heart.isTimedOut(nowMs)) return false
		const transport = this.transport
		this.transport = null
		transport?.close()
		this.handleClose()
		return true
	}

	private now(): number {
		return this.options.now?.() ?? Date.now()
	}

	private get maxAttempts(): number {
		return this.options.maxAttempts ?? RECONNECT.maxAttempts
	}

	private handleOpen(): void {
		this.heart = new Heartbeat(this.now())
		this.setState('awaitingWelcome')
		const hello = this.options.codec.encodeHello({
			protocolVersion: NET.protocolVersion,
			playerName: this.options.playerName,
			saveVersion: this.options.saveVersion,
		})
		this.transport?.send(encodeFrame(NET_OPCODE.Hello, hello))
	}

	private handleBinary(bytes: Uint8Array): void {
		let frames: NetFrame[]
		try {
			frames = this.splitter.push(bytes)
		} catch (error) {
			this.failAndClose(error)
			return
		}
		this.heart?.markSeen(this.now())
		for (const frame of frames) {
			try {
				this.route(frame)
			} catch (error) {
				this.failAndClose(error)
				return
			}
		}
	}

	private route(frame: NetFrame): void {
		if (!isServerOpcode(frame.opcode)) {
			throw new Error(`net: opcode ${frame.opcode} is not a server message`)
		}
		const codec = this.options.codec
		switch (frame.opcode) {
			case NET_OPCODE.Welcome:
				this.welcomeMessage = codec.decodeWelcome(frame.payload)
				// A completed handshake is what proves the retry succeeded.
				this.attemptCount = 0
				this.setState('ready')
				this.flush()
				return
			case NET_OPCODE.Ping: {
				const { nonce } = codec.decodePing(frame.payload)
				this.transport?.send(encodeFrame(NET_OPCODE.Pong, codec.encodePong({ nonce })))
				return
			}
			case NET_OPCODE.Kick:
				this.kick = codec.decodeKick(frame.payload).reason
				this.disconnect()
				return
			default:
				this.options.onFrame?.(frame)
		}
	}

	private handleClose(): void {
		if (this.currentState === 'closed' || this.currentState === 'waitingToReconnect') return
		this.transport = null
		this.splitter.reset()
		const canRetry =
			!this.intentional &&
			this.kick === null &&
			(this.options.autoReconnect ?? true) &&
			this.attemptCount < this.maxAttempts
		if (!canRetry) {
			this.setState('closed')
			return
		}
		this.attemptCount += 1
		this.setState('waitingToReconnect')
	}

	private handleError(error: Error): void {
		this.lastError = error
		this.options.onError?.(error)
	}

	private failAndClose(error: unknown): void {
		this.handleError(error instanceof Error ? error : new Error(String(error)))
		this.disconnect()
	}

	private flush(): void {
		if (this.transport === null) return
		for (const bytes of this.outbox) this.transport.send(bytes)
		this.outbox.length = 0
	}

	private setState(next: ConnectionState): void {
		if (next === this.currentState) return
		const previous = this.currentState
		this.currentState = next
		this.options.onStateChange?.(next, previous)
	}
}
