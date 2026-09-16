/** Village and enchanting props: enchanting table, bookshelf, hay, fences and paths. */
import {
	colSet,
	edgeShade,
	noiseFill,
	plus,
	rectShade,
	ringRect,
	rowSet,
	rowShade,
	speckles,
} from './draw'
import {
	BOOK_BLUE,
	BOOK_GREEN,
	BOOK_PAGES,
	BOOK_RED,
	ENCHANT_CLOTH,
	ENCHANT_RUNE,
	GRAVEL,
	HAY,
	HAY_BAND,
	MORTAR,
	OBSIDIAN,
	OBSIDIAN_SPECK,
	PLANKS,
	PLANKS_DARK,
	STONE,
	STONE_DARK,
	WOOD_STICK,
} from './palette'
import { planksPattern, voronoiStones } from './pattern'
import { TILE_PX, TRANSPARENT, TileCanvas, rgb, shade, type Rgba } from './tile'

function obsidianBase(t: TileCanvas, salt: number): void {
	noiseFill(t, OBSIDIAN, 0.34, 4, salt)
	speckles(t, OBSIDIAN_SPECK, salt + 1, 0.13, 0.52)
}

/** Table top: obsidian slab under red cloth, with the rune floating above it. */
export function enchantingTableTopTile(t: TileCanvas): void {
	obsidianBase(t, 801)
	for (let y = 3; y < 13; y++) {
		for (let x = 3; x < 13; x++) {
			t.set(x, y, shade(ENCHANT_CLOTH, 0.9 + t.noise(803, x, y) * 0.24))
		}
	}
	ringRect(t, 3, 3, 10, 10, shade(ENCHANT_CLOTH, 0.7))
	plus(t, 7, 7, 2, shade(BOOK_PAGES, 1.02))
	t.set(7, 7, ENCHANT_RUNE)
	edgeShade(t, 1.12, 0.86)
}

/** Table side: obsidian with the cloth overhang on top and rising runes. */
export function enchantingTableSideTile(t: TileCanvas): void {
	obsidianBase(t, 811)
	rowSet(t, 0, shade(ENCHANT_CLOTH, 1.02))
	rowSet(t, 1, shade(ENCHANT_CLOTH, 0.82))
	for (let i = 0; i < 5; i++) {
		const y = 4 + i * 2
		t.set(3 + i, y, ENCHANT_RUNE)
		t.set(12 - i, y, shade(ENCHANT_RUNE, 0.86))
	}
	edgeShade(t, 1.1, 0.84)
}

export function enchantingTableBottomTile(t: TileCanvas): void {
	obsidianBase(t, 821)
	ringRect(t, 1, 1, 14, 14, shade(OBSIDIAN, 1.7))
	edgeShade(t, 1.06, 0.8)
}

const BOOK_SPINES: readonly Rgba[] = [BOOK_RED, BOOK_BLUE, BOOK_GREEN, BOOK_PAGES]

/** Bookshelf: two rows of spines between plank shelves. */
export function bookshelfTile(t: TileCanvas): void {
	planksPattern(t, PLANKS, 8, false, 831)
	for (const shelfTop of [1, 9]) {
		let x = 1
		while (x < TILE_PX - 1) {
			const width = t.noise(832, x, shelfTop) > 0.6 ? 2 : 1
			const pick = Math.floor(t.noise(833, x, shelfTop) * BOOK_SPINES.length) % BOOK_SPINES.length
			const spine = BOOK_SPINES[pick]
			for (let y = shelfTop; y < shelfTop + 6; y++) {
				for (let i = 0; i < width && x + i < TILE_PX - 1; i++) {
					t.set(x + i, y, shade(spine, 0.84 + t.noise(834, x + i, y) * 0.3))
				}
			}
			x += width + 1
		}
	}
	rowSet(t, 0, shade(PLANKS_DARK, 1.06))
	rowSet(t, 7, shade(PLANKS_DARK, 0.72))
	rowSet(t, 8, shade(PLANKS, 1.04))
	rowSet(t, TILE_PX - 1, shade(PLANKS_DARK, 0.78))
	edgeShade(t, 1.04, 0.88)
}

