/**
 * Upgrade handling for a node:http server.
 *
 * This only owns the socket lifecycle. The game server decides what to do with
 * a connection, which keeps the transport reusable and unit testable.
 */
import type { IncomingMessage, Server } from 'node:http'
import { NET } from '@voxelcraft/core-types'
import { buildAcceptResponse, buildRejectResponse, checkUpgradeRequest } from './handshake'
import { WsSocket, type UpgradedSocket } from './socket'

export interface WsServerOptions {
	/** Defaults to the frozen NET.path, i.e. the single /ws endpoint. */
	readonly path?: string
	readonly maxMessageBytes?: number
	onConnection(socket: WsSocket, req: IncomingMessage): void
}

/**
 * Attaches the upgrade listener and returns a detach function, so a test can
 * add and remove the endpoint without tearing down the http server.
 */
export function attachWsServer(server: Server, options: WsServerOptions): () => void {
	const path = options.path ?? NET.path

	const onUpgrade = (req: IncomingMessage, socket: UpgradedSocket, head: Uint8Array): void => {
		const check = checkUpgradeRequest(req, path)
		if (!check.ok) {
			// Still plain HTTP at this point, so a Kick frame would be meaningless.
			socket.write(buildRejectResponse(check.status, check.reason))
			socket.destroy()
			return
		}
		socket.write(buildAcceptResponse(check.acceptKey))
		const ws = new WsSocket(socket, {
			masked: false,
			maxMessageBytes: options.maxMessageBytes,
			head,
		})
		options.onConnection(ws, req)
	}

	server.on('upgrade', onUpgrade)
	return () => {
		server.off('upgrade', onUpgrade)
	}
}
