/** Ores, mineral blocks and worked stone. */
import { edgeShade, noiseFill, plus, speckles } from './draw'
import {
	BRICK,
	BRICK_MORTAR,
	COAL,
	GLOWSTONE,
	GLOW_HOT,
	MORTAR,
	OBSIDIAN,
	OBSIDIAN_SPECK,
	STONE,
	WOOL,
} from './palette'
import { brickPattern } from './pattern'
import { stoneTile } from './tex-ground'
import { TILE_PX, TileCanvas, rgb, shade, withAlpha, type Rgba } from './tile'

/** Ore speckles with a darker rim, drawn over whatever is already on the tile. */
export function oreBlobs(t: TileCanvas, ore: Rgba, count: number, salt: number): void {
	for (let i = 0; i < count; i++) {
		const cx = 2 + Math.floor(t.noise(salt, i, 0) * (TILE_PX - 4))
		const cy = 2 + Math.floor(t.noise(salt, i, 1) * (TILE_PX - 4))
		const size = t.noise(salt, i, 2) > 0.5 ? 2 : 1
		plus(t, cx, cy, size + 1, shade(ore, 0.5))
		plus(t, cx, cy, size, ore)
		t.set(cx, cy, shade(ore, 1.22))
	}
}

/** Short random walks, used for cracks in ice and obsidian. */
export function crackLines(
	t: TileCanvas,
	color: Rgba,
	alpha: number,
	count: number,
	salt: number,
): void {
	for (let i = 0; i < count; i++) {
		let x = Math.floor(t.noise(salt, i, 0) * TILE_PX)
		let y = Math.floor(t.noise(salt, i, 1) * TILE_PX)
		for (let step = 0; step < 9; step++) {
			t.set(x, y, withAlpha(color, alpha))
			x += t.noise(salt + 2, i, step) > 0.35 ? 1 : 0
			y += t.noise(salt + 3, i, step) > 0.5 ? 1 : -1
		}
	}
}

/** Stone host rock plus ore blobs. */
export function oreTile(ore: Rgba, count: number, salt: number): (t: TileCanvas) => void {
	return (t) => {
		stoneTile(t)
		oreBlobs(t, ore, count, salt)
	}
}

export function mineralBlockTile(base: Rgba, salt: number): (t: TileCanvas) => void {
	return (t) => {
		noiseFill(t, base, 0.1, 3, salt)
		for (let i = 0; i < 4; i++) {
			const cx = 3 + Math.floor(t.noise(salt + 1, i, 0) * 10)
			const cy = 3 + Math.floor(t.noise(salt + 1, i, 1) * 10)
			plus(t, cx, cy, 1, shade(base, 1.18))
		}
		edgeShade(t, 1.12, 0.84)
	}
}

export function obsidianTile(t: TileCanvas): void {
	noiseFill(t, OBSIDIAN, 0.4, 4, 151)
	speckles(t, OBSIDIAN_SPECK, 152, 0.16, 0.6)
	crackLines(t, OBSIDIAN_SPECK, 255, 3, 153)
	edgeShade(t, 1.3, 0.8)
}

export function glowstoneTile(t: TileCanvas): void {
	noiseFill(t, GLOWSTONE, 0.18, 4, 161)
	for (let i = 0; i < 9; i++) {
		const cx = 2 + Math.floor(t.noise(162, i, 0) * 12)
		const cy = 2 + Math.floor(t.noise(162, i, 1) * 12)
		plus(t, cx, cy, 1, GLOW_HOT)
	}
	edgeShade(t, 1.08, 0.92)
}

export function woolTile(t: TileCanvas): void {
	noiseFill(t, WOOL, 0.08, 3, 171)
	speckles(t, shade(WOOL, 0.9), 172, 0.3, 0.4)
	edgeShade(t, 1.02, 0.94)
}

export function stoneBricksTile(t: TileCanvas): void {
	brickPattern(t, shade(STONE, 1.02), MORTAR, 8, 8, 181)
	speckles(t, shade(STONE, 0.8), 182, 0.12, 0.4)
	edgeShade(t, 1.04, 0.9)
}

export function bricksTile(t: TileCanvas): void {
	brickPattern(t, BRICK, BRICK_MORTAR, 4, 8, 191)
	speckles(t, shade(BRICK, 0.82), 192, 0.12, 0.5)
	edgeShade(t, 1.04, 0.9)
}

export function coalBlockTile(t: TileCanvas): void {
	noiseFill(t, COAL, 0.5, 4, 201)
	speckles(t, rgb(96, 96, 96), 202, 0.1, 0.5)
	edgeShade(t, 1.3, 0.8)
}
