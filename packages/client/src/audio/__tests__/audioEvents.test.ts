import { describe, expect, it, vi } from 'vitest'
import {
	SOUND_EVENT,
	SOUND_EVENT_CANDIDATES,
	SOUND_EVENT_MIN_INTERVAL_MS,
	createSoundEvents,
	resolveSoundEvent,
} from '../events'

/** Sounds @voxelcraft/assets-gen already generated before the v2 scope. */
const V1_SOUNDS = ['place_generic', 'dig_plant', 'ui_click', 'pop', 'splash']

function manifestOf(names: readonly string[]): {
	sampleRate: number
	files: Record<string, string>
} {
	const files: Record<string, string> = {}
	for (const name of names) files[name] = `sounds/${name}.wav`
	return { sampleRate: 22050, files }
}

describe('sound event resolution', () => {
	it('prefers the v2 key when assets-gen generated it', () => {
		const manifest = manifestOf([...V1_SOUNDS, 'portal_travel', 'crop_harvest', 'particle_pop'])
		expect(resolveSoundEvent(manifest, SOUND_EVENT.PortalTravel)).toBe('portal_travel')
		expect(resolveSoundEvent(manifest, SOUND_EVENT.CropHarvest)).toBe('crop_harvest')
		expect(resolveSoundEvent(manifest, SOUND_EVENT.ParticlePop)).toBe('particle_pop')
	})

	it('falls back to a v1 sound when the v2 asset is missing', () => {
		const manifest = manifestOf(V1_SOUNDS)
		expect(resolveSoundEvent(manifest, SOUND_EVENT.CropPlant)).toBe('place_generic')
		expect(resolveSoundEvent(manifest, SOUND_EVENT.CropHarvest)).toBe('dig_plant')
		expect(resolveSoundEvent(manifest, SOUND_EVENT.ParticlePop)).toBe('pop')
		expect(resolveSoundEvent(manifest, SOUND_EVENT.EnchantStart)).toBe('ui_click')
		expect(resolveSoundEvent(manifest, SOUND_EVENT.PortalTravel)).toBe('splash')
	})

	it('ends every candidate list with a sound that always exists', () => {
		for (const [event, candidates] of Object.entries(SOUND_EVENT_CANDIDATES)) {
			expect(candidates.length, event).toBeGreaterThan(0)
			expect(V1_SOUNDS, event).toContain(candidates[candidates.length - 1] ?? '')
		}
	})

	it('returns null without a manifest or a matching key', () => {
		expect(resolveSoundEvent(null, SOUND_EVENT.PortalTravel)).toBeNull()
		expect(resolveSoundEvent(manifestOf([]), SOUND_EVENT.PortalTravel)).toBeNull()
	})
})

describe('sound event player', () => {
	it('plays the resolved key and throttles repeats of the same event', () => {
		const play = vi.fn()
		let now = 1000
		const events = createSoundEvents({
			audio: { play },
			manifest: manifestOf([...V1_SOUNDS, 'particle_pop']),
			now: () => now,
		})

		expect(events.keyFor(SOUND_EVENT.ParticlePop)).toBe('particle_pop')
		events.play(SOUND_EVENT.ParticlePop)
		events.play(SOUND_EVENT.ParticlePop)
		expect(play).toHaveBeenCalledTimes(1)

		now += SOUND_EVENT_MIN_INTERVAL_MS[SOUND_EVENT.ParticlePop]
		events.play(SOUND_EVENT.ParticlePop, { volume: 0.4 })
		expect(play).toHaveBeenCalledTimes(2)
		expect(play).toHaveBeenLastCalledWith('particle_pop', { volume: 0.4 })
	})

	it('throttles each event independently', () => {
		const play = vi.fn()
		const events = createSoundEvents({
			audio: { play },
			manifest: manifestOf(V1_SOUNDS),
			now: () => 0,
		})
		events.play(SOUND_EVENT.CropPlant)
		events.play(SOUND_EVENT.CropHarvest)
		events.play(SOUND_EVENT.CropPlant)
		expect(play).toHaveBeenCalledTimes(2)
	})

	it('stays silent without audio, without a manifest or without assets', () => {
		const play = vi.fn()
		const headless = createSoundEvents({ audio: null, manifest: manifestOf(V1_SOUNDS) })
		expect(() => headless.play(SOUND_EVENT.CropPlant)).not.toThrow()

		const noAssets = createSoundEvents({ audio: { play }, manifest: manifestOf([]) })
		noAssets.play(SOUND_EVENT.PortalTravel)
		const noManifest = createSoundEvents({ audio: { play }, manifest: null })
		noManifest.play(SOUND_EVENT.PortalTravel)

		expect(play).not.toHaveBeenCalled()
		expect(noManifest.keyFor(SOUND_EVENT.PortalTravel)).toBeNull()
	})

	it('reports a resolution for every event', () => {
		const events = createSoundEvents({
			audio: null,
			manifest: manifestOf([...V1_SOUNDS, 'portal_travel']),
		})
		const resolved = events.resolved()
		expect(Object.keys(resolved).sort()).toEqual([...Object.values(SOUND_EVENT)].sort())
		expect(resolved[SOUND_EVENT.PortalTravel]).toBe('portal_travel')
		expect(resolved[SOUND_EVENT.EnchantApply]).toBe('ui_click')
	})
})
