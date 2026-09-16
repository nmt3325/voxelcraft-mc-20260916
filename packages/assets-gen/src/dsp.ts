/**
 * Deterministic DSP helpers for the procedural sound effects.
 * Math.sin / exp / pow are not IEEE exact across engines, so the oscillator is a
 * polynomial and the envelopes are plain multiplications. Noise comes from the
 * core-types hash RNG: no Math.random, no Date.
 */
import { makeRng } from '@voxelcraft/core-types'

const PI = 3.141592653589793
export const TWO_PI = 6.283185307179586

/** sin() by range reduction plus the Taylor series up to x^11 (error < 1e-9). */
export function sinApprox(x: number): number {
	let t = x - TWO_PI * Math.floor(x / TWO_PI + 0.5)
	if (t > PI / 2) t = PI - t
	else if (t < -PI / 2) t = -PI - t
	const s = t * t
	return t * (1 - s * (1 / 6 - s * (1 / 120 - s * (1 / 5040 - s * (1 / 362880 - s / 39916800)))))
}

/** White noise in [-1, 1) from the shared hash RNG. */
export function makeNoise(seed: number, salt: number): () => number {
	const rng = makeRng(seed, salt)
	return () => rng.next01() * 2 - 1
}

export function lowpassInPlace(buffer: Float32Array, alpha: number): void {
	let y = 0
	for (let i = 0; i < buffer.length; i++) {
		y += alpha * (buffer[i] - y)
		buffer[i] = y
	}
}

export function highpassInPlace(buffer: Float32Array, alpha: number): void {
	let y = 0
	for (let i = 0; i < buffer.length; i++) {
		const x = buffer[i]
		y += alpha * (x - y)
		buffer[i] = x - y
	}
}

/** Per sample multiplier for a decay with the given time constant in samples. */
export function decayFactor(tauSamples: number): number {
	return tauSamples > 1 ? 1 - 1 / tauSamples : 0
}

export function normalizePeak(buffer: Float32Array, target: number): void {
	let peak = 0
	for (let i = 0; i < buffer.length; i++) {
		const a = buffer[i] < 0 ? -buffer[i] : buffer[i]
		if (a > peak) peak = a
	}
	if (peak <= 0) return
	const gain = target / peak
	for (let i = 0; i < buffer.length; i++) buffer[i] *= gain
}

/** Linear edge fades so the one shots never click. */
export function applyEdgeFades(buffer: Float32Array, inSamples: number, outSamples: number): void {
	const n = buffer.length
	for (let i = 0; i < inSamples && i < n; i++) buffer[i] *= (i + 1) / (inSamples + 1)
	for (let i = 0; i < outSamples && i < n; i++) buffer[n - 1 - i] *= (i + 1) / (outSamples + 1)
}
