/** Furnace and chest faces. */
import { edgeShade, noiseFill, rectShade, ringRect, rowSet, speckles } from './draw'
import {
  FIRE_HOT,
  FIRE_MID,
  IRON,
  IRON_DARK,
  PLANKS,
  PLANKS_DARK,
  STONE,
  STONE_DARK,
} from './palette'
import { TILE_PX, TileCanvas, rgb, shade } from './tile'

function stoneBase(t: TileCanvas, salt: number): void {
  noiseFill(t, STONE, 0.18, 4, salt)
  speckles(t, STONE_DARK, salt + 1, 0.1, 0.5)
}

export function furnaceSideTile(t: TileCanvas): void {
  stoneBase(t, 301)
  edgeShade(t, 1.05, 0.88)
}

export function furnaceTopTile(t: TileCanvas): void {
  stoneBase(t, 311)
  ringRect(t, 2, 2, 12, 12, shade(STONE_DARK, 0.9))
  rectShade(t, 3, 3, 10, 10, 0.94)
}

/** Furnace mouth with grill bars, optionally burning. */
function furnaceFace(t: TileCanvas, lit: boolean): void {
  stoneBase(t, 321)
  for (let y = 5; y < 14; y++) {
    for (let x = 3; x < 13; x++) t.set(x, y, rgb(38, 34, 30))
  }
  ringRect(t, 3, 5, 10, 9, shade(STONE_DARK, 0.7))
  for (let y = 6; y < 13; y += 2) {
    for (let x = 4; x < 12; x++) t.set(x, y, rgb(56, 50, 46))
  }
  if (lit) {
    for (let y = 8; y < 13; y++) {
      for (let x = 4; x < 12; x++) {
        const n = t.noise(322, x, y)
        if (n > 0.32) t.set(x, y, n > 0.72 ? FIRE_HOT : FIRE_MID)
      }
    }
  }
  edgeShade(t, 1.05, 0.88)
}

export function furnaceFrontTile(t: TileCanvas): void {
  furnaceFace(t, false)
}

export function furnaceFrontLitTile(t: TileCanvas): void {
  furnaceFace(t, true)
}

/** Chest body: planks with a lighter lid band above a dark seam. */
function chestBody(t: TileCanvas): void {
  noiseFill(t, PLANKS, 0.12, 3, 331)
  rectShade(t, 0, 0, TILE_PX, 5, 1.08)
  rowSet(t, 5, shade(PLANKS_DARK, 0.66))
  edgeShade(t, 1.04, 0.88)
}

export function chestSideTile(t: TileCanvas): void {
  chestBody(t)
  speckles(t, PLANKS_DARK, 332, 0.08, 0.4)
}

export function chestFrontTile(t: TileCanvas): void {
  chestBody(t)
  for (let y = 4; y < 9; y++) {
    for (let x = 7; x < 10; x++) t.set(x, y, IRON_DARK)
  }
  for (let y = 5; y < 8; y++) t.set(8, y, rgb(52, 44, 32))
  t.set(7, 4, IRON)
  t.set(9, 4, IRON)
}

export function chestTopTile(t: TileCanvas): void {
  noiseFill(t, PLANKS, 0.1, 3, 341)
  ringRect(t, 1, 1, 14, 14, shade(PLANKS_DARK, 0.72))
  for (let x = 6; x < 10; x++) t.set(x, 1, IRON_DARK)
  edgeShade(t, 1.06, 0.9)
}
