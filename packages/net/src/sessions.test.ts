import { NET, NET_KICK_REASON } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { SessionRegistry, type SessionTransport } from './sessions'

interface FakeTransport extends SessionTransport {
	readonly sent: Uint8Array[]
	readonly closes: string[]
}

function fakeTransport(): FakeTransport {
	const sent: Uint8Array[] = []
	const closes: string[] = []
	return {
		sent,
		closes,
		send(bytes) {
			sent.push(bytes)
		},
		close(reason) {
			closes.push(reason)
		},
	}
}

describe('SessionRegistry', () => {
	it('defaults to the frozen player cap', () => {
		expect(new SessionRegistry().maxPlayers).toBe(NET.maxPlayers)
	})

	it('opens a session as handshaking, with no player slot taken', () => {
		const registry = new SessionRegistry()
		const session = registry.open(fakeTransport(), 0)
		expect(session.stage).toBe('handshaking')
		expect(session.playerId).toBeNull()
		expect(registry.size).toBe(1)
		expect(registry.activeCount).toBe(0)
		expect(registry.get(session.id)).toBe(session)
	})

	it('assigns sequential player ids on activation', () => {
		const registry = new SessionRegistry()
		const first = registry.activate(registry.open(fakeTransport(), 0), 'ada', 0)
		const second = registry.activate(registry.open(fakeTransport(), 0), 'grace', 0)
		expect(first?.playerId).toBe(1)
		expect(second?.playerId).toBe(2)
		expect(registry.activeCount).toBe(2)
		expect(registry.byPlayerId(2)).toBe(second)
		expect(registry.byPlayerId(99)).toBeUndefined()
		expect(first?.name).toBe('ada')
	})

	it('refuses to activate past maxPlayers so the caller can send ServerFull', () => {
		const registry = new SessionRegistry(2)
		registry.activate(registry.open(fakeTransport(), 0), 'a', 0)
		registry.activate(registry.open(fakeTransport(), 0), 'b', 0)
		expect(registry.hasFreeSlot).toBe(false)
		const overflow = registry.open(fakeTransport(), 0)
		expect(registry.activate(overflow, 'c', 0)).toBeNull()
		// The rejected socket is still a session, just never a player.
		expect(overflow.stage).toBe('handshaking')
		expect(registry.size).toBe(3)
	})

	it('frees a slot when an active session closes', () => {
		const registry = new SessionRegistry(1)
		const first = registry.open(fakeTransport(), 0)
		registry.activate(first, 'a', 0)
		registry.close(first, NET_KICK_REASON.Timeout)
		expect(registry.hasFreeSlot).toBe(true)
		const second = registry.open(fakeTransport(), 0)
		expect(registry.activate(second, 'b', 0)?.playerId).toBe(2)
	})

	it('rejects a second activation of the same session', () => {
		const registry = new SessionRegistry()
		const session = registry.open(fakeTransport(), 0)
		registry.activate(session, 'a', 0)
		expect(() => registry.activate(session, 'a', 0)).toThrow(/already active/)
	})

	it('broadcasts only to active sessions and honours the exception', () => {
		const registry = new SessionRegistry()
		const sender = fakeTransport()
		const listener = fakeTransport()
		const silent = fakeTransport()
		const a = registry.activate(registry.open(sender, 0), 'a', 0)
		registry.activate(registry.open(listener, 0), 'b', 0)
		registry.open(silent, 0)

		registry.broadcast(new Uint8Array([1, 2, 3]))
		expect(sender.sent).toHaveLength(1)
		expect(listener.sent).toHaveLength(1)
		expect(silent.sent).toHaveLength(0)

		registry.broadcast(new Uint8Array([4]), a ?? undefined)
		expect(sender.sent).toHaveLength(1)
		expect(listener.sent).toHaveLength(2)
	})

	it('closes once, tells the transport why, and forgets the session', () => {
		const registry = new SessionRegistry()
		const transport = fakeTransport()
		const session = registry.open(transport, 0)
		registry.close(session, NET_KICK_REASON.BadMessage)
		registry.close(session, NET_KICK_REASON.Shutdown)
		expect(transport.closes).toEqual([NET_KICK_REASON.BadMessage])
		expect(session.stage).toBe('closed')
		expect(registry.size).toBe(0)
	})

	it('lists the sessions that went silent for timeoutMs', () => {
		const registry = new SessionRegistry()
		const quiet = registry.open(fakeTransport(), 0)
		const chatty = registry.open(fakeTransport(), 0)
		chatty.heartbeat.markSeen(NET.timeoutMs)
		const stale = registry.timedOut(NET.timeoutMs)
		expect(stale).toHaveLength(1)
		expect(stale[0]).toBe(quiet)
	})

	it('closeAll hangs up on everything with one reason', () => {
		const registry = new SessionRegistry()
		const transports = [fakeTransport(), fakeTransport()]
		for (const transport of transports) registry.open(transport, 0)
		registry.closeAll(NET_KICK_REASON.Shutdown)
		expect(registry.size).toBe(0)
		for (const transport of transports) {
			expect(transport.closes).toEqual([NET_KICK_REASON.Shutdown])
		}
	})
})
