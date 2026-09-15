import type {
	ChunkPos,
	GameSettings,
	PlayerSave,
	SaveMeta,
	WorldStore,
} from '@voxelcraft/core-types'
import {
	assertChunkPos,
	closedError,
	resolvePayloadCodec,
	sortChunkPositions,
	sortWorldMetas,
	type WorldStoreOptions,
} from './support'

/**
 * Filesystem `WorldStore` for Node tests and headless tooling.
 *
 *   <root>/settings.json
 *   <root>/worlds/<worldId>/meta.json
 *   <root>/worlds/<worldId>/player.json
 *   <root>/worlds/<worldId>/chunks/chunk.<cx>.<cz>.bin
 *
 * `node:fs/promises` is imported lazily through a variable specifier so a
 * browser bundle never pulls it into the graph.
 */

export interface FsWorldStoreOptions extends WorldStoreOptions {
	/** Directory that holds the saves. Created on demand. */
	root: string
}

type FsLike = {
	mkdir: (path: string, options: { recursive: boolean }) => Promise<unknown>
	readFile: (path: string) => Promise<Uint8Array>
	writeFile: (path: string, data: Uint8Array) => Promise<void>
	readdir: (path: string) => Promise<string[]>
	rename: (from: string, to: string) => Promise<void>
	rm: (path: string, options: { recursive: boolean; force: boolean }) => Promise<void>
}

const NODE_FS = 'node:fs/promises'
const CHUNK_FILE = /^chunk\.(-?\d+)\.(-?\d+)\.bin$/
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

let fsPromise: Promise<FsLike> | null = null

async function loadFs(): Promise<FsLike> {
	fsPromise ??= import(NODE_FS).then((module) => module as unknown as FsLike)
	return fsPromise
}

function isMissing(error: unknown): boolean {
	return (error as { code?: string } | null)?.code === 'ENOENT'
}

async function readJson<T>(fs: FsLike, path: string): Promise<T | undefined> {
	try {
		const bytes = await fs.readFile(path)
		return JSON.parse(textDecoder.decode(bytes)) as T
	} catch (error) {
		if (isMissing(error)) return undefined
		throw error
	}
}

async function writeJson(fs: FsLike, path: string, value: unknown): Promise<void> {
	await fs.writeFile(path, textEncoder.encode(`${JSON.stringify(value, null, '\t')}\n`))
}

async function readdirSafe(fs: FsLike, path: string): Promise<string[]> {
	try {
		return await fs.readdir(path)
	} catch (error) {
		if (isMissing(error)) return []
		throw error
	}
}

export async function createFsWorldStore(options: FsWorldStoreOptions): Promise<WorldStore> {
	const fs = await loadFs()
	const payloads = resolvePayloadCodec(options)
	const root = options.root.replace(/\/+$/, '')
	const worldsDir = `${root}/worlds`
	const settingsPath = `${root}/settings.json`
	let closed = false

	const alive = (): void => {
		if (closed) throw closedError()
	}
	const worldDir = (worldId: string): string => `${worldsDir}/${encodeURIComponent(worldId)}`
	const chunksDir = (worldId: string): string => `${worldDir(worldId)}/chunks`
	const chunkPath = (worldId: string, cx: number, cz: number): string =>
		`${chunksDir(worldId)}/chunk.${cx}.${cz}.bin`

	await fs.mkdir(worldsDir, { recursive: true })

	return {
		async listWorlds(): Promise<readonly SaveMeta[]> {
			alive()
			const names = await readdirSafe(fs, worldsDir)
			const metas: SaveMeta[] = []
			for (const name of names) {
				const meta = await readJson<SaveMeta>(fs, `${worldsDir}/${name}/meta.json`)
				if (meta !== undefined) metas.push(meta)
			}
			return sortWorldMetas(metas)
		},

		async putMeta(meta: SaveMeta): Promise<void> {
			alive()
			await fs.mkdir(worldDir(meta.worldId), { recursive: true })
			await writeJson(fs, `${worldDir(meta.worldId)}/meta.json`, meta)
		},

		async getMeta(worldId: string): Promise<SaveMeta | undefined> {
			alive()
			return readJson<SaveMeta>(fs, `${worldDir(worldId)}/meta.json`)
		},

		async deleteWorld(worldId: string): Promise<void> {
			alive()
			await fs.rm(worldDir(worldId), { recursive: true, force: true })
		},

		async getChunk(worldId: string, cx: number, cz: number): Promise<Uint8Array | undefined> {
			alive()
			assertChunkPos(cx, cz)
			try {
				const stored = await fs.readFile(chunkPath(worldId, cx, cz))
				return await payloads.decode(new Uint8Array(stored))
			} catch (error) {
				if (isMissing(error)) return undefined
				throw error
			}
		},

		async putChunks(
			worldId: string,
			entries: readonly { cx: number; cz: number; data: Uint8Array }[],
		): Promise<void> {
			alive()
			if (entries.length === 0) return
			await fs.mkdir(chunksDir(worldId), { recursive: true })
			const staged: { temp: string; final: string }[] = []
			for (const entry of entries) {
				assertChunkPos(entry.cx, entry.cz)
				const final = chunkPath(worldId, entry.cx, entry.cz)
				const temp = `${final}.tmp`
				await fs.writeFile(temp, await payloads.encode(entry.data))
				staged.push({ temp, final })
			}
			// Stage the whole batch first, then publish: a failure part-way through
			// leaves the previous save readable instead of a half-written chunk.
			for (const item of staged) {
				await fs.rename(item.temp, item.final)
			}
		},

		async listChunkKeys(worldId: string): Promise<readonly ChunkPos[]> {
			alive()
			const names = await readdirSafe(fs, chunksDir(worldId))
			const positions: ChunkPos[] = []
			for (const name of names) {
				const match = CHUNK_FILE.exec(name)
				if (match === null) continue
				positions.push({ cx: Number.parseInt(match[1], 10), cz: Number.parseInt(match[2], 10) })
			}
			return sortChunkPositions(positions)
		},

		async getPlayer(worldId: string): Promise<PlayerSave | undefined> {
			alive()
			return readJson<PlayerSave>(fs, `${worldDir(worldId)}/player.json`)
		},

		async putPlayer(worldId: string, player: PlayerSave): Promise<void> {
			alive()
			await fs.mkdir(worldDir(worldId), { recursive: true })
			await writeJson(fs, `${worldDir(worldId)}/player.json`, player)
		},

		async getSettings(): Promise<GameSettings | undefined> {
			alive()
			return readJson<GameSettings>(fs, settingsPath)
		},

		async putSettings(settings: GameSettings): Promise<void> {
			alive()
			await fs.mkdir(root, { recursive: true })
			await writeJson(fs, settingsPath, settings)
		},

		async close(): Promise<void> {
			closed = true
		},
	}
}
