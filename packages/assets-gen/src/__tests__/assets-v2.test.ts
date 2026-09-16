/** Covers the v2 asset additions: atlas layout, crop progression and new sounds. */
import { CROP_STAGES } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { buildAtlas } from '../atlas'
import { REQUIRED_SOUNDS, SOUND_SUBDIR, buildSounds } from '../sounds'
import {
	CROP_TEXTURE_CROPS,
	CUTOUT_TEXTURES,
	REQUIRED_TEXTURES,
	TRANSLUCENT_TEXTURES,
	V2_TEXTURES,
	cropStageNames,
} from '../texture-list'
import { SOUND_SAMPLE_RATE } from '../wav'
import { decodePng, tilePixels } from './png-decode'

/**
 * The v1 layer order, pinned here on purpose. packages/client and the older
 * tests index into these slots, so a v2 addition must never move them.
 */
const V1_LAYER_ORDER: readonly string[] = [
	'missing',
	'stone',
	'cobblestone',
	'dirt',
	'grass_top',
	'grass_side',
	'sand',
	'sandstone',
	'gravel',
	'snow',
	'ice',
	'water',
	'lava',
	'bedrock',
	'clay',
	'oak_log',
	'oak_log_top',
	'oak_leaves',
	'birch_log',
	'birch_log_top',
	'birch_leaves',
	'spruce_log',
	'spruce_log_top',
	'spruce_leaves',
	'cactus_side',
	'cactus_top',
	'tall_grass',
	'dead_bush',
	'flower_red',
	'flower_yellow',
	'oak_sapling',
	'coal_ore',
	'iron_ore',
	'gold_ore',
	'diamond_ore',
	'redstone_ore',
	'lapis_ore',
	'planks',
	'glass',
	'crafting_table_top',
	'crafting_table_side',
	'furnace_front',
	'furnace_front_lit',
	'furnace_side',
	'furnace_top',
	'chest_front',
	'chest_side',
	'chest_top',
	'torch',
	'glowstone',
	'door_lower',
	'door_upper',
	'bed_foot',
	'bed_head',
	'redstone_wire',
	'lever',
	'button',
	'pressure_plate',
	'redstone_lamp',
	'redstone_lamp_lit',
	'piston_side',
	'piston_top',
	'piston_head',
	'stone_bricks',
	'bricks',
	'obsidian',
	'snow_layer',
	'iron_block',
	'gold_block',
	'diamond_block',
	'coal_block',
	'wool',
	'ladder',
]

/** Every BLOCK_V2 64..81 face needs a tile. Glowstone is served by its v1 tile. */
const BLOCK_V2_BAND_TEXTURES: readonly string[] = [
	'netherrack',
	'nether_portal',
	'soul_sand',
	'soul_soil',
	'quartz_ore',
	'nether_bricks',
	'magma_block',
	'glowstone',
	'farmland_dry_top',
	'farmland_wet_top',
	'farmland_side',
	'farmland_bottom',
	'enchanting_table_top',
	'enchanting_table_side',
	'enchanting_table_bottom',
	'bookshelf',
	'gravel_path',
	'cobblestone_wall',
	'hay_block_top',
	'hay_block_side',
	'hay_block_bottom',
	'fence',
	'fence_gate',
]

const NEW_SOUNDS: readonly string[] = [
	'portal_travel',
	'enchant',
	'crop_harvest',
	'particle_pop',
	'particle_pop_soft',
]

const built = buildAtlas()
const decoded = decodePng(built.png)
const sounds = buildSounds()

function alphasOf(name: string): number[] {
	const index = built.manifest.layerOf[name]
	const pixels = tilePixels(decoded, index, built.manifest.tilePx, built.manifest.columns)
	return pixels.map((pixel) => pixel[3])
}

/** Painted pixel count plus the highest painted row, used to read crop growth. */
function silhouetteOf(name: string): { count: number; topRow: number } {
	const tilePx = built.manifest.tilePx
	const alphas = alphasOf(name)
	let count = 0
	let topRow = tilePx
	for (let i = 0; i < alphas.length; i++) {
		if (alphas[i] > 0) {
			count += 1
			const row = Math.floor(i / tilePx)
			if (row < topRow) topRow = row
		}
	}
	return { count, topRow }
}

