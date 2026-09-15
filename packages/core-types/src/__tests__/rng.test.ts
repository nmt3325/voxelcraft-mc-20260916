import { describe, expect, it } from 'vitest'
import { hash01, hashBuffer, hashU32, makeRng, splitmix32 } from '../rng'

describe('deterministic rng', () => {
	it('hashU32 is pure and stable for the same inputs', () => {
		const a = hashU32(1234, 7, 10, 20, 30)
		const b = hashU32(1234, 7, 10, 20, 30)
		expect(a).toBe(b)
		expect(a).toBeGreaterThanOrEqual(0)
		expect(a).toBeLessThanOrEqual(0xffffffff)
		expect(Number.isInteger(a)).toBe(true)
	})

	it('hashU32 separates salts and coordinates', () => {
		expect(hashU32(1, 1)).not.toBe(hashU32(1, 2))
		expect(hashU32(1, 1, 5)).not.toBe(hashU32(1, 1, 6))
		expect(hashU32(1, 1, 0, 5)).not.toBe(hashU32(1, 1, 0, 6))
		expect(hashU32(1, 1, 0, 0, 5)).not.toBe(hashU32(1, 1, 0, 0, 6))
	})

	it('hashU32 does not depend on evaluation order', () => {
		const forward: number[] = []
		for (let i = 0; i < 64; i++) forward.push(hashU32(99, 3, i, 0, 0))
		const backward: number[] = []
		for (let i = 63; i >= 0; i--) backward.unshift(hashU32(99, 3, i, 0, 0))
		expect(backward).toEqual(forward)
	})

	it('hash01 stays inside [0, 1)', () => {
		for (let i = 0; i < 512; i++) {
			const v = hash01(42, 1, i, i * 3, i * 7)
			expect(v).toBeGreaterThanOrEqual(0)
			expect(v).toBeLessThan(1)
		}
	})

	it('splitmix32 produces a stable stream per seed', () => {
		const first = splitmix32(7)
		const second = splitmix32(7)
		for (let i = 0; i < 16; i++) expect(first()).toBe(second())
	})

	it('makeRng replays identically for identical salts', () => {
		const a = makeRng(20260916, 1, 2, 3)
		const b = makeRng(20260916, 1, 2, 3)
		const seqA = Array.from({ length: 32 }, () => a.nextU32())
		const seqB = Array.from({ length: 32 }, () => b.nextU32())
		expect(seqA).toEqual(seqB)
	})

	it('makeRng diverges for different salts', () => {
		const a = makeRng(1, 1)
		const b = makeRng(1, 2)
		expect(a.nextU32()).not.toBe(b.nextU32())
	})

	it('nextInt stays in range and next01 in [0, 1)', () => {
		const rng = makeRng(5, 5)
		for (let i = 0; i < 256; i++) {
			const n = rng.nextInt(17)
			expect(n).toBeGreaterThanOrEqual(0)
			expect(n).toBeLessThan(17)
			const f = rng.next01()
			expect(f).toBeGreaterThanOrEqual(0)
			expect(f).toBeLessThan(1)
		}
		expect(rng.nextInt(0)).toBe(0)
	})

	it('fork is independent of how far the parent advanced', () => {
		const parentA = makeRng(11, 11)
		const childA = parentA.fork(3).nextU32()
		const parentB = makeRng(11, 11)
		for (let i = 0; i < 10; i++) parentB.nextU32()
		const childB = parentB.fork(3).nextU32()
		expect(childA).toBe(childB)
	})

	it('hashBuffer detects a single changed voxel', () => {
		const buf = new Uint16Array(256)
		for (let i = 0; i < buf.length; i++) buf[i] = i & 0xff
		const before = hashBuffer(buf)
		expect(hashBuffer(buf)).toBe(before)
		buf[128] = 4096
		expect(hashBuffer(buf)).not.toBe(before)
	})
})
