import type { NetEntitySnapshot } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { ByteReader, ByteWriter } from '../bytes'
import { ENTITY_RECORD_BYTES, readEntity, writeEntity } from './entity'

const sample: NetEntitySnapshot = {
	entity: 4294967295,
	kind: 7,
	x: -1234.5,
	y: -0.25,
	z: 4096.75,
	yaw: -3.14,
	health: 18.5,
	flags: 0xbeef,
}

function encode(entity: NetEntitySnapshot): Uint8Array {
	const w = new ByteWriter(ENTITY_RECORD_BYTES)
	writeEntity(w, entity)
	return w.finish()
}

describe('entity record', () => {
	it('is a fixed 28 bytes', () => {
		expect(ENTITY_RECORD_BYTES).toBe(28)
		expect(encode(sample).length).toBe(ENTITY_RECORD_BYTES)
	})

	it('roundtrips negative coordinates', () => {
		const decoded = readEntity(new ByteReader(encode(sample)))
		expect(decoded.entity).toBe(sample.entity)
		expect(decoded.kind).toBe(sample.kind)
		expect(decoded.flags).toBe(sample.flags)
		expect(decoded.x).toBeCloseTo(sample.x, 2)
		expect(decoded.y).toBeCloseTo(sample.y, 2)
		expect(decoded.z).toBeCloseTo(sample.z, 2)
		expect(decoded.yaw).toBeCloseTo(sample.yaw, 2)
		expect(decoded.health).toBeCloseTo(sample.health, 2)
	})

	it('reads records back to back', () => {
		const w = new ByteWriter(ENTITY_RECORD_BYTES * 3)
		for (let i = 0; i < 3; i++) writeEntity(w, { ...sample, entity: i, x: -i - 0.5 })
		const bytes = w.finish()
		expect(bytes.length).toBe(ENTITY_RECORD_BYTES * 3)
		const r = new ByteReader(bytes)
		for (let i = 0; i < 3; i++) {
			const decoded = readEntity(r)
			expect(decoded.entity).toBe(i)
			expect(decoded.x).toBeCloseTo(-i - 0.5, 2)
		}
		expect(r.remaining).toBe(0)
	})

	it('rejects a truncated record', () => {
		const short = encode(sample).subarray(0, ENTITY_RECORD_BYTES - 1)
		expect(() => readEntity(new ByteReader(short))).toThrow()
	})
})
