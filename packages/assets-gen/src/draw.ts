/** Drawing primitives shared by the texture generators. */
import { TILE_PX, TileCanvas, mix, shade, type Rgba } from './tile'

/** Quantised per-pixel brightness noise over a flat base colour. */
export function noiseFill(
	t: TileCanvas,
	base: Rgba,
	spread: number,
	levels: number,
	salt: number,
): void {
	for (let y = 0; y < TILE_PX; y++) {
		for (let x = 0; x < TILE_PX; x++) {
			t.set(x, y, shade(base, 1 + (t.steps(salt, x, y, levels) - 0.5) * spread))
		}
	}
}

/** Scatter a second colour over the tile with the given probability. */
export function speckles(
	t: TileCanvas,
	color: Rgba,
	salt: number,
	chance: number,
	strength: number,
): void {
	for (let y = 0; y < TILE_PX; y++) {
		for (let x = 0; x < TILE_PX; x++) {
			if (t.noise(salt, x, y) < chance) t.set(x, y, mix(t.get(x, y), color, strength))
		}
	}
}

/** Light top/left edge and dark bottom/right edge: the classic block bevel. */
export function edgeShade(t: TileCanvas, topFactor: number, bottomFactor: number): void {
	const last = TILE_PX - 1
	for (let i = 0; i < TILE_PX; i++) {
		t.set(i, 0, shade(t.get(i, 0), topFactor))
		t.set(0, i, shade(t.get(0, i), topFactor))
		t.set(i, last, shade(t.get(i, last), bottomFactor))
		t.set(last, i, shade(t.get(last, i), bottomFactor))
	}
}

export function ringRect(
	t: TileCanvas,
	x0: number,
	y0: number,
	w: number,
	h: number,
	color: Rgba,
): void {
	for (let x = x0; x < x0 + w; x++) {
		t.set(x, y0, color)
		t.set(x, y0 + h - 1, color)
	}
	for (let y = y0; y < y0 + h; y++) {
		t.set(x0, y, color)
		t.set(x0 + w - 1, y, color)
	}
}

export function border(t: TileCanvas, color: Rgba): void {
	ringRect(t, 0, 0, TILE_PX, TILE_PX, color)
}

export function rectShade(
	t: TileCanvas,
	x0: number,
	y0: number,
	w: number,
	h: number,
	factor: number,
): void {
	for (let y = y0; y < y0 + h; y++) {
		for (let x = x0; x < x0 + w; x++) t.set(x, y, shade(t.get(x, y), factor))
	}
}

export function rowSet(t: TileCanvas, y: number, color: Rgba): void {
	for (let x = 0; x < TILE_PX; x++) t.set(x, y, color)
}

export function colSet(t: TileCanvas, x: number, color: Rgba): void {
	for (let y = 0; y < TILE_PX; y++) t.set(x, y, color)
}

export function rowShade(t: TileCanvas, y: number, factor: number): void {
	for (let x = 0; x < TILE_PX; x++) t.set(x, y, shade(t.get(x, y), factor))
}

export function colShade(t: TileCanvas, x: number, factor: number): void {
	for (let y = 0; y < TILE_PX; y++) t.set(x, y, shade(t.get(x, y), factor))
}

/** Filled diamond of the given manhattan radius. */
export function plus(t: TileCanvas, cx: number, cy: number, size: number, color: Rgba): void {
	for (let dy = -size; dy <= size; dy++) {
		const span = size - (dy < 0 ? -dy : dy)
		for (let dx = -span; dx <= span; dx++) t.set(cx + dx, cy + dy, color)
	}
}
