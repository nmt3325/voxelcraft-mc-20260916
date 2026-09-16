import { BLOCK_V2, RENDER_LAYER } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { appearanceOf, isOpaqueId, isRenderable } from '../mesher/appearance'
import { TEXTURE_NAMES, textureLayer } from '../mesher/textures'

/**
 * The v2 band (BLOCK_V2 64..81) must be fully renderable, and appending its
 * tiles must never shift a v1 texture layer: the mesher bakes those indices
 * into the vertex stream and the byte-determinism test depends on them.
 */

const V2_IDS = Object.entries(BLOCK_V2) as ReadonlyArray<readonly [string, number]>
const MISSING_LAYER = 0
const FACE_NEG_X = 0
const FACE_NEG_Y = 2
const FACE_POS_Y = 3

describe('v2 block appearances', () => {
	it('covers every BLOCK_V2 id with renderable geometry and real tiles', () => {
		expect(V2_IDS.length).toBe(18)
		for (const [name, id] of V2_IDS) {
			const appearance = appearanceOf(id)
			expect(appearance, name).not.toBeNull()
			if (appearance === null) continue
			expect(appearance.fullCube || appearance.cross, name).toBe(true)
			expect(isRenderable(id), name).toBe(true)
			for (const face of appearance.faces) {
				expect(face, `${name} face tile`).not.toBe(MISSING_LAYER)
			}
		}
	})

	it('keeps the v1 texture layer indices stable', () => {
		expect(TEXTURE_NAMES[0]).toBe('missing')
		expect(textureLayer('stone')).toBe(1)
		expect(textureLayer('ladder')).toBe(72)
		for (const name of ['netherrack', 'fence_gate', 'wheat_stage_0', 'hay_block_top']) {
			expect(textureLayer(name), name).toBeGreaterThan(72)
		}
	})

	it('has no duplicate texture names', () => {
		expect(new Set(TEXTURE_NAMES).size).toBe(TEXTURE_NAMES.length)
	})

	it('registers a unique tile for all 8 stages of all 3 crops', () => {
		const layers = new Set<number>()
		for (const crop of ['wheat', 'carrot', 'potato']) {
			for (let stage = 0; stage < 8; stage++) {
				const name = `${crop}_stage_${stage}`
				const layer = textureLayer(name)
				expect(layer, name).not.toBe(MISSING_LAYER)
				layers.add(layer)
			}
		}
		expect(layers.size).toBe(24)
	})

	it('draws crops as distinct cutout crosses', () => {
		const crops = [BLOCK_V2.WHEAT_CROP, BLOCK_V2.CARROT_CROP, BLOCK_V2.POTATO_CROP]
		const tiles = new Set<number>()
		for (const id of crops) {
			const appearance = appearanceOf(id)
			expect(appearance).not.toBeNull()
			expect(appearance?.cross).toBe(true)
			expect(appearance?.fullCube).toBe(false)
			expect(appearance?.layer).toBe(RENDER_LAYER.Cutout)
			expect(isOpaqueId(id)).toBe(false)
			tiles.add(appearance?.faces[FACE_NEG_X] ?? MISSING_LAYER)
		}
		expect(tiles.size).toBe(3)
	})

	it('renders the nether portal as an emissive self-culling translucent block', () => {
		const portal = appearanceOf(BLOCK_V2.NETHER_PORTAL)
		expect(portal).not.toBeNull()
		expect(portal?.layer).toBe(RENDER_LAYER.Translucent)
		expect(portal?.opaqueCube).toBe(false)
		expect(portal?.selfCull).toBe(true)
		expect(portal?.emission).toBe(11)
		expect(isOpaqueId(BLOCK_V2.NETHER_PORTAL)).toBe(false)
	})

	it('keeps fences, gates and walls non-occluding cutouts', () => {
		for (const id of [BLOCK_V2.FENCE, BLOCK_V2.FENCE_GATE, BLOCK_V2.COBBLESTONE_WALL]) {
			expect(appearanceOf(id)?.layer).toBe(RENDER_LAYER.Cutout)
			expect(appearanceOf(id)?.opaqueCube).toBe(false)
			expect(isOpaqueId(id)).toBe(false)
		}
	})

	it('gives farmland a wet and a dry top over shared side tiles', () => {
		const side = textureLayer('farmland_side')
		const bottom = textureLayer('farmland_bottom')
		const dry = appearanceOf(BLOCK_V2.FARMLAND)
		const wet = appearanceOf(BLOCK_V2.FARMLAND_WET)
		expect(dry?.faces[FACE_POS_Y]).toBe(textureLayer('farmland_dry_top'))
		expect(wet?.faces[FACE_POS_Y]).toBe(textureLayer('farmland_wet_top'))
		expect(dry?.faces[FACE_POS_Y]).not.toBe(wet?.faces[FACE_POS_Y])
		expect(dry?.faces[FACE_NEG_X]).toBe(side)
		expect(wet?.faces[FACE_NEG_X]).toBe(side)
		expect(dry?.faces[FACE_NEG_Y]).toBe(bottom)
		expect(wet?.faces[FACE_NEG_Y]).toBe(bottom)
		expect(isOpaqueId(BLOCK_V2.FARMLAND)).toBe(true)
	})

	it('gives multi-face v2 blocks different top and side tiles', () => {
		const hay = appearanceOf(BLOCK_V2.HAY_BLOCK)
		expect(hay?.faces[FACE_POS_Y]).toBe(textureLayer('hay_block_top'))
		expect(hay?.faces[FACE_NEG_X]).toBe(textureLayer('hay_block_side'))
		expect(hay?.faces[FACE_NEG_Y]).toBe(textureLayer('hay_block_bottom'))
		expect(hay?.faces[FACE_POS_Y]).not.toBe(hay?.faces[FACE_NEG_X])
		const table = appearanceOf(BLOCK_V2.ENCHANTING_TABLE)
		expect(table?.faces[FACE_POS_Y]).toBe(textureLayer('enchanting_table_top'))
		expect(table?.faces[FACE_NEG_Y]).toBe(textureLayer('enchanting_table_bottom'))
		expect(table?.faces[FACE_NEG_X]).toBe(textureLayer('enchanting_table_side'))
	})
})
