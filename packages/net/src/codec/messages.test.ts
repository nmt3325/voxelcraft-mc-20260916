import {
	NET,
	NET_KICK_REASON,
	type NetBlockChange,
	type NetBlockEdit,
	type NetChunkData,
	type NetEntitySnapshot,
	type NetHello,
	type NetInput,
	type NetSnapshot,
	type NetWelcome,
} from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import {
	assertKickReason,
	decodeBlockChange,
	decodeBlockEdit,
	decodeChat,
	decodeChatBroadcast,
	decodeChunkData,
	decodeEntityRemove,
	decodeHello,
	decodeInput,
	decodeKick,
	decodePing,
	decodePong,
	decodeSnapshot,
	decodeTimeSync,
	decodeWelcome,
	encodeBlockChange,
	encodeBlockEdit,
	encodeChat,
	encodeChatBroadcast,
	encodeChunkData,
	encodeEntityRemove,
	encodeHello,
	encodeInput,
	encodeKick,
	encodePing,
	encodePong,
	encodeSnapshot,
	encodeTimeSync,
	encodeWelcome,
	isCompatible,
} from './messages'

const NAME_UTF8 = 'あいう🙂ザ'

const hello: NetHello = {
	protocolVersion: NET.protocolVersion,
	saveVersion: 1,
	playerName: NAME_UTF8,
}

const welcome: NetWelcome = {
	playerId: 12,
	seed: 4294967295,
	dimension: 1,
	spawn: { x: -128.5, y: 70.25, z: -0.75 },
	tick: 900,
	maxPlayers: NET.maxPlayers,
}

function entityAt(i: number): NetEntitySnapshot {
	return {
		entity: i + 1,
		kind: i % 4,
		x: -i - 0.5,
		y: 64.25,
		z: i + 0.75,
		yaw: -1.25,
		health: 20,
		flags: i & 0xffff,
	}
}

function expectEntityEqual(got: NetEntitySnapshot, want: NetEntitySnapshot): void {
	expect(got.entity).toBe(want.entity)
	expect(got.kind).toBe(want.kind)
	expect(got.flags).toBe(want.flags)
	expect(got.x).toBeCloseTo(want.x, 2)
	expect(got.y).toBeCloseTo(want.y, 2)
	expect(got.z).toBeCloseTo(want.z, 2)
	expect(got.yaw).toBeCloseTo(want.yaw, 2)
	expect(got.health).toBeCloseTo(want.health, 2)
}

describe('client messages', () => {
	it('roundtrips hello with a multi-byte name', () => {
		const decoded = decodeHello(encodeHello(hello))
		expect(decoded.protocolVersion).toBe(hello.protocolVersion)
		expect(decoded.saveVersion).toBe(hello.saveVersion)
		expect(decoded.playerName).toBe(NAME_UTF8)
	})

	it('roundtrips hello with an empty name', () => {
		expect(decodeHello(encodeHello({ ...hello, playerName: '' })).playerName).toBe('')
	})

	it('roundtrips input', () => {
		const msg: NetInput = { tick: 4294967295, bits: 0xffff, yaw: -3.1, pitch: 1.5, hotbar: 8 }
		const decoded = decodeInput(encodeInput(msg))
		expect(decoded.tick).toBe(msg.tick)
		expect(decoded.bits).toBe(msg.bits)
		expect(decoded.hotbar).toBe(msg.hotbar)
		expect(decoded.yaw).toBeCloseTo(msg.yaw, 2)
		expect(decoded.pitch).toBeCloseTo(msg.pitch, 2)
	})

	it('roundtrips a block edit at negative coordinates', () => {
		const msg: NetBlockEdit = { tick: 7, x: -2147483648, y: -1234567, z: -1, block: 0xffff }
		expect(decodeBlockEdit(encodeBlockEdit(msg))).toEqual(msg)
	})

	it('roundtrips chat, including empty text', () => {
		expect(decodeChat(encodeChat({ text: 'hello 🌍 世界' })).text).toBe('hello 🌍 世界')
		expect(decodeChat(encodeChat({ text: '' })).text).toBe('')
	})

	it('roundtrips pong', () => {
		expect(decodePong(encodePong({ nonce: 4294967295 })).nonce).toBe(4294967295)
	})
})

