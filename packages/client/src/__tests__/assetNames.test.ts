import { REQUIRED_SOUNDS, REQUIRED_TEXTURES } from '@voxelcraft/assets-gen'
import type { SoundManifest } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { SOUND_EVENT, resolveSoundEvent } from '../audio/events'
import { TEXTURE_COUNT, TEXTURE_NAMES, textureLayer } from '../mesher/textures'

/**
 * The mesher bakes an atlas layer index into every vertex, and
 * `packages/assets-gen` decides which generated tile lands on which layer.
 * Both sides derive that index from a bare texture name, so a rename on either
 * side would silently fall back to the `missing` tile instead of failing.
 * Same story for sound keys and the manifest. These tests fail loudly instead.
 */
describe('generated asset names', () => {
	it('uses exactly the texture names assets-gen generates, in the same order', () => {
		expect([...TEXTURE_NAMES]).toEqual([...REQUIRED_TEXTURES])
		expect(TEXTURE_COUNT).toBe(REQUIRED_TEXTURES.length)
	})

	it('maps every generated texture name to its own layer index', () => {
		REQUIRED_TEXTURES.forEach((name, layer) => {
			expect(textureLayer(name), name).toBe(layer)
		})
	})

	it('resolves every sound event to a sound that is actually generated', () => {
		const events = [
			SOUND_EVENT.PortalTravel,
			SOUND_EVENT.PortalAmbient,
			SOUND_EVENT.EnchantStart,
			SOUND_EVENT.EnchantApply,
			SOUND_EVENT.CropPlant,
			SOUND_EVENT.CropHarvest,
			SOUND_EVENT.ParticlePop,
		]
		// Guards against an event being added to the table but not covered here.
		expect(events.length).toBe(Object.keys(SOUND_EVENT).length)

		const manifest: SoundManifest = {
			sampleRate: 22050,
			files: Object.fromEntries(REQUIRED_SOUNDS.map((name) => [name, `sounds/${name}.wav`])),
		}
		for (const event of events) {
			const name = resolveSoundEvent(manifest, event)
			expect(name, event).not.toBeNull()
			expect(REQUIRED_SOUNDS, event).toContain(name)
		}
	})
})
