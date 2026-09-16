/** Larger scale patterns: voronoi stones, bricks and planks. */
import { TILE_PX, TileCanvas, shade, type Rgba } from './tile'

export interface VoronoiSample {
	/** 0..1 tone of the winning cell. */
	tone: number
	/** Distance gap to the runner up; small means a cell boundary. */
	border: number
}

export function voronoiAt(
	t: TileCanvas,
	salt: number,
	cellSize: number,
	x: number,
	y: number,
): VoronoiSample {
	const gx = Math.floor(x / cellSize)
	const gy = Math.floor(y / cellSize)
	let best = 1e9
	let second = 1e9
	let tone = 0
	for (let oy = -1; oy <= 1; oy++) {
		for (let ox = -1; ox <= 1; ox++) {
			const cx = gx + ox
			const cy = gy + oy
			const jx = (cx + 0.5 + (t.noise(salt, cx, cy) - 0.5) * 0.8) * cellSize
			const jy = (cy + 0.5 + (t.noise(salt + 1, cx, cy) - 0.5) * 0.8) * cellSize
			const dx = x + 0.5 - jx
			const dy = y + 0.5 - jy
			const d = Math.sqrt(dx * dx + dy * dy)
			if (d < best) {
				second = best
				best = d
				tone = t.noise(salt + 2, cx, cy)
			} else if (d < second) {
				second = d
			}
		}
	}
	return { tone, border: second - best }
}

/** Cobble / gravel / bedrock look: irregular stones separated by mortar. */
export function voronoiStones(
	t: TileCanvas,
	base: Rgba,
	mortar: Rgba,
	cellSize: number,
	borderWidth: number,
	salt: number,
): void {
	for (let y = 0; y < TILE_PX; y++) {
		for (let x = 0; x < TILE_PX; x++) {
			const v = voronoiAt(t, salt, cellSize, x, y)
			if (v.border < borderWidth) {
				t.set(x, y, shade(mortar, 0.92 + t.noise(salt + 5, x, y) * 0.2))
			} else {
				t.set(x, y, shade(base, 0.82 + v.tone * 0.34 + (t.noise(salt + 6, x, y) - 0.5) * 0.09))
			}
		}
	}
}

export function brickPattern(
	t: TileCanvas,
	brick: Rgba,
	mortar: Rgba,
	rowHeight: number,
	brickWidth: number,
	salt: number,
): void {
	for (let y = 0; y < TILE_PX; y++) {
		const row = Math.floor(y / rowHeight)
		const offset = (row % 2) * Math.floor(brickWidth / 2)
		for (let x = 0; x < TILE_PX; x++) {
			if (y % rowHeight === 0 || (x + offset) % brickWidth === 0) {
				t.set(x, y, shade(mortar, 0.94 + t.noise(salt, x, y) * 0.14))
			} else {
				const cell = t.noise(salt + 1, row, Math.floor((x + offset) / brickWidth))
				t.set(x, y, shade(brick, 0.88 + cell * 0.22 + (t.noise(salt + 2, x, y) - 0.5) * 0.08))
			}
		}
	}
}

/** Wooden planks with grain streaks along the plank and darker seams between them. */
export function planksPattern(
	t: TileCanvas,
	base: Rgba,
	plankHeight: number,
	vertical: boolean,
	salt: number,
): void {
	for (let y = 0; y < TILE_PX; y++) {
		for (let x = 0; x < TILE_PX; x++) {
			const along = vertical ? y : x
			const across = vertical ? x : y
			const plank = Math.floor(across / plankHeight)
			let tone =
				0.9 + t.noise(salt + plank, along, plank) * 0.22 + (t.noise(salt + 9, x, y) - 0.5) * 0.08
			if (across % plankHeight === 0) tone *= 0.74
			t.set(x, y, shade(base, tone))
		}
	}
}
