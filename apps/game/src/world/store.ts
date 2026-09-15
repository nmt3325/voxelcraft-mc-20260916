import { PERF, PERSIST, type GameSettings } from '@voxelcraft/core-types'
import type { BlockEdit } from './localWorld'

/**
 * World persistence double.
 *
 * The real store (`packages/persistence`, IndexedDB `PERSIST.dbName`) is being
 * built in parallel, so saves go to `localStorage` under the same database name
 * for now. Only this file knows about the storage backend, so switching to the
 * real store is a one-file change.
 */

export interface PlayerState {
	x: number
	y: number
	z: number
	yaw: number
	pitch: number
	health: number
	hunger: number
	hotbar: number
}

export interface WorldRecord {
	name: string
	seed: number
	createdAt: number
	updatedAt: number
	player: PlayerState
	edits: BlockEdit[]
	settings: GameSettings
}

export interface WorldStore {
	list(): WorldRecord[]
	load(name: string): WorldRecord | null
	save(record: WorldRecord): void
	remove(name: string): void
}

export const DEFAULT_SETTINGS: GameSettings = {
	renderDistance: PERF.renderDistanceDefault,
	fov: PERF.fovDefault,
	sensitivity: PERF.sensitivityDefault,
	volume: 0.6,
	showDebug: false,
}

const INDEX_KEY = `${PERSIST.dbName}:worlds`
const worldKey = (name: string): string => `${PERSIST.dbName}:world:${name}`

function memoryStorage(): Storage {
	const map = new Map<string, string>()
	return {
		get length(): number {
			return map.size
		},
		clear(): void {
			map.clear()
		},
		getItem(key: string): string | null {
			return map.get(key) ?? null
		},
		key(index: number): string | null {
			return [...map.keys()][index] ?? null
		},
		removeItem(key: string): void {
			map.delete(key)
		},
		setItem(key: string, value: string): void {
			map.set(key, value)
		},
	} as Storage
}

function resolveStorage(): Storage {
	try {
		if (typeof localStorage === 'undefined') return memoryStorage()
		const probe = `${PERSIST.dbName}:probe`
		localStorage.setItem(probe, '1')
		localStorage.removeItem(probe)
		return localStorage
	} catch {
		// Private mode or a blocked origin: fall back to memory.
		return memoryStorage()
	}
}

function isRecord(value: unknown): value is WorldRecord {
	if (typeof value !== 'object' || value === null) return false
	const candidate = value as Partial<WorldRecord>
	return (
		typeof candidate.name === 'string' &&
		typeof candidate.seed === 'number' &&
		Array.isArray(candidate.edits) &&
		typeof candidate.player === 'object' &&
		candidate.player !== null
	)
}

export function createWorldStore(storage: Storage = resolveStorage()): WorldStore {
	const readIndex = (): string[] => {
		try {
			const raw = storage.getItem(INDEX_KEY)
			if (raw === null) return []
			const parsed: unknown = JSON.parse(raw)
			return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : []
		} catch {
			return []
		}
	}

	const writeIndex = (names: readonly string[]): void => {
		storage.setItem(INDEX_KEY, JSON.stringify([...new Set(names)]))
	}

	const load = (name: string): WorldRecord | null => {
		try {
			const raw = storage.getItem(worldKey(name))
			if (raw === null) return null
			const parsed: unknown = JSON.parse(raw)
			if (!isRecord(parsed)) return null
			return { ...parsed, settings: { ...DEFAULT_SETTINGS, ...parsed.settings } }
		} catch {
			return null
		}
	}

	return {
		list(): WorldRecord[] {
			const records: WorldRecord[] = []
			for (const name of readIndex()) {
				const record = load(name)
				if (record !== null) records.push(record)
			}
			records.sort((a, b) => b.updatedAt - a.updatedAt)
			return records
		},
		load,
		save(record: WorldRecord): void {
			storage.setItem(worldKey(record.name), JSON.stringify(record))
			writeIndex([...readIndex(), record.name])
		},
		remove(name: string): void {
			storage.removeItem(worldKey(name))
			writeIndex(readIndex().filter((entry) => entry !== name))
		},
	}
}
