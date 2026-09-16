/** Redstone components: wire, lever, button, pressure plate and lamp. */
import { edgeShade, noiseFill, ringRect, speckles } from './draw'
import { GLOW_HOT, PLANKS, PLANKS_DARK, REDSTONE, STONE, STONE_DARK, WOOD_STICK } from './palette'
import { planksPattern } from './pattern'
import { TILE_PX, TRANSPARENT, TileCanvas, rgb, shade } from './tile'

/** Wire cross on a transparent tile: drawn in the cutout layer. */
export function redstoneWireTile(t: TileCanvas): void {
	t.fill(TRANSPARENT)
	for (let i = 0; i < TILE_PX; i++) {
		const tone = 0.8 + t.steps(411, i, 0, 3) * 0.4
		t.set(i, 7, shade(REDSTONE, tone))
		t.set(i, 8, shade(REDSTONE, tone * 0.86))
		t.set(7, i, shade(REDSTONE, tone))
		t.set(8, i, shade(REDSTONE, tone * 0.86))
	}
}

function stoneFace(t: TileCanvas, salt: number): void {
	noiseFill(t, STONE, 0.16, 4, salt)
	speckles(t, STONE_DARK, salt + 1, 0.1, 0.45)
}

export function leverTile(t: TileCanvas): void {
	stoneFace(t, 421)
	for (let y = 10; y < 14; y++) {
		for (let x = 5; x < 11; x++) t.set(x, y, shade(STONE_DARK, 0.9))
	}
	ringRect(t, 5, 10, 6, 4, shade(STONE_DARK, 0.7))
	for (let y = 3; y < 11; y++) t.set(8, y, shade(WOOD_STICK, 1 + (10 - y) * 0.02))
	t.set(7, 3, shade(WOOD_STICK, 0.8))
	t.set(8, 2, shade(WOOD_STICK, 1.1))
}

export function buttonTile(t: TileCanvas): void {
	stoneFace(t, 431)
	for (let y = 6; y < 10; y++) {
		for (let x = 5; x < 11; x++) t.set(x, y, shade(STONE, 1.1))
	}
	ringRect(t, 5, 6, 6, 4, shade(STONE_DARK, 0.76))
}

export function pressurePlateTile(t: TileCanvas): void {
	planksPattern(t, PLANKS, 8, false, 441)
	ringRect(t, 1, 1, 14, 14, shade(PLANKS_DARK, 0.7))
	ringRect(t, 2, 2, 12, 12, shade(PLANKS, 1.08))
	edgeShade(t, 1.02, 0.9)
}

function lamp(t: TileCanvas, lit: boolean): void {
	const base = lit ? rgb(216, 156, 92) : rgb(118, 86, 60)
	const glow = lit ? GLOW_HOT : rgb(150, 112, 78)
	noiseFill(t, base, 0.16, 3, 451)
	for (let y = 2; y < TILE_PX; y += 5) {
		for (let x = 2; x < TILE_PX; x += 5) {
			t.set(x, y, glow)
			t.set(x + 1, y, shade(glow, 0.9))
			t.set(x, y + 1, shade(glow, 0.9))
		}
	}
	ringRect(t, 0, 0, TILE_PX, TILE_PX, shade(base, 0.78))
	edgeShade(t, 1.04, 0.9)
}

export function redstoneLampTile(t: TileCanvas): void {
	lamp(t, false)
}

export function redstoneLampLitTile(t: TileCanvas): void {
	lamp(t, true)
}
