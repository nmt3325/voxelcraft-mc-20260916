/**
 * Server side session registry.
 *
 * A socket becomes a session as soon as it connects, but it only becomes a
 * player once its Hello is accepted. Keeping the two stages apart is what lets
 * the server enforce NET.maxPlayers with the frozen ServerFull reason instead
 * of refusing the TCP connection, and it keeps half-open sockets from taking a
 * player slot.
 *
 * Transport agnostic on purpose: the websocket layer injects a SessionTransport
 * so the registry can be unit tested without a socket.
 */
import { NET, NET_KICK_REASON, type EntityId, type NetKickReason } from '@voxelcraft/core-types'
import { Heartbeat } from './heartbeat'

export type SessionStage = 'handshaking' | 'active' | 'closed'

export interface SessionTransport {
	send(bytes: Uint8Array): void
	/** Flush a kick and hang up. Must tolerate being called twice. */
	close(reason: NetKickReason): void
	readonly remote?: string
}

export interface Session {
	readonly id: number
	readonly transport: SessionTransport
	readonly heartbeat: Heartbeat
	stage: SessionStage
	/** Assigned by activate(); null while still handshaking. */
	playerId: EntityId | null
	name: string
	/** Highest client tick accepted from this session. */
	lastTick: number
}

export class SessionRegistry {
	readonly maxPlayers: number
	private readonly sessions = new Map<number, Session>()
	private nextSessionId = 1
	private nextPlayerId = 1

	constructor(maxPlayers: number = NET.maxPlayers) {
		this.maxPlayers = maxPlayers
	}

	/** Every session, including the ones that have not said Hello yet. */
	get size(): number {
		return this.sessions.size
	}

	get activeCount(): number {
		let n = 0
		for (const session of this.sessions.values()) if (session.stage === 'active') n++
		return n
	}

	get hasFreeSlot(): boolean {
		return this.activeCount < this.maxPlayers
	}

	open(transport: SessionTransport, nowMs: number): Session {
		const session: Session = {
			id: this.nextSessionId++,
			transport,
			heartbeat: new Heartbeat(nowMs),
			stage: 'handshaking',
			playerId: null,
			name: '',
			lastTick: 0,
		}
		this.sessions.set(session.id, session)
		return session
	}

	/**
	 * Promotes a handshaking session to a player. Returns null when the server is
	 * already full, which the caller answers with NET_KICK_REASON.ServerFull.
	 */
	activate(session: Session, name: string, nowMs: number): Session | null {
		if (session.stage !== 'handshaking') {
			throw new Error(`net: session ${session.id} already ${session.stage}`)
		}
		if (!this.hasFreeSlot) return null
		session.stage = 'active'
		session.playerId = this.nextPlayerId++
		session.name = name
		session.heartbeat.markSeen(nowMs)
		return session
	}

	get(id: number): Session | undefined {
		return this.sessions.get(id)
	}

	byPlayerId(playerId: EntityId): Session | undefined {
		for (const session of this.sessions.values()) {
			if (session.playerId === playerId) return session
		}
		return undefined
	}

	all(): Session[] {
		return [...this.sessions.values()]
	}

	active(): Session[] {
		return this.all().filter((session) => session.stage === 'active')
	}

	/** Sessions that have sent nothing for NET.timeoutMs. */
	timedOut(nowMs: number): Session[] {
		return this.all().filter((session) => session.heartbeat.isTimedOut(nowMs))
	}

	/** Idempotent: closing an already closed session is a no-op. */
	close(session: Session, reason: NetKickReason = NET_KICK_REASON.Shutdown): void {
		if (!this.sessions.has(session.id)) return
		this.sessions.delete(session.id)
		session.stage = 'closed'
		session.transport.close(reason)
	}

	closeAll(reason: NetKickReason = NET_KICK_REASON.Shutdown): void {
		for (const session of this.all()) this.close(session, reason)
	}

	/** Sends to every active session, optionally skipping the originator. */
	broadcast(bytes: Uint8Array, except?: Session): void {
		for (const session of this.sessions.values()) {
			if (session.stage !== 'active') continue
			if (except !== undefined && session.id === except.id) continue
			session.transport.send(bytes)
		}
	}
}