describe('server messages', () => {
	it('roundtrips welcome', () => {
		const decoded = decodeWelcome(encodeWelcome(welcome))
		expect(decoded.playerId).toBe(welcome.playerId)
		expect(decoded.seed).toBe(welcome.seed)
		expect(decoded.dimension).toBe(1)
		expect(decoded.tick).toBe(welcome.tick)
		expect(decoded.maxPlayers).toBe(welcome.maxPlayers)
		expect(decoded.spawn.x).toBeCloseTo(welcome.spawn.x, 2)
		expect(decoded.spawn.y).toBeCloseTo(welcome.spawn.y, 2)
		expect(decoded.spawn.z).toBeCloseTo(welcome.spawn.z, 2)
	})

	for (const count of [0, 1, 300]) {
		it(`roundtrips a snapshot of ${count} entities`, () => {
			const entities = Array.from({ length: count }, (_unused, i) => entityAt(i))
			const msg: NetSnapshot = { tick: 42, dimension: 0, timeOfDay: 18000, entities }
			const decoded = decodeSnapshot(encodeSnapshot(msg))
			expect(decoded.tick).toBe(42)
			expect(decoded.dimension).toBe(0)
			expect(decoded.timeOfDay).toBe(18000)
			expect(decoded.entities.length).toBe(count)
			for (let i = 0; i < count; i++) expectEntityEqual(decoded.entities[i], entities[i])
		})
	}

	it('roundtrips chunk data with its payload', () => {
		const msg: NetChunkData = {
			dimension: 0,
			cx: -7,
			cz: -2147483648,
			bytes: new Uint8Array([1, 2, 3, 250]),
		}
		const decoded = decodeChunkData(encodeChunkData(msg))
		expect(decoded.dimension).toBe(0)
		expect(decoded.cx).toBe(-7)
		expect(decoded.cz).toBe(-2147483648)
		expect(Array.from(decoded.bytes)).toEqual([1, 2, 3, 250])
	})

	it('roundtrips a block change', () => {
		const msg: NetBlockChange = { dimension: 1, x: -5, y: 0, z: -9, block: 12 }
		expect(decodeBlockChange(encodeBlockChange(msg))).toEqual(msg)
	})

	it('roundtrips entity removals', () => {
		expect(decodeEntityRemove(encodeEntityRemove({ entities: [] })).entities).toEqual([])
		const many = [1, 2, 4294967295]
		const decoded = decodeEntityRemove(encodeEntityRemove({ entities: many }))
		expect(decoded.entities).toEqual(many)
	})

	it('roundtrips a chat broadcast', () => {
		const msg = { playerId: 3, name: NAME_UTF8, text: '' }
		expect(decodeChatBroadcast(encodeChatBroadcast(msg))).toEqual(msg)
	})

	it('roundtrips ping and time sync', () => {
		const ping = decodePing(encodePing({ nonce: 9, serverTimeMs: 1761234567890.5 }))
		expect(ping.nonce).toBe(9)
		expect(ping.serverTimeMs).toBe(1761234567890.5)
		const time = { tick: 10, timeOfDay: 23999, serverTimeMs: 1.5 }
		expect(decodeTimeSync(encodeTimeSync(time))).toEqual(time)
	})

	it('roundtrips every kick reason', () => {
		for (const reason of Object.values(NET_KICK_REASON)) {
			expect(decodeKick(encodeKick({ reason })).reason).toBe(reason)
		}
	})
})

describe('protocol compatibility', () => {
	it('accepts this build only', () => {
		expect(isCompatible({ ...hello, protocolVersion: NET.protocolVersion })).toBe(true)
		expect(isCompatible({ ...hello, protocolVersion: NET.protocolVersion + 1 })).toBe(false)
		expect(isCompatible({ ...hello, protocolVersion: 0 })).toBe(false)
	})

	it('narrows kick reasons to the frozen set', () => {
		for (const reason of Object.values(NET_KICK_REASON)) {
			expect(assertKickReason(reason)).toBe(reason)
		}
		expect(() => assertKickReason('nope')).toThrow(/unknown kick reason/)
	})
})

const samples: Array<{
	name: string
	bytes: Uint8Array
	decode: (payload: Uint8Array) => unknown
}> = [
	{ name: 'hello', bytes: encodeHello(hello), decode: decodeHello },
	{
		name: 'hello with an empty name',
		bytes: encodeHello({ ...hello, playerName: '' }),
		decode: decodeHello,
	},
	{
		name: 'input',
		bytes: encodeInput({ tick: 1, bits: 3, yaw: 0.5, pitch: -0.5, hotbar: 1 }),
		decode: decodeInput,
	},
	{
		name: 'blockEdit',
		bytes: encodeBlockEdit({ tick: 1, x: -1, y: -2, z: -3, block: 4 }),
		decode: decodeBlockEdit,
	},
	{ name: 'chat', bytes: encodeChat({ text: 'hi 世界' }), decode: decodeChat },
	{ name: 'pong', bytes: encodePong({ nonce: 1 }), decode: decodePong },
	{ name: 'welcome', bytes: encodeWelcome(welcome), decode: decodeWelcome },
	{
		name: 'snapshot',
		bytes: encodeSnapshot({ tick: 1, dimension: 0, timeOfDay: 2, entities: [entityAt(0)] }),
		decode: decodeSnapshot,
	},
	{
		name: 'chunkData',
		bytes: encodeChunkData({ dimension: 0, cx: -1, cz: 2, bytes: new Uint8Array([9]) }),
		decode: decodeChunkData,
	},
	{
		name: 'blockChange',
		bytes: encodeBlockChange({ dimension: 1, x: -1, y: 2, z: -3, block: 4 }),
		decode: decodeBlockChange,
	},
	{
		name: 'entityRemove',
		bytes: encodeEntityRemove({ entities: [1, 2] }),
		decode: decodeEntityRemove,
	},
	{
		name: 'chatBroadcast',
		bytes: encodeChatBroadcast({ playerId: 1, name: NAME_UTF8, text: 'b' }),
		decode: decodeChatBroadcast,
	},
	{ name: 'ping', bytes: encodePing({ nonce: 1, serverTimeMs: 2 }), decode: decodePing },
	{
		name: 'kick',
		bytes: encodeKick({ reason: NET_KICK_REASON.Shutdown }),
		decode: decodeKick,
	},
	{
		name: 'timeSync',
		bytes: encodeTimeSync({ tick: 1, timeOfDay: 2, serverTimeMs: 3 }),
		decode: decodeTimeSync,
	},
]

for (const sample of samples) {
	describe(`${sample.name} framing`, () => {
		it('rejects a truncated payload', () => {
			const short = sample.bytes.subarray(0, sample.bytes.length - 1)
			expect(() => sample.decode(short)).toThrow()
		})

		it('rejects trailing bytes', () => {
			const padded = new Uint8Array(sample.bytes.length + 1)
			padded.set(sample.bytes)
			expect(() => sample.decode(padded)).toThrow(/trailing/)
		})
	})
}
