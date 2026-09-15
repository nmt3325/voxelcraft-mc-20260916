/**
 * Deterministic randomness. Owned by core-types so world and sim cannot drift.
 *
 * Rules:
 *  - Never use Math.random, Date.now or Math.sin/cos in generation or simulation.
 *  - Prefer the pure coordinate hashes: their result never depends on call order,
 *    which is what keeps Worker parallel generation reproducible.
 *  - Stream RNGs are only for a local, fixed iteration order, created per use
 *    with makeRng(seed, salt, cx, cz).
 */

function mixStep(h: number, v: number): number {
	let x = (h ^ (v >>> 0)) >>> 0
	x = Math.imul(x, 0x85ebca6b) >>> 0
	x = ((x << 13) | (x >>> 19)) >>> 0
	return x
}

function finalize(h: number): number {
	let x = h >>> 0
	x = (x ^ (x >>> 16)) >>> 0
	x = Math.imul(x, 0x85ebca6b) >>> 0
	x = (x ^ (x >>> 13)) >>> 0
	x = Math.imul(x, 0xc2b2ae35) >>> 0
	x = (x ^ (x >>> 16)) >>> 0
	return x >>> 0
}

/** Pure 32 bit hash of a seed, a salt and up to three coordinates. */
export function hashU32(
	seed: number,
	salt: number,
	x = 0,
	y = 0,
	z = 0,
): number {
	let h = (seed ^ 0x9e3779b9) >>> 0
	h = mixStep(h, salt)
	h = mixStep(h, x | 0)
	h = mixStep(h, y | 0)
	h = mixStep(h, z | 0)
	return finalize(h)
}

/** Same as hashU32 mapped to [0, 1). */
export function hash01(seed: number, salt: number, x = 0, y = 0, z = 0): number {
	return hashU32(seed, salt, x, y, z) / 4294967296
}

/** splitmix32 stream. Used to expand a seed into RNG state. */
export function splitmix32(seed: number): () => number {
	let a = seed >>> 0
	return function next(): number {
		a = (a + 0x9e3779b9) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), 0x85ebca6b) >>> 0
		t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35) >>> 0
		return (t ^ (t >>> 16)) >>> 0
	}
}

export interface Rng {
	nextU32(): number
	next01(): number
	nextInt(maxExclusive: number): number
	/** Deterministic child stream, independent of how far this one advanced. */
	fork(salt: number): Rng
}

function rotl(x: number, k: number): number {
	return ((x << k) | (x >>> (32 - k))) >>> 0
}

/** xoshiro128** seeded through splitmix32. */
export function makeRng(seed: number, ...salts: readonly number[]): Rng {
	let key = seed >>> 0
	for (const s of salts) key = hashU32(key, s >>> 0)
	const seedStream = splitmix32(key)
	let s0 = seedStream()
	let s1 = seedStream()
	let s2 = seedStream()
	let s3 = seedStream()
	if ((s0 | s1 | s2 | s3) === 0) s0 = 1
	const rng: Rng = {
		nextU32(): number {
			const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0
			const t = (s1 << 9) >>> 0
			s2 = (s2 ^ s0) >>> 0
			s3 = (s3 ^ s1) >>> 0
			s1 = (s1 ^ s2) >>> 0
			s0 = (s0 ^ s3) >>> 0
			s2 = (s2 ^ t) >>> 0
			s3 = rotl(s3, 11)
			return result
		},
		next01(): number {
			return rng.nextU32() / 4294967296
		},
		nextInt(maxExclusive: number): number {
			if (maxExclusive <= 0) return 0
			return rng.nextU32() % maxExclusive
		},
		fork(salt: number): Rng {
			return makeRng(key, salt)
		},
	}
	return rng
}

/** FNV-1a over a typed array. Used by golden/determinism tests. */
export function hashBuffer(data: Uint8Array | Uint16Array): number {
	let h = 0x811c9dc5 >>> 0
	for (let i = 0; i < data.length; i++) {
		h = (h ^ (data[i] & 0xff)) >>> 0
		h = Math.imul(h, 0x01000193) >>> 0
		if (data[i] > 0xff) {
			h = (h ^ (data[i] >>> 8)) >>> 0
			h = Math.imul(h, 0x01000193) >>> 0
		}
	}
	return h >>> 0
}
