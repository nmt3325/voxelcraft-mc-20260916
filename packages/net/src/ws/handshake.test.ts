import type { IncomingHttpHeaders } from 'node:http'
import { NET } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import {
	WS_VERSION,
	buildAcceptResponse,
	buildRejectResponse,
	checkUpgradeRequest,
	computeAcceptKey,
	createClientKey,
	requestPath,
} from './handshake'

/** The worked example from RFC 6455 section 1.3. */
const RFC_KEY = 'dGhlIHNhbXBsZSBub25jZQ=='
const RFC_ACCEPT = 's3pPLMBiTxaQ9kYGzzhZRbK+xOo='

function request(overrides: {
	method?: string
	url?: string
	headers?: IncomingHttpHeaders
}): { method?: string; url?: string; headers: IncomingHttpHeaders } {
	return {
		method: overrides.method ?? 'GET',
		url: overrides.url ?? NET.path,
		headers: {
			upgrade: 'websocket',
			connection: 'Upgrade',
			'sec-websocket-version': WS_VERSION,
			'sec-websocket-key': RFC_KEY,
			...overrides.headers,
		},
	}
}

describe('computeAcceptKey', () => {
	it('matches the RFC 6455 example', () => {
		expect(computeAcceptKey(RFC_KEY)).toBe(RFC_ACCEPT)
	})

	it('creates 16 byte client keys that differ', () => {
		const first = createClientKey()
		expect(Buffer.from(first, 'base64')).toHaveLength(16)
		expect(first).not.toBe(createClientKey())
	})
})

describe('requestPath', () => {
	it('drops the query string and defaults to root', () => {
		expect(requestPath('/ws?token=abc')).toBe('/ws')
		expect(requestPath(undefined)).toBe('/')
	})
})

describe('checkUpgradeRequest', () => {
	it('accepts a well formed upgrade on the frozen path', () => {
		const check = checkUpgradeRequest(request({}))
		expect(check).toEqual({ ok: true, acceptKey: RFC_ACCEPT, path: NET.path })
	})

	it('tolerates a combined connection header and odd casing', () => {
		const check = checkUpgradeRequest(
			request({ headers: { upgrade: 'WebSocket', connection: 'keep-alive, Upgrade' } }),
		)
		expect(check.ok).toBe(true)
	})

	it('ignores the query string when matching the path', () => {
		expect(checkUpgradeRequest(request({ url: `${NET.path}?name=ada` })).ok).toBe(true)
	})

	it('rejects another path with 404', () => {
		expect(checkUpgradeRequest(request({ url: '/socket' }))).toMatchObject({
			ok: false,
			status: 404,
		})
	})

	it('rejects a non GET request with 405', () => {
		expect(checkUpgradeRequest(request({ method: 'POST' }))).toMatchObject({
			ok: false,
			status: 405,
		})
	})

	it('rejects a missing or wrong upgrade header with 400', () => {
		expect(checkUpgradeRequest(request({ headers: { upgrade: undefined } }))).toMatchObject({
			ok: false,
			status: 400,
		})
		expect(checkUpgradeRequest(request({ headers: { connection: 'close' } }))).toMatchObject({
			ok: false,
			status: 400,
		})
	})

	it('rejects an old protocol version with 426', () => {
		expect(
			checkUpgradeRequest(request({ headers: { 'sec-websocket-version': '8' } })),
		).toMatchObject({ ok: false, status: 426 })
	})

	it('rejects a key that is not 16 bytes with 400', () => {
		for (const key of ['', 'c2hvcnQ=']) {
			expect(
				checkUpgradeRequest(request({ headers: { 'sec-websocket-key': key } })),
			).toMatchObject({ ok: false, status: 400 })
		}
	})
})

describe('responses', () => {
	it('completes the handshake with a 101 and a blank line', () => {
		const response = buildAcceptResponse(RFC_ACCEPT)
		expect(response.startsWith('HTTP/1.1 101 Switching Protocols\r\n')).toBe(true)
		expect(response).toContain(`Sec-WebSocket-Accept: ${RFC_ACCEPT}`)
		expect(response.endsWith('\r\n\r\n')).toBe(true)
	})

	it('states an accurate content length when rejecting', () => {
		const response = buildRejectResponse(426, 'expected version 13')
		const body = '426 expected version 13'
		expect(response).toContain(`Content-Length: ${Buffer.byteLength(body)}`)
		expect(response.endsWith(body)).toBe(true)
	})
})
