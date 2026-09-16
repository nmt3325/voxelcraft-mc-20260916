/** Door, bed and piston faces. */
import { edgeShade, noiseFill, ringRect } from './draw'
import {
  CLOTH_RED,
  IRON,
  IRON_DARK,
  PILLOW,
  PLANKS,
  PLANKS_DARK,
  STONE,
  STONE_DARK,
  WOOD_STICK,
} from './palette'
import { planksPattern } from './pattern'
import { TILE_PX, TileCanvas, rgb, shade } from './tile'

export function doorLowerTile(t: TileCanvas): void {
  planksPattern(t, PLANKS, 8, true, 351)
  ringRect(t, 0, 0, TILE_PX, TILE_PX, shade(PLANKS_DARK, 0.7))
  ringRect(t, 2, 2, 12, 12, shade(PLANKS_DARK, 0.82))
  for (let y = 6; y < 9; y++) t.set(12, y, IRON_DARK)
}

/** Upper door half carries the little window. */
export function doorUpperTile(t: TileCanvas): void {
  planksPattern(t, PLANKS, 8, true, 361)
  ringRect(t, 0, 0, TILE_PX, TILE_PX, shade(PLANKS_DARK, 0.7))
  for (let y = 3; y < 8; y++) {
    for (let x = 4; x < 12; x++) t.set(x, y, rgb(86, 120, 140))
  }
  ringRect(t, 4, 3, 8, 5, shade(PLANKS_DARK, 0.66))
}

function bedBase(t: TileCanvas): void {
  noiseFill(t, CLOTH_RED, 0.12, 3, 371)
  edgeShade(t, 1.06, 0.88)
}

export function bedHeadTile(t: TileCanvas): void {
  bedBase(t)
  for (let y = 1; y < 7; y++) {
    for (let x = 3; x < 13; x++) t.set(x, y, shade(PILLOW, 0.94 + t.noise(372, x, y) * 0.12))
  }
  ringRect(t, 3, 1, 10, 6, shade(PILLOW, 0.82))
}

export function bedFootTile(t: TileCanvas): void {
  bedBase(t)
  ringRect(t, 1, 1, 14, 14, shade(CLOTH_RED, 0.78))
  for (let x = 2; x < 14; x++) t.set(x, 13, shade(WOOD_STICK, 0.9))
}

export function pistonSideTile(t: TileCanvas): void {
  planksPattern(t, PLANKS, 4, true, 381)
  ringRect(t, 0, 0, TILE_PX, TILE_PX, shade(PLANKS_DARK, 0.7))
  for (let y = 0; y < TILE_PX; y += 5) {
    for (let x = 1; x < TILE_PX - 1; x++) t.set(x, y, shade(PLANKS_DARK, 0.86))
  }
}

/** Piston face plate: metal inside a stone frame. */
export function pistonTopTile(t: TileCanvas): void {
  noiseFill(t, STONE, 0.14, 3, 391)
  for (let y = 2; y < 14; y++) {
    for (let x = 2; x < 14; x++) t.set(x, y, shade(IRON_DARK, 0.9 + t.noise(392, x, y) * 0.2))
  }
  ringRect(t, 2, 2, 12, 12, IRON)
  ringRect(t, 0, 0, TILE_PX, TILE_PX, shade(STONE_DARK, 0.8))
}

/** Piston head: the extending rod band across a wooden plate. */
export function pistonHeadTile(t: TileCanvas): void {
  noiseFill(t, PLANKS, 0.1, 3, 401)
  for (let y = 6; y < 10; y++) {
    for (let x = 0; x < TILE_PX; x++) t.set(x, y, shade(IRON_DARK, y === 6 ? 1.12 : 0.9))
  }
  ringRect(t, 0, 0, TILE_PX, TILE_PX, shade(PLANKS_DARK, 0.72))
}
