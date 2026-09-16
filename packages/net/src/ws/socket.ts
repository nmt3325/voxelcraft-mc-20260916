/**
 * A websocket connection on top of an upgraded TCP socket.
 *
 * Only binary messages matter to us: the game protocol is the 8 byte framed
 * binary format, so a text message is a protocol error rather than something
 * to ignore. Ping frames are answered here, at the transport level, because the
 * game heartbeat is a separate app level concern with its own nonce.
 */
import type { Duplex } from 'node:stream'
import {
	WS_CLOSE_NORMAL,
	WS_CLOSE_PROTOCOL_ERROR,
	WS_OPCODE,
	WsFrameReader,
	encodeCloseFrame,
	encodeWsFrame,
	parseClosePayload,
	type WsOpcode,
} from './wsFrame'

/** What node hands us in the http upgrade event, plus the bits we probe for. */
export type UpgradedSocket = Duplex & {
	readonly remoteAddress?: string
	readonly remotePort?: number
	setNoDelay?(noDelay: boolean): void
}

export interface WsSocketHandlers {
	onBinary(payload: Uint8Array): void
	onClose(code: number, reason: string): void
	onError(error: Error): void
}

export interface WsSocketOptions {
	/** True only for a client: RFC 6455 masks client to server frames. */
	readonly masked?: boolean
	readonly maxMessageBytes?: number
	/** Bytes node already read past the handshake in the upgrade event. */
	readonly head?: Uint8Array
}

export class WsSocket {
	readonly remote: string
	private readonly socket: UpgradedSocket
	private readonly reader: WsFrameReader
	private readonly masked: boolean
	private handlers: Partial<WsSocketHandlers> = {}
	private closing = false
	private finished = false

	constructor(socket: UpgradedSocket, options: WsSocketOptions = {}) {
		this.socket = socket
		this.masked = options.masked ?? false
		// A server reads masked frames; a client reads unmasked ones.
		this.reader = new WsFrameReader({
			expectMasked: !this.masked,
			maxMessageBytes: options.maxMessageBytes,
		})
		this.remote = `${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? 0}`
		// Snapshots and chunk pushes are small and latency sensitive.
		socket.setNoDelay?.(true)

		socket.on('data', (chunk: Uint8Array) => this.consume(chunk))
		socket.on('error', (error: Error) => this.fail(error))
		socket.on('close', () => this.finish(WS_CLOSE_NORMAL, ''))

		const head = options.head
		if (head !== undefined && head.length > 0) {
			// Deferred: the owner attaches handlers right after the constructor
			// returns, and dropping the first message would break the handshake.
			queueMicrotask(() => this.consume(head))
		}
	}

	get isClosed(): boolean {
		return this.closing || this.finished
	}

	/** Merges handlers, so a caller can attach them one at a time. */
	on(handlers: Partial<WsSocketHandlers>): this {
		this.handlers = { ...this.handlers, ...handlers }
		return this
	}

	sendBinary(bytes: Uint8Array): void {
		if (this.isClosed) return
		this.writeFrame(WS_OPCODE.Binary, bytes)
	}

	ping(payload: Uint8Array = new Uint8Array(0)): void {
		if (this.isClosed) return
		this.writeFrame(WS_OPCODE.Ping, payload)
	}

	/** Sends a close frame once, then ends the socket. Safe to call twice. */
	close(code: number = WS_CLOSE_NORMAL, reason = ''): void {
		if (this.closing) return
		this.closing = true
		try {
			// The reason must fit in a 125 byte control frame with the 2 byte code.
			this.socket.write(encodeCloseFrame(code, reason.slice(0, 100), this.masked))
		} catch {
			// The peer may already be gone; end() below still tears the socket down.
		}
		this.socket.end()
	}

	destroy(): void {
		this.closing = true
		this.socket.destroy()
	}

	private writeFrame(opcode: WsOpcode, payload: Uint8Array): void {
		try {
			this.socket.write(encodeWsFrame(opcode, payload, this.masked))
		} catch (error) {
			this.fail(error instanceof Error ? error : new Error(String(error)))
		}
	}

	private consume(chunk: Uint8Array): void {
		let messages
		try {
			messages = this.reader.push(chunk)
		} catch (error) {
			this.fail(error instanceof Error ? error : new Error(String(error)))
			this.close(WS_CLOSE_PROTOCOL_ERROR, 'protocol error')
			return
		}

		for (const message of messages) {
			switch (message.opcode) {
				case WS_OPCODE.Binary:
					this.handlers.onBinary?.(message.payload)
					break
				case WS_OPCODE.Ping:
					this.writeFrame(WS_OPCODE.Pong, message.payload)
					break
				case WS_OPCODE.Pong:
					break
				case WS_OPCODE.Close: {
					const { code, reason } = parseClosePayload(message.payload)
					this.close(WS_CLOSE_NORMAL, '')
					this.finish(code, reason)
					break
				}
				default:
					this.fail(new Error(`ws: unsupported opcode ${message.opcode}`))
					this.close(WS_CLOSE_PROTOCOL_ERROR, 'binary only')
					break
			}
		}
	}

	private fail(error: Error): void {
		this.handlers.onError?.(error)
	}

	private finish(code: number, reason: string): void {
		if (this.finished) return
		this.finished = true
		this.handlers.onClose?.(code, reason)
	}
}
