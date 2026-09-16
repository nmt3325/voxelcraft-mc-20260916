/** Farmland faces and the cutout crop stages that grow on them. */
import { edgeShade, noiseFill, rowSet, rowShade, speckles } from './draw'
import {
	CARROT_ROOT,
	CARROT_TOP,
	CROP_LEAF,
	CROP_YOUNG,
	DIRT,
	DIRT_DARK,
	FARMLAND_DRY,
	FARMLAND_WET,
	POTATO_FLOWER,
	POTATO_ROOT,
	WHEAT_RIPE,
} from './palette'
import { dirtTile } from './tex-ground'
import { TILE_PX, TRANSPARENT, TileCanvas, mix, shade, type Rgba } from './tile'

/** Tilled top face: a furrow every four rows. Wet farmland reads darker and damper. */
export function farmlandTopTile(wet: boolean, salt: number): (t: TileCanvas) => void {
	const base = wet ? FARMLAND_WET : FARMLAND_DRY
	return (t) => {
		noiseFill(t, base, wet ? 0.14 : 0.22, 4, salt)
		for (let y = 0; y < TILE_PX; y++) {
			rowShade(t, y, y % 4 === 0 ? 0.76 : y % 4 === 1 ? 1.1 : 1)
		}
		speckles(t, shade(base, wet ? 0.68 : 0.84), salt + 1, 0.18, 0.55)
		edgeShade(t, 1.04, 0.9)
	}
}

/** Sides stay dirt, with the tilled lip showing on the top rows. */
export function farmlandSideTile(t: TileCanvas): void {
	dirtTile(t)
	rowSet(t, 0, shade(FARMLAND_DRY, 1.06))
	rowShade(t, 1, 0.92)
	speckles(t, DIRT_DARK, 772, 0.12, 0.5)
}

export function farmlandBottomTile(t: TileCanvas): void {
	noiseFill(t, DIRT, 0.22, 4, 781)
	speckles(t, DIRT_DARK, 782, 0.2, 0.66)
	edgeShade(t, 1.02, 0.92)
}

/**
 * Per crop look. Stems ramp from `young` to `mature`; `crown` and `root` only
 * appear on the ripe stages.
 */
export type CropStyle = {
	readonly young: Rgba
	readonly mature: Rgba
	readonly crown: Rgba
	readonly root: Rgba | null
	/** Stem columns, used in order: later stages fill in more of them. */
	readonly columns: readonly number[]
	readonly salt: number
}

export const CROP_STYLES: Readonly<Record<string, CropStyle>> = {
	wheat: {
		young: CROP_YOUNG,
		mature: WHEAT_RIPE,
		crown: shade(WHEAT_RIPE, 1.16),
		root: null,
		columns: [3, 8, 12, 5, 10, 1, 14],
		salt: 901,
	},
	carrot: {
		young: CROP_YOUNG,
		mature: CARROT_TOP,
		crown: shade(CROP_LEAF, 1.24),
		root: CARROT_ROOT,
		columns: [4, 9, 13, 6, 11, 2, 15],
		salt: 911,
	},
	potato: {
		young: CROP_YOUNG,
		mature: CROP_LEAF,
		crown: POTATO_FLOWER,
		root: POTATO_ROOT,
		columns: [2, 7, 11, 4, 9, 13, 6],
		salt: 921,
	},
}

/**
 * One cutout crop stage. Stem height, stem count and colour all ramp with
 * `stage`, so stage 0 reads as a sprout and the last stage as a ripe plant.
 * The per column jitter is keyed on the column only, never on the stage, so the
 * silhouette grows monotonically instead of wobbling between stages.
 */
export function cropStageTile(
	style: CropStyle,
	stage: number,
	stages: number,
): (t: TileCanvas) => void {
	const steps = Math.max(1, stages - 1)
	const clamped = stage < 0 ? 0 : stage > steps ? steps : stage
	const ripeness = clamped / steps
	return (t) => {
		t.fill(TRANSPARENT)
		const height = 2 + Math.round(ripeness * 11)
		const stems = 2 + Math.round(ripeness * (style.columns.length - 2))
		for (let i = 0; i < stems; i++) {
			const x = style.columns[i]
			const extra = t.noise(style.salt, x, 0) > 0.6 ? 1 : 0
			const top = TILE_PX - 1 - Math.min(TILE_PX - 2, height + extra)
			for (let y = TILE_PX - 1; y >= top; y--) {
				const along = (TILE_PX - 1 - y) / (height + extra + 1)
				const blend = ripeness * 0.55 + along * 0.55
				const color = mix(style.young, style.mature, blend > 1 ? 1 : blend)
				t.set(x, y, shade(color, 0.86 + t.steps(style.salt + 1, x, y, 3) * 0.3))
			}
			if (ripeness > 0.3) {
				t.set(x - 1, top + 2, shade(style.mature, 0.9))
				t.set(x + 1, top + 4, shade(style.mature, 1.06))
			}
			if (ripeness > 0.84) {
				t.set(x, top, style.crown)
				t.set(x, top + 1, shade(style.crown, 0.88))
				if (style.root) {
					t.set(x, TILE_PX - 1, style.root)
					t.set(x, TILE_PX - 2, shade(style.root, 1.08))
				}
			}
		}
	}
}
