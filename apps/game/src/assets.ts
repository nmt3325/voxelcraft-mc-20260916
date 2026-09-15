import { fallbackAtlas, loadAtlas, type AtlasSource } from '@voxelcraft/client'
import type { SoundManifest } from '@voxelcraft/core-types'

export interface GameAssets {
	atlas: AtlasSource
	sounds: SoundManifest | null
}

/**
 * Generated assets are produced by `@voxelcraft/assets-gen` and served from the
 * Vite public directory. When they are absent the build flips
 * `__VC_HAS_ASSETS__` to false so nothing is requested at all: a missing file
 * would surface as a console error and break the zero-error E2E assertion.
 */
function hasGeneratedAssets(): boolean {
	return typeof __VC_HAS_ASSETS__ === 'boolean' && __VC_HAS_ASSETS__
}

async function loadSoundManifest(baseUrl: string): Promise<SoundManifest | null> {
	if (typeof fetch !== 'function') return null
	try {
		const response = await fetch(`${baseUrl}sounds.json`)
		if (!response.ok) return null
		const data: unknown = await response.json()
		if (typeof data !== 'object' || data === null) return null
		return data as SoundManifest
	} catch {
		return null
	}
}

/** Never rejects: the procedural fallback atlas keeps the game playable. */
export async function loadGameAssets(baseUrl = './'): Promise<GameAssets> {
	if (!hasGeneratedAssets()) return { atlas: fallbackAtlas(), sounds: null }
	const [atlas, sounds] = await Promise.all([loadAtlas(baseUrl), loadSoundManifest(baseUrl)])
	return { atlas, sounds }
}
