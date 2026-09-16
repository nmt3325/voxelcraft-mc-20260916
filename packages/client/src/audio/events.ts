import type { SoundManifest } from '@voxelcraft/core-types'

/**
 * Semantic sound events for the v2 systems: nether portals, enchanting,
 * farming and particle bursts.
 *
 * `@voxelcraft/assets-gen` owns the generated file names, so gameplay code
 * raises an event and this layer resolves it against the loaded manifest. Every
 * candidate list ends with a v1 sound that is always generated, so a missing v2
 * asset degrades to a related cue instead of silence, and nothing here throws or
 * logs: the e2e suite asserts zero console errors and warnings.
 */
export const SOUND_EVENT = {
	PortalTravel: 'portalTravel',
	PortalAmbient: 'portalAmbient',
	EnchantStart: 'enchantStart',
	EnchantApply: 'enchantApply',
	CropPlant: 'cropPlant',
	CropHarvest: 'cropHarvest',
	ParticlePop: 'particlePop',
} as const

export type SoundEvent = (typeof SOUND_EVENT)[keyof typeof SOUND_EVENT]

/** Manifest keys per event, most specific first. */
export const SOUND_EVENT_CANDIDATES: Readonly<Record<SoundEvent, readonly string[]>> = {
	[SOUND_EVENT.PortalTravel]: ['portal_travel', 'portal_trigger', 'portal', 'splash'],
	[SOUND_EVENT.PortalAmbient]: ['portal_ambient', 'portal_loop', 'portal', 'splash'],
	[SOUND_EVENT.EnchantStart]: ['enchant_start', 'enchant', 'enchanting_table', 'ui_click'],
	[SOUND_EVENT.EnchantApply]: ['enchant_apply', 'enchant_done', 'enchant', 'ui_click'],
	[SOUND_EVENT.CropPlant]: ['crop_plant', 'plant_seed', 'place_generic'],
	[SOUND_EVENT.CropHarvest]: ['crop_harvest', 'harvest', 'dig_plant'],
	[SOUND_EVENT.ParticlePop]: ['particle_pop', 'pop'],
}

/** Minimum gap between two plays of the same event, in milliseconds. */
export const SOUND_EVENT_MIN_INTERVAL_MS: Readonly<Record<SoundEvent, number>> = {
	[SOUND_EVENT.PortalTravel]: 400,
	[SOUND_EVENT.PortalAmbient]: 1200,
	[SOUND_EVENT.EnchantStart]: 200,
	[SOUND_EVENT.EnchantApply]: 200,
	[SOUND_EVENT.CropPlant]: 80,
	[SOUND_EVENT.CropHarvest]: 80,
	[SOUND_EVENT.ParticlePop]: 60,
}

export interface SoundEventPlayOptions {
	volume?: number
	pitch?: number
}

/** Structural subset of `AudioHandle`, declared here to avoid an import cycle. */
export interface SoundEventSink {
	play(name: string, opts?: SoundEventPlayOptions): void
}

export interface SoundEventPlayer {
	play(event: SoundEvent, opts?: SoundEventPlayOptions): void
	keyFor(event: SoundEvent): string | null
	resolved(): Readonly<Record<SoundEvent, string | null>>
}

export interface CreateSoundEventsOptions {
	audio: SoundEventSink | null
	manifest: SoundManifest | null
	/** Injectable clock so the throttle is testable without timers. */
	now?: () => number
}

/** First candidate key the manifest actually carries, or null. */
export function resolveSoundEvent(
	manifest: SoundManifest | null,
	event: SoundEvent,
): string | null {
	if (manifest === null) return null
	for (const candidate of SOUND_EVENT_CANDIDATES[event]) {
		const file = manifest.files[candidate]
		if (typeof file === 'string' && file.length > 0) return candidate
	}
	return null
}

/**
 * Binds semantic events to an audio handle once, so the per-frame path is a map
 * lookup plus a throttle check rather than a manifest scan.
 */
export function createSoundEvents(options: CreateSoundEventsOptions): SoundEventPlayer {
	const clock = options.now ?? ((): number => Date.now())
	const keys = new Map<SoundEvent, string | null>()
	const lastPlayedAt = new Map<SoundEvent, number>()
	for (const event of Object.values(SOUND_EVENT)) {
		keys.set(event, resolveSoundEvent(options.manifest, event))
	}

	return {
		play(event: SoundEvent, opts?: SoundEventPlayOptions): void {
			const audio = options.audio
			if (audio === null) return
			const key = keys.get(event) ?? null
			if (key === null) return
			const at = clock()
			if (!Number.isFinite(at)) return
			const previous = lastPlayedAt.get(event)
			if (previous !== undefined && at - previous < SOUND_EVENT_MIN_INTERVAL_MS[event]) return
			lastPlayedAt.set(event, at)
			audio.play(key, opts)
		},
		keyFor(event: SoundEvent): string | null {
			return keys.get(event) ?? null
		},
		resolved(): Readonly<Record<SoundEvent, string | null>> {
			const out = {} as Record<SoundEvent, string | null>
			for (const event of Object.values(SOUND_EVENT)) out[event] = keys.get(event) ?? null
			return out
		},
	}
}
