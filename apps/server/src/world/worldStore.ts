/**
 * The authoritative block store.
 *
 * Columns are generated on first touch and then cached, and the identity of the
 * returned ChunkColumn matters as much as its values: the streamer encodes the
 * very arrays an edit lands in.
 *
 * The cache is bounded, and the bound is honest in both directions:
 *
 *   - Clean columns are a cache. They are evicted least recently used first,
 *     and the eviction runs before the newcomer is inserted, so a fresh column
 *     can never be picked as its own victim.
 *   - A column holding an accepted edit is game state, not cache: it is pinned
 *     and never evicted. The pin is taken before the column is admitted, so
 *     there is no window in which an accepted edit sits in an unpinned entry.
 *   - Pins are admitted against the same cap, so the resident set stays inside
 *     maxColumns. Once every resident column is pinned there is no room to
 *     retain another edit, and the write fails loudly - setBlock returns false
 *     and the refusal is counted and reported - instead of returning true for a
 *     write the store is about to throw away.
 *
 * The ordering used to be insert, trim, then pin, so a brand new edited column
 * was the only unpinned entry at trim time and was deleted while setBlock still
 * returned true: 400 edits in 400 distinct columns were all accepted and 62 of
 * them, every one from the 339th onwards, were unreadable immediately
 * afterwards, with a BlockChange broadcast for each.
 */
import {
	BLOCK,
	CHUNK_VOLUME,
	CHUNK_Y,
	DIMENSION,
	NET,
	blockIndex,
	chunkKey,
	worldToChunk,
	worldToLocal,
	type BlockId,
	type DimensionId,
} from '@voxelcraft/core-types'
import type { ChunkColumn, ServerWorld } from '../types'
import { generateColumn } from './generator'

/** Buildable y range. Matches VALIDATION.minY / VALIDATION.maxY by construction. */
const MIN_Y = 0
const MAX_Y = CHUNK_Y - 1

/** Columns in one full stream window, (2r + 1)^2 under the square rule. */
const STREAM_WINDOW_COLUMNS = (2 * NET.streamRadius + 1) ** 2

export const WORLD_CACHE = {
	/**
	 * Resident columns, clean and pinned together. Two stream windows: one for
	 * where a player is and one for the trail it just left, so walking back a
	 * few chunks does not pay to regenerate what was streamed a second ago. A
	 * window per player would be maxPlayers times this and is not worth the
	 * resident memory, because the generator is deterministic and a re-touch
	 * only costs time.
	 */
	maxColumns: STREAM_WINDOW_COLUMNS * 2,
} as const

function inBuildRange(y: number): boolean {
	return y >= MIN_Y && y <= MAX_Y
}

export interface ServerWorldOptions {
	/** Resident columns, pins included, before eviction starts. Defaults to WORLD_CACHE. */
	readonly maxColumns?: number
	/**
	 * Where a refused write is reported. Defaults to console.warn, because an
	 * edit the store cannot retain must never be dropped in silence.
	 */
	readonly onRefusedWrite?: (message: string) => void
}