/** Bound straw: strands run along one axis, tone quantised per strand. */
function hayFibres(t: TileCanvas, salt: number, vertical: boolean): void {
	for (let a = 0; a < TILE_PX; a++) {
		const tone = 0.84 + t.steps(salt, a, 0, 4) * 0.32
		for (let b = 0; b < TILE_PX; b++) {
			const shaded = shade(HAY, tone + (t.noise(salt + 1, a, b) - 0.5) * 0.1)
			if (vertical) t.set(a, b, shaded)
			else t.set(b, a, shaded)
		}
	}
	speckles(t, HAY_BAND, salt + 2, 0.14, 0.55)
}

export function hayBlockSideTile(t: TileCanvas): void {
	hayFibres(t, 841, true)
	colSet(t, 2, shade(HAY_BAND, 0.82))
	colSet(t, 3, shade(HAY_BAND, 1.12))
	colSet(t, 12, shade(HAY_BAND, 1.12))
	colSet(t, 13, shade(HAY_BAND, 0.82))
	edgeShade(t, 1.05, 0.88)
}

export function hayBlockTopTile(t: TileCanvas): void {
	hayFibres(t, 851, false)
	ringRect(t, 0, 0, TILE_PX, TILE_PX, shade(HAY_BAND, 0.84))
	for (let i = 0; i < 6; i++) {
		const cx = 3 + Math.floor(t.noise(852, i, 0) * 10)
		const cy = 3 + Math.floor(t.noise(852, i, 1) * 10)
		plus(t, cx, cy, 1, shade(HAY, 1.18))
	}
}

export function hayBlockBottomTile(t: TileCanvas): void {
	hayFibres(t, 861, false)
	ringRect(t, 0, 0, TILE_PX, TILE_PX, shade(HAY_BAND, 0.7))
	rectShade(t, 1, 1, 14, 14, 0.9)
}

/** Cutout fence face: centre post plus two rails. */
export function fenceTile(t: TileCanvas): void {
	t.fill(TRANSPARENT)
	for (let y = 0; y < TILE_PX; y++) {
		t.set(6, y, shade(WOOD_STICK, 1.08))
		t.set(7, y, shade(WOOD_STICK, 0.96))
		t.set(8, y, shade(WOOD_STICK, 0.8))
	}
	for (const y of [4, 5, 10, 11]) {
		for (let x = 0; x < TILE_PX; x++) {
			t.set(x, y, shade(WOOD_STICK, y % 2 === 0 ? 1.06 : 0.86))
		}
	}
}

/** Cutout gate: two posts framing braced rails. */
export function fenceGateTile(t: TileCanvas): void {
	t.fill(TRANSPARENT)
	for (let y = 2; y < TILE_PX; y++) {
		for (const x of [1, 2, 13, 14]) {
			t.set(x, y, shade(WOOD_STICK, x < 8 ? 1.06 : 0.86))
		}
	}
	for (const y of [4, 5, 10, 11]) {
		for (let x = 1; x < TILE_PX - 1; x++) {
			t.set(x, y, shade(WOOD_STICK, y % 2 === 0 ? 1.02 : 0.88))
		}
	}
	for (let i = 0; i < 6; i++) t.set(5 + i, 5 + i, shade(WOOD_STICK, 1.14))
}

/** Trodden gravel path: flatter cells than loose gravel, with pale grit on top. */
export function gravelPathTile(t: TileCanvas): void {
	voronoiStones(t, shade(GRAVEL, 0.94), rgb(88, 84, 80), 4.6, 0.6, 871)
	speckles(t, rgb(168, 162, 156), 872, 0.12, 0.45)
	rowShade(t, 0, 1.08)
	edgeShade(t, 1.04, 0.9)
}

/** Wall face: tighter cobble cells under a lighter capping course. */
export function cobblestoneWallTile(t: TileCanvas): void {
	voronoiStones(t, STONE, MORTAR, 4.2, 0.75, 881)
	rowSet(t, 0, shade(STONE, 1.14))
	rowShade(t, 1, 1.04)
	speckles(t, STONE_DARK, 882, 0.1, 0.45)
	edgeShade(t, 1.02, 0.86)
}
