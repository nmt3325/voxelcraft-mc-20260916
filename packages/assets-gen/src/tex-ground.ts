/** Ground and stone textures. */
import { edgeShade, noiseFill, rowShade, speckles } from './draw'
import {
	BEDROCK,
	CLAY,
	DIRT,
	DIRT_DARK,
	GRASS,
	GRAVEL,
	MORTAR,
	SAND,
	SANDSTONE,
	SNOW,
	STONE,
	STONE_DARK,
} from './palette'
import { voronoiStones } from './pattern'
import { TILE_PX, TileCanvas, rgb, shade } from './tile'

/** Magenta/black checker fallback; it must sit at atlas index 0. */
export function missingTile(t: TileCanvas): void {
	const magenta = rgb(248, 0, 248)
	const black = rgb(22, 22, 22)
	for (let y = 0; y < TILE_PX; y++) {
		for (let x = 0; x < TILE_PX; x++) {
			t.set(x, y, (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 1 ? black : magenta)
		}
	}
}

export function stoneTile(t: TileCanvas): void {
	noiseFill(t, STONE, 0.22, 5, 11)
	speckles(t, STONE_DARK, 12, 0.12, 0.55)
	edgeShade(t, 1.04, 0.9)
}

export function cobblestoneTile(t: TileCanvas): void {
	voronoiStones(t, STONE, MORTAR, 5.4, 0.9, 21)
	edgeShade(t, 1.02, 0.88)
}

export function dirtTile(t: TileCanvas): void {
	noiseFill(t, DIRT, 0.24, 4, 31)
	speckles(t, DIRT_DARK, 32, 0.18, 0.7)
	edgeShade(t, 1.03, 0.9)
}

export function grassTopTile(t: TileCanvas): void {
	noiseFill(t, GRASS, 0.2, 4, 41)
	speckles(t, shade(GRASS, 0.78), 42, 0.2, 0.6)
	speckles(t, shade(GRASS, 1.16), 43, 0.14, 0.5)
}

/** Dirt with a grass cap. The cap stays near grey so the biome tint colours it. */
export function grassSideTile(t: TileCanvas): void {
	dirtTile(t)
	for (let x = 0; x < TILE_PX; x++) {
		const depth = 3 + Math.floor(t.noise(51, x, 0) * 3)
		for (let y = 0; y < depth; y++) t.set(x, y, shade(GRASS, 0.9 + t.noise(52, x, y) * 0.26))
		if (t.noise(53, x, 0) > 0.45) t.set(x, depth, shade(GRASS, 0.8))
	}
}

export function sandTile(t: TileCanvas): void {
	noiseFill(t, SAND, 0.13, 4, 61)
	speckles(t, shade(SAND, 0.88), 62, 0.18, 0.5)
}

export function sandstoneTile(t: TileCanvas): void {
	noiseFill(t, SANDSTONE, 0.1, 3, 71)
	for (let y = 0; y < TILE_PX; y++) rowShade(t, y, y < 3 ? 1.08 : y > 12 ? 0.9 : 1)
	rowShade(t, 3, 0.86)
	rowShade(t, 12, 0.86)
}

export function gravelTile(t: TileCanvas): void {
	voronoiStones(t, GRAVEL, rgb(96, 92, 90), 3.2, 0.55, 81)
	speckles(t, rgb(180, 176, 172), 84, 0.1, 0.5)
}

export function snowTile(t: TileCanvas): void {
	noiseFill(t, SNOW, 0.05, 3, 91)
	speckles(t, rgb(226, 234, 246), 92, 0.2, 0.5)
}

export function snowLayerTile(t: TileCanvas): void {
	noiseFill(t, SNOW, 0.06, 3, 96)
	speckles(t, rgb(218, 228, 244), 97, 0.16, 0.6)
	edgeShade(t, 1.02, 0.94)
}

export function clayTile(t: TileCanvas): void {
	noiseFill(t, CLAY, 0.1, 3, 141)
	speckles(t, rgb(140, 148, 164), 142, 0.15, 0.45)
}

export function bedrockTile(t: TileCanvas): void {
	voronoiStones(t, BEDROCK, rgb(30, 30, 30), 4, 0.7, 131)
	speckles(t, rgb(110, 110, 110), 134, 0.12, 0.6)
}
