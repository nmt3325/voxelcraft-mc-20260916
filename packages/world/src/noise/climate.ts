/**
 * Climate fields. Owned by task world-b.
 *
 * The continent field is sampled through a two-stage domain warp, which is what
 * gives coastlines and mountain chains their non-grid-aligned shape. Erosion
 * uses only the first warp stage, and temperature/humidity are unwarped so that
 * biome belts stay large and readable.
 */
import type { ClimateSample } from '@voxelcraft/core-types'
import { NOISE_FIELDS } from '../internal'
import { fbm2, warp2 } from './fbm'

export function climateAt(seed: number, wx: number, wz: number): ClimateSample {
	const w = NOISE_FIELDS.warp
	const first = warp2(seed, w.saltX, w.saltZ, wx, wz, w.amount, w.frequency)
	const second = warp2(
		seed,
		w.saltX2,
		w.saltZ2,
		first.x,
		first.z,
		w.amount * 0.5,
		w.frequency * 2,
	)
	return {
		continent: fbm2(
			seed,
			NOISE_FIELDS.continent.salt,
			second.x,
			second.z,
			NOISE_FIELDS.continent.fbm,
		),
		erosion: fbm2(seed, NOISE_FIELDS.erosion.salt, first.x, first.z, NOISE_FIELDS.erosion.fbm),
		temperature: fbm2(
			seed,
			NOISE_FIELDS.temperature.salt,
			wx,
			wz,
			NOISE_FIELDS.temperature.fbm,
		),
		humidity: fbm2(seed, NOISE_FIELDS.humidity.salt, wx, wz, NOISE_FIELDS.humidity.fbm),
	}
}
