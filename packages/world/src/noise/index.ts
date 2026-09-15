/**
 * Noise basis factory. Owned by task world-b.
 *
 * createNoiseBasis binds a seed once and exposes the primitives the terrain and
 * feature layers consume through the NoiseBasis seam in `src/internal.ts`.
 */
import type { CreateNoiseBasis, NoiseBasis } from '../internal'
import { climateAt } from './climate'
import { clamp1, fbm2, fbm3, ridged2, warp2 } from './fbm'
import { perlin2, perlin3 } from './perlin'

export const createNoiseBasis: CreateNoiseBasis = (seed: number): NoiseBasis => {
	const s = seed >>> 0
	return {
		seed: s,
		perlin2: (salt, x, z) => perlin2(s, salt, x, z),
		perlin3: (salt, x, y, z) => perlin3(s, salt, x, y, z),
		fbm2: (salt, x, z, opts) => fbm2(s, salt, x, z, opts),
		fbm3: (salt, x, y, z, opts) => fbm3(s, salt, x, y, z, opts),
		ridged2: (salt, x, z, opts) => ridged2(s, salt, x, z, opts),
		warp2: (saltX, saltZ, x, z, amount, frequency) =>
			warp2(s, saltX, saltZ, x, z, amount, frequency),
		climateAt: (wx, wz) => climateAt(s, wx, wz),
	}
}

export { clamp1, climateAt, fbm2, fbm3, perlin2, perlin3, ridged2, warp2 }
