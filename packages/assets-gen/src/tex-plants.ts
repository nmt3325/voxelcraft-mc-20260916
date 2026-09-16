/** Cutout plants: alpha is only ever 0 or 255 on these tiles. */
import { GRASS, LEAF, PLANT_STEM, TWIG } from './palette'
import { TILE_PX, TRANSPARENT, TileCanvas, shade, type Rgba } from './tile'

/** Dense foliage with hash driven holes and darker rims around them. */
export function leavesTile(salt: number): (t: TileCanvas) => void {
	const isHole = (t: TileCanvas, x: number, y: number): boolean => t.noise(salt, x, y) < 0.14
	return (t) => {
		for (let y = 0; y < TILE_PX; y++) {
			for (let x = 0; x < TILE_PX; x++) {
				if (isHole(t, x, y)) t.set(x, y, TRANSPARENT)
				else t.set(x, y, shade(LEAF, 0.78 + t.steps(salt + 1, x, y, 4) * 0.42))
			}
		}
		for (let y = 0; y < TILE_PX; y++) {
			for (let x = 0; x < TILE_PX; x++) {
				if (t.get(x, y)[3] === 0) continue
				const nextToHole =
					isHole(t, x + 1, y) || isHole(t, x - 1, y) || isHole(t, x, y + 1) || isHole(t, x, y - 1)
				if (nextToHole) t.set(x, y, shade(t.get(x, y), 0.72))
			}
		}
	}
}

/** Blades rising from the bottom edge, bending at the tip. */
export function tallGrassTile(t: TileCanvas): void {
	t.fill(TRANSPARENT)
	for (let x = 1; x < TILE_PX - 1; x += 2) {
		const height = 6 + Math.floor(t.noise(461, x, 0) * 8)
		const lean = t.noise(462, x, 0) > 0.5 ? 1 : -1
		for (let i = 0; i < height; i++) {
			const bend = i > height - 3 ? lean : 0
			t.set(x + bend, TILE_PX - 1 - i, shade(GRASS, 0.8 + (i / height) * 0.4))
		}
	}
}

export function deadBushTile(t: TileCanvas): void {
	t.fill(TRANSPARENT)
	for (let i = 0; i < 5; i++) {
		let x = 3 + Math.floor(t.noise(471, i, 0) * 10)
		const top = 4 + Math.floor(t.noise(471, i, 1) * 5)
		for (let y = TILE_PX - 1; y >= top; y--) {
			t.set(x, y, shade(TWIG, 0.82 + t.noise(472, x, y) * 0.3))
			if (t.noise(473, x, y) > 0.72) x += t.noise(474, x, y) > 0.5 ? 1 : -1
		}
	}
}

const PETAL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
	[0, -1],
	[0, 0],
	[-1, 0],
	[1, 0],
	[0, 1],
	[-1, -1],
	[1, -1],
	[-1, 1],
	[1, 1],
]

export function flowerTile(petal: Rgba, salt: number): (t: TileCanvas) => void {
	return (t) => {
		t.fill(TRANSPARENT)
		for (let y = 8; y < TILE_PX - 1; y++) t.set(7, y, PLANT_STEM)
		t.set(6, 11, shade(PLANT_STEM, 1.1))
		t.set(8, 13, shade(PLANT_STEM, 0.9))
		for (const [dx, dy] of PETAL_OFFSETS) {
			const color =
				dx === 0 && dy === 0 ? shade(petal, 1.3) : shade(petal, 0.9 + t.noise(salt, dx, dy) * 0.25)
			t.set(7 + dx, 6 + dy, color)
		}
	}
}

export function saplingTile(t: TileCanvas): void {
	t.fill(TRANSPARENT)
	for (let y = 8; y < TILE_PX - 1; y++) t.set(7, y, shade(PLANT_STEM, 0.9))
	for (let y = 4; y < 9; y++) {
		const half = y - 3
		for (let x = 7 - half; x <= 7 + half; x++) {
			if (t.noise(481, x, y) > 0.25) t.set(x, y, shade(LEAF, 0.85 + t.noise(482, x, y) * 0.35))
		}
	}
}