export function createServerWorld(
	seed: number,
	dimension: DimensionId = DIMENSION.Overworld,
	options: ServerWorldOptions = {},
): ServerWorld {
	const maxColumns = Math.max(1, Math.floor(options.maxColumns ?? WORLD_CACHE.maxColumns))
	const report =
		options.onRefusedWrite ??
		((message: string): void => {
			console.warn(message)
		})
	const columns = new Map<string, ChunkColumn>()
	/** Keys of columns an accepted edit touched. Pinned, never evicted. */
	const edited = new Set<string>()
	let refusedWrites = 0

	/** Re-inserting is what turns the insertion ordered Map into an LRU. */
	function touch(key: string, column: ChunkColumn): void {
		columns.delete(key)
		columns.set(key, column)
	}

	function generate(cx: number, cz: number): ChunkColumn {
		const blocks = new Uint16Array(CHUNK_VOLUME)
		const fluids = new Uint8Array(CHUNK_VOLUME)
		generateColumn(seed, cx, cz, blocks, fluids)
		return { cx, cz, blocks, fluids }
	}

	/**
	 * Drops clean columns, least recently used first, until one more column
	 * fits. False when every resident column is pinned: the cap is full of game
	 * state and there is nothing the store may throw away to make space.
	 */
	function makeRoom(): boolean {
		if (columns.size < maxColumns) return true
		for (const key of columns.keys()) {
			if (edited.has(key)) continue
			columns.delete(key)
			if (columns.size < maxColumns) return true
		}
		return columns.size < maxColumns
	}

	/**
	 * The column at cx, cz. `pin` promotes it to game state before it is
	 * admitted, which is what makes an accepted edit durable. Returns null only
	 * for a pinned request the store has no room to retain.
	 */
	function acquire(cx: number, cz: number, pin: boolean): ChunkColumn | null {
		const key = chunkKey(cx, cz)
		const cached = columns.get(key)
		if (cached !== undefined) {
			touch(key, cached)
			// A key that is already resident does not grow the resident set, so
			// pinning it here can never push the store past its cap.
			if (pin) edited.add(key)
			return cached
		}
		if (!makeRoom()) {
			if (pin) return null
			// A clean read still has to answer with the right blocks, so the column
			// is generated and handed back without being admitted. Only unedited
			// terrain is ever transient, so nothing can be lost this way and the
			// resident set stays inside the cap.
			return generate(cx, cz)
		}
		const column = generate(cx, cz)
		// Pin first, insert second, and nothing trims in between: the newcomer is
		// never a candidate for the eviction its own insert would have triggered.
		if (pin) edited.add(key)
		columns.set(key, column)
		return column
	}

	function chunk(cx: number, cz: number): ChunkColumn {
		const column = acquire(cx, cz, false)
		// acquire only refuses a pinned request, and this one is not pinned.
		if (column === null) throw new Error('world: a clean column request cannot be refused')
		return column
	}

	function columnAt(x: number, z: number): ChunkColumn {
		return chunk(worldToChunk(x), worldToChunk(z))
	}

	return {
		seed,
		dimension,
		chunk,
		hasColumn(cx: number, cz: number): boolean {
			// A peek, so it deliberately does not count as a use for the LRU.
			return columns.has(chunkKey(cx, cz))
		},
		block(x: number, y: number, z: number): BlockId {
			// Air rather than a throw: a mob or a player at the world ceiling must
			// not be able to kill the tick loop.
			if (!inBuildRange(y)) return BLOCK.AIR
			return columnAt(x, z).blocks[blockIndex(worldToLocal(x), y, worldToLocal(z))]
		},
		setBlock(x: number, y: number, z: number, block: BlockId): boolean {
			if (!inBuildRange(y)) return false
			// Pinned before the write lands, so the column holding an accepted edit
			// is game state from the first instant it exists.
			const column = acquire(worldToChunk(x), worldToChunk(z), true)
			if (column === null) {
				refusedWrites += 1
				// Loud, not silent: the caller must not broadcast this edit, and an
				// operator has to be able to see that the cap is full of pins.
				if (refusedWrites === 1 || refusedWrites % 64 === 0) {
					report(
						`world: refused a block edit at ${x},${y},${z}: all ${maxColumns} resident ` +
							`columns hold edits, so the write could not be retained ` +
							`(${refusedWrites} refused so far)`,
					)
				}
				return false
			}
			column.blocks[blockIndex(worldToLocal(x), y, worldToLocal(z))] = block
			return true
		},
		surfaceY(x: number, z: number): number {
			const column = columnAt(x, z)
			const lx = worldToLocal(x)
			const lz = worldToLocal(z)
			for (let y = MAX_Y; y >= MIN_Y; y--) {
				if (column.blocks[blockIndex(lx, y, lz)] !== BLOCK.AIR) return y + 1
			}
			return MIN_Y
		},
		get loadedChunks(): number {
			return columns.size
		},
		get maxResidentColumns(): number {
			return maxColumns
		},
		get pinnedColumns(): number {
			// Pinned columns are never evicted, so this is also how much of the cap
			// is spoken for by game state.
			return edited.size
		},
		get refusedWrites(): number {
			return refusedWrites
		},
	}
}
