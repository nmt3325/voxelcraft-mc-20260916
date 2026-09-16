/** Nether surfaces: netherrack, soul blocks, quartz ore, nether bricks, magma and the portal sheet. */
import { edgeShade, noiseFill, plus, rowShade, speckles } from './draw'
import { TWO_PI, sinApprox } from './dsp'
import {
	MAGMA_CRUST,
	MAGMA_HOT,
	NETHERRACK,
	NETHERRACK_DARK,
	NETHER_BRICK,
	NETHER_MORTAR,
	PORTAL,
	PORTAL_CORE,
	QUARTZ,
	SOUL_FACE,
	SOUL_SAND,
	SOUL_SOIL,
} from './palette'
import { brickPattern, voronoiAt } from './pattern'
import { crackLines, oreBlobs } from './tex-mineral'
import { TILE_PX, TileCanvas, shade, withAlpha, type Rgba } from './tile'

/** Porous red stone: noisy base, darker pockets and a few bedding lines. */
export function netherrackTile(t: TileCanvas): void {
	noiseFill(t, NETHERRACK, 0.26, 5, 701)
	speckles(t, NETHERRACK_DARK, 702, 0.22, 0.6)
	for (let i = 0; i < 4; i++) rowShade(t, 1 + Math.floor(t.noise(703, i, 0) * 13), 0.86)
	edgeShade(t, 1.05, 0.9)
}

function soulBase(t: TileCanvas, base: Rgba, salt: number): void {
	noiseFill(t, base, 0.2, 4, salt)
	speckles(t, shade(base, 0.68), salt + 1, 0.2, 0.55)
}

/** Soul sand: the sunken face pressed into the surface. */
export function soulSandTile(t: TileCanvas): void {
	soulBase(t, SOUL_SAND, 711)
	plus(t, 5, 6, 1, SOUL_FACE)
	plus(t, 10, 6, 1, SOUL_FACE)
	for (let x = 5; x < 11; x++) t.set(x, 11, shade(SOUL_FACE, 1.05))
	t.set(4, 10, shade(SOUL_FACE, 0.9))
	t.set(11, 10, shade(SOUL_FACE, 0.9))
	edgeShade(t, 1.04, 0.88)
}

/** Soul soil: the same family as soul sand, drier and cracked instead of faced. */
export function soulSoilTile(t: TileCanvas): void {
	soulBase(t, SOUL_SOIL, 721)
	crackLines(t, shade(SOUL_SOIL, 0.6), 255, 3, 722)
	edgeShade(t, 1.03, 0.9)
}

/** Quartz ore: white nuggets in netherrack host stone. */
export function quartzOreTile(t: TileCanvas): void {
	netherrackTile(t)
	oreBlobs(t, QUARTZ, 5, 731)
}

export function netherBricksTile(t: TileCanvas): void {
	brickPattern(t, NETHER_BRICK, NETHER_MORTAR, 4, 8, 741)
	speckles(t, shade(NETHER_BRICK, 1.35), 742, 0.1, 0.4)
	edgeShade(t, 1.08, 0.86)
}

/** Magma: hot veins running between cooling crust cells. */
export function magmaTile(t: TileCanvas): void {
	for (let y = 0; y < TILE_PX; y++) {
		for (let x = 0; x < TILE_PX; x++) {
			const cell = voronoiAt(t, 751, 5.2, x, y)
			const vein = cell.border < 0.85
			t.set(
				x,
				y,
				vein
					? shade(MAGMA_HOT, 0.86 + cell.tone * 0.3)
					: shade(MAGMA_CRUST, 0.78 + cell.tone * 0.38),
			)
		}
	}
	speckles(t, shade(MAGMA_HOT, 1.2), 752, 0.08, 0.6)
	edgeShade(t, 1.08, 0.86)
}

/**
 * Portal sheet: a swirl that keeps 0 < alpha < 255 pixels, so it renders in the
 * translucent layer rather than the cutout one.
 */
export function netherPortalTile(t: TileCanvas): void {
	for (let y = 0; y < TILE_PX; y++) {
		for (let x = 0; x < TILE_PX; x++) {
			const swirl = sinApprox(((x + y) / TILE_PX) * TWO_PI) * 0.5 + 0.5
			const tone = 0.78 + swirl * 0.5 + (t.steps(761, x, y, 4) - 0.5) * 0.24
			const spark = t.noise(762, x, y) > 0.86
			const color = spark ? shade(PORTAL_CORE, tone) : shade(PORTAL, tone)
			t.set(x, y, withAlpha(color, 168 + Math.floor(swirl * 52) + (spark ? 16 : 0)))
		}
	}
}
