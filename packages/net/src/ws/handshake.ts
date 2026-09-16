/**
 * RFC 6455 opening handshake, hand rolled: no new npm dependency is allowed,
 * and the server only ever needs the binary subset of the protocol.
 *
 * Kept separate from the framing so the pure byte work stays testable without
 * an http server.
 */
import { createHash, randomBytes } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import { NET } from '@voxelcraft/core-types'

/** The fixed GUID from RFC 6455 section 1.3. */
export const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
export const WS_VERSION = '13'

/** sha1(key + GUID) in base64, the value the client verifies. */
export function computeAcceptKey(clientKey: string): string {
	return createHash('sha1')
		.update(clientKey + WS_GUID, 'utf8')
		.digest('base64')
}

/** A fresh 16 byte, base64 encoded Sec-WebSocket-Key for a client. */
export function createClientKey(): string {
	return randomBytes(16).toString('base64')
}

export type UpgradeCheck =
	| { readonly ok: true; readonly acceptKey: string; readonly path: string }
	| { readonly ok: false; readonly status: number; readonly reason: string }

function headerValue(headers: IncomingHttpHeaders, name: string): string {
	const raw = headers[name]
	if (Array.isArray(raw)) return raw.join(', ')
	return raw ?? ''
}

/** Path without the query string. Relative urls are resolved off a dummy host. */
export function requestPath(url: string | undefined): string {
	return new URL(url ?? '/', 'http://localhost').pathname
}

/**
 * Validates an upgrade request. Returns the accept key on success, or the HTTP
 * status the caller should answer with. Every rejection is a plain HTTP error:
 * the socket is not a websocket yet, so a Kick frame would be meaningless.
 */
export function checkUpgradeRequest(
	req: { method?: string; url?: string; headers: IncomingHttpHeaders },
	expectedPath: string = NET.path,
): UpgradeCheck {
	if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
		return { ok: false, status: 405, reason: 'method not allowed' }
	}
	const path = requestPath(req.url)
	if (path !== expectedPath) {
		return { ok: false, status: 404, reason: 'unknown path' }
	}
	if (headerValue(req.headers, 'upgrade').toLowerCase() !== 'websocket') {
		return { ok: false, status: 400, reason: 'expected upgrade: websocket' }
	}
	if (!headerValue(req.headers, 'connection').toLowerCase().includes('upgrade')) {
		return { ok: false, status: 400, reason: 'expected connection: upgrade' }
	}
	if (headerValue(req.headers, 'sec-websocket-version') !== WS_VERSION) {
		return { ok: false, status: 426, reason: `expected version ${WS_VERSION}` }
	}
	const key = headerValue(req.headers, 'sec-websocket-key')
	// A well formed key is exactly 16 random bytes, base64 encoded.
	if (key === '' || Buffer.from(key, 'base64').length !== 16) {
		return { ok: false, status: 400, reason: 'bad sec-websocket-key' }
	}
	return { ok: true, acceptKey: computeAcceptKey(key), path }
}

/** The 101 response that completes the upgrade. */
export function buildAcceptResponse(acceptKey: string): string {
	return [
		'HTTP/1.1 101 Switching Protocols',
		'Upgrade: websocket',
		'Connection: Upgrade',
		`Sec-WebSocket-Accept: ${acceptKey}`,
		'\r\n',
	].join('\r\n')
}

export function buildRejectResponse(status: number, reason: string): string {
	const body = `${status} ${reason}`
	return [
		`HTTP/1.1 ${status} ${reason}`,
		'Connection: close',
		'Content-Type: text/plain; charset=utf-8',
		`Content-Length: ${Buffer.byteLength(body)}`,
		'',
		body,
	].join('\r\n')
}
