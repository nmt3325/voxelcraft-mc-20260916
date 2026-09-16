/** Thin cutout props: torch and ladder. */
import { FIRE_HOT, FIRE_MID, LADDER_WOOD, WOOD_STICK } from './palette'
import { TILE_PX, TRANSPARENT, TileCanvas, shade } from './tile'

export function torchTile(t: TileCanvas): void {
	t.fill(TRANSPARENT)
	for (let y = 6; y < TILE_PX; y++) {
		t.set(7, y, shade(WOOD_STICK, 1.05))
		t.set(8, y, shade(WOOD_STICK, 0.85))
	}
	t.set(6, 5, shade(FIRE_MID, 0.8))
	t.set(9, 5, shade(FIRE_MID, 0.8))
	t.set(7, 5, FIRE_MID)
	t.set(8, 5, FIRE_MID)
	t.set(7, 4, FIRE_HOT)
	t.set(8, 4, shade(FIRE_HOT, 0.92))
}

export function ladderTile(t: TileCanvas): void {
	t.fill(TRANSPARENT)
	for (let y = 0; y < TILE_PX; y++) {
		t.set(2, y, shade(LADDER_WOOD, 1.05))
		t.set(3, y, shade(LADDER_WOOD, 0.85))
		t.set(12, y, shade(LADDER_WOOD, 1.05))
		t.set(13, y, shade(LADDER_WOOD, 0.85))
	}
	for (let y = 2; y < TILE_PX; y += 5) {
		for (let x = 3; x < 13; x++) t.set(x, y, shade(LADDER_WOOD, 0.95))
	}
}