describe('v2 atlas additions', () => {
	it('keeps every v1 layer index unchanged', () => {
		const indices = V1_LAYER_ORDER.map((name) => built.manifest.layerOf[name])
		expect(indices).toEqual(V1_LAYER_ORDER.map((_name, index) => index))
		expect(built.manifest.layers.slice(0, V1_LAYER_ORDER.length)).toEqual([...V1_LAYER_ORDER])
		expect(built.manifest.layerOf.missing).toBe(0)
	})

	it('appends the v2 names after the v1 block with unique layers', () => {
		const actual = V2_TEXTURES.map((name) => built.manifest.layerOf[name])
		expect(actual).toEqual(V2_TEXTURES.map((_name, offset) => V1_LAYER_ORDER.length + offset))
		expect(new Set(actual).size).toBe(V2_TEXTURES.length)
		expect(built.manifest.layers.length).toBe(V1_LAYER_ORDER.length + V2_TEXTURES.length)
		expect(Object.keys(built.manifest.layerOf).length).toBe(REQUIRED_TEXTURES.length)
		expect(built.manifest.layers.length).toBeLessThanOrEqual(
			built.manifest.columns * built.manifest.rows,
		)
		expect(built.manifest.tilePx).toBe(16)
	})

	it('resolves every BLOCK_V2 64..81 face to a layer', () => {
		const unresolved = BLOCK_V2_BAND_TEXTURES.filter(
			(name) => built.manifest.layerOf[name] === undefined,
		)
		expect(unresolved).toEqual([])
		expect(BLOCK_V2_BAND_TEXTURES.filter((name) => !REQUIRED_TEXTURES.includes(name))).toEqual([])
		expect(built.manifest.layerOf.glowstone).toBe(V1_LAYER_ORDER.indexOf('glowstone'))
	})

	it('grows each crop from sprout to ripe over CROP_STAGES tiles', () => {
		for (const crop of CROP_TEXTURE_CROPS) {
			const names = cropStageNames(crop)
			expect(names.length).toBe(CROP_STAGES)
			const stages = names.map((name) => silhouetteOf(name))
			expect(stages.map((stage) => stage.count > 0)).toEqual(names.map(() => true))
			const tops = stages.map((stage) => stage.topRow)
			expect(tops).toEqual([...tops].sort((a, b) => b - a))
			expect(stages[stages.length - 1].count).toBeGreaterThan(stages[0].count)
			expect(stages[stages.length - 1].topRow).toBeLessThan(stages[0].topRow)
		}
	})

	it('keeps the cutout and translucent policies for the new tiles', () => {
		const cutouts = [
			...CROP_TEXTURE_CROPS.flatMap((crop) => [...cropStageNames(crop)]),
			'fence',
			'fence_gate',
		]
		expect(cutouts.filter((name) => !CUTOUT_TEXTURES.includes(name))).toEqual([])
		for (const name of cutouts) {
			const alphas = alphasOf(name)
			expect(alphas.every((alpha) => alpha === 0 || alpha === 255)).toBe(true)
			expect(alphas.includes(0)).toBe(true)
			expect(alphas.includes(255)).toBe(true)
		}
		expect(TRANSLUCENT_TEXTURES.includes('nether_portal')).toBe(true)
		expect(alphasOf('nether_portal').some((alpha) => alpha > 0 && alpha < 255)).toBe(true)
	})

	it('regenerates byte identical atlas output', () => {
		const again = buildAtlas()
		expect(Buffer.from(again.png).equals(Buffer.from(built.png))).toBe(true)
		expect(again.manifest).toEqual(built.manifest)
	})
})

describe('v2 sounds', () => {
	it('registers the new keys in the manifest at the shared sample rate', () => {
		expect(sounds.manifest.sampleRate).toBe(SOUND_SAMPLE_RATE)
		expect(NEW_SOUNDS.filter((name) => !REQUIRED_SOUNDS.includes(name))).toEqual([])
		expect(NEW_SOUNDS.map((name) => sounds.manifest.files[name])).toEqual(
			NEW_SOUNDS.map((name) => `${SOUND_SUBDIR}/${name}.wav`),
		)
	})

	it('renders valid non silent 16 bit mono wav data', () => {
		for (const name of NEW_SOUNDS) {
			const wav = sounds.wavs[name]
			expect(wav instanceof Uint8Array).toBe(true)
			const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
			expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF')
			expect(String.fromCharCode(...wav.subarray(8, 12))).toBe('WAVE')
			expect(view.getUint16(22, true)).toBe(1)
			expect(view.getUint32(24, true)).toBe(SOUND_SAMPLE_RATE)
			expect(view.getUint16(34, true)).toBe(16)
			expect(view.getUint32(40, true)).toBe(wav.length - 44)
			let peak = 0
			for (let at = 44; at + 1 < wav.length; at += 2) {
				const sample = Math.abs(view.getInt16(at, true))
				if (sample > peak) peak = sample
			}
			expect(peak).toBeGreaterThan(8000)
		}
	})

	it('renders byte identical audio on a second build', () => {
		const again = buildSounds()
		for (const name of NEW_SOUNDS) {
			expect(Buffer.from(again.wavs[name]).equals(Buffer.from(sounds.wavs[name]))).toBe(true)
		}
	})
})
