/**
 * VoxelCraft browser entry point.
 *
 * The app is a thin shell over the real packages:
 *  - `@voxelcraft/world` generates every chunk (biomes, caves, ores, features)
 *  - `@voxelcraft/sim` owns the fixed 20 Hz tick: fluids, light, physics and the
 *    voxel raycast the crosshair uses
 *  - `@voxelcraft/gameplay` owns blocks, items, crafting, the inventory and the
 *    IndexedDB save
 *  - `@voxelcraft/client` owns meshing workers, rendering, audio and the UI
 *
 * What is left in this file is input, streaming policy, and the `window.__vc`
 * automation hooks the E2E suite drives.
 */
import {
	BLOCK,
	CHUNK_X,
	CHUNK_Z,
	GAME_MODE,
	PERF,
	PHYSICS,
	SECTIONS_PER_CHUNK,
	SECTION_Y,
	chunkKey,
	sectionKey,
	worldToChunk,
	type BlockId,
	type GameSettings,
	type RayHit,
	type VoxelView,
} from '@voxelcraft/core-types'
import {
	VoxelRenderer,
	createAudio,
	createMesherPool,
	createUi,
	fallbackAtlas,
	type AudioHandle,
	type MesherPool,
	type UiDebugInfo,
	type UiHandle,
	type UiHost,
	type UiScreen,
	type UiSettings,
	type UiWorldEntry,
} from '@voxelcraft/client'
import {
	BLOCKS,
	addStack,
	craftFromInventory,
	heldStack,
	isCreative,
	makeStack,
	removeItem,
	selectHotbar,
	swapCursorWithSlot,
} from '@voxelcraft/gameplay'
import { aabbOverlaps, isReplaceableBlock, raycastVoxels, voxelBox } from '@voxelcraft/sim'
import { loadGameAssets, type GameAssets } from './assets'
import { PlayerRuntime } from './player'
import { buildSnapshot, createCreativeInventory, heldBlockId } from './ui-bridge'
import { ChunkWorld } from './world/chunkWorld'
import { createSaveMeta, openWorldPersistence } from './world/store'

const DEFAULT_SEED = 20260916
const DAY_LENGTH_SECONDS = 600
const AUTOSAVE_SECONDS = 15
const UI_INTERVAL_SECONDS = 0.1
const SECTION_SYNC_SECONDS = 0.25
/** Vertical band of sections kept around the camera. */
const VERTICAL_BAND = 3
const REQUESTS_PER_FRAME = 3
const TERRAIN_PER_FRAME = 2
const DECORATE_PER_FRAME = 1
/** Saved chunks restored before the first frame; beyond that only nearby ones. */
const PRELOAD_LIMIT = 256
const MAX_FRAME_SECONDS = 0.05

/** Fluids are meshed but never targeted by the crosshair. */
const FLUID_BLOCKS: readonly BlockId[] = [
	BLOCK.WATER,
	BLOCK.LAVA,
	BLOCK.WATER_FLOWING,
	BLOCK.LAVA_FLOWING,
]

interface VcState {
	screen: UiScreen
	seed: number
	worldId: string
	x: number
	y: number
	z: number
	chunks: number
	quads: number
	drawCalls: number
	fps: number
	tick: number
	renderDistance: number
}

interface VcTestApi {
	ready: Promise<void>
	state(): VcState
	getBlock(x: number, y: number, z: number): number
	breakBlock(x: number, y: number, z: number): void
	placeBlock(x: number, y: number, z: number, id: number): void
	save(): Promise<void>
	hash(): number
	errors: string[]
}

declare global {
	interface Window {
		__vc?: VcTestApi
	}
}

function numberParam(params: URLSearchParams, key: string): number | null {
	const raw = params.get(key)
	if (raw === null) return null
	const value = Number(raw)
	return Number.isFinite(value) ? value : null
}

function clampDistance(value: number): number {
	return Math.max(PERF.renderDistanceMin, Math.min(PERF.renderDistanceMax, Math.round(value)))
}

function worldIdFromName(name: string): string {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
	return slug === '' ? `world-${Date.now()}` : slug
}

/** Blocks that use the wooden dig sound. */
const WOOD_BLOCKS: readonly BlockId[] = [
	BLOCK.OAK_LOG,
	BLOCK.OAK_LEAVES,
	BLOCK.OAK_SAPLING,
	BLOCK.PLANKS,
	BLOCK.CRAFTING_TABLE,
	BLOCK.CHEST,
	BLOCK.LADDER,
]

async function boot(assets: GameAssets): Promise<void> {
	const params = new URLSearchParams(window.location.search)
	const testMode = params.get('test') === '1'
	const errors: string[] = []

	const canvas = document.getElementById('game-canvas')
	if (!(canvas instanceof HTMLCanvasElement)) throw new Error('#game-canvas is missing')
	const uiRoot = document.getElementById('ui-root')

	const requestedSeed = numberParam(params, 'seed')
	const worldId =
		params.get('world') ?? (testMode ? `e2e-${(requestedSeed ?? DEFAULT_SEED) >>> 0}` : 'default')

	// --- persistence --------------------------------------------------------

	const persistence = await openWorldPersistence({ worldId })
	const meta = await persistence.loadMeta()
	const savedPlayer = await persistence.loadPlayer()
	const storedSettings = await persistence.loadSettings()
	const seed = (requestedSeed ?? meta?.seed ?? DEFAULT_SEED) >>> 0

	const settings: GameSettings = { ...storedSettings }
	const requestedDistance = numberParam(params, 'rd')
	if (requestedDistance !== null) settings.renderDistance = clampDistance(requestedDistance)
	else if (testMode) settings.renderDistance = PERF.e2eRenderDistance

	const width = numberParam(params, 'w') ?? (testMode ? PERF.e2eCanvasWidth : window.innerWidth)
	const height = numberParam(params, 'h') ?? (testMode ? PERF.e2eCanvasHeight : window.innerHeight)
	if (testMode) {
		canvas.style.width = `${width}px`
		canvas.style.height = `${height}px`
	}

	// --- world --------------------------------------------------------------

	const savedKeys = new Set<string>()
	for (const pos of await persistence.chunkKeys()) savedKeys.add(chunkKey(pos.cx, pos.cz))

	const world = new ChunkWorld({
		seed,
		source: {
			has: (cx: number, cz: number) => savedKeys.has(chunkKey(cx, cz)),
			load: (cx: number, cz: number) => persistence.loadChunk(cx, cz),
		},
	})

	const spawnCx = worldToChunk(Math.floor(savedPlayer?.position.x ?? CHUNK_X / 2))
	const spawnCz = worldToChunk(Math.floor(savedPlayer?.position.z ?? CHUNK_Z / 2))

	// Saved chunks are authoritative, so they are restored before anything is
	// generated: a reload must never regenerate over a player edit.
	const restoreEverything = savedKeys.size <= PRELOAD_LIMIT
	const restores: Promise<boolean>[] = []
	for (const key of savedKeys) {
		const parts = key.split(',')
		const cx = Number(parts[0])
		const cz = Number(parts[1])
		if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue
		const near =
			Math.max(Math.abs(cx - spawnCx), Math.abs(cz - spawnCz)) <= settings.renderDistance + 2
		if (!restoreEverything && !near) continue
		restores.push(world.restoreFromStore(cx, cz))
	}
	if (restores.length > 0) {
		await Promise.all(restores)
		world.stitchLight()
	}

	world.ensureDecorated(spawnCx, spawnCz)
	const spawn =
		savedPlayer?.position ??
		world.findSpawn(spawnCx * CHUNK_X + CHUNK_X / 2, spawnCz * CHUNK_Z + CHUNK_Z / 2)

	const gameMode = savedPlayer?.gameMode ?? meta?.gameMode ?? GAME_MODE.Creative

	const player = new PlayerRuntime({
		world,
		spawn: {
			x: spawn.x,
			y: spawn.y,
			z: spawn.z,
			yaw: savedPlayer?.yaw ?? 0,
			pitch: savedPlayer?.pitch ?? 0,
		},
		inventory: savedPlayer?.inventory ?? createCreativeInventory(),
		gameMode,
		health: savedPlayer?.health,
		tick: savedPlayer?.tick,
		respawn: savedPlayer?.respawn ?? null,
		// Under test the player stands still, so the screenshot and the saved
		// position survive a reload unchanged. Fluids and light still tick.
		simulatePlayer: !testMode,
	})

	// --- client -------------------------------------------------------------

	const renderer = new VoxelRenderer({
		canvas,
		width,
		height,
		renderDistance: settings.renderDistance,
		fov: settings.fov,
		atlas: assets.atlas,
	})
	renderer.camera.rotation.order = 'YXZ'

	// Workers are skipped under test so a worker load failure can never turn into
	// a console error; meshing then happens inline on the main thread.
	const pool: MesherPool = createMesherPool({ inline: testMode })
	const audio: AudioHandle = createAudio({
		manifest: assets.sounds,
		baseUrl: './',
		volume: settings.volume,
	})

	let screen: UiScreen = 'playing'
	let needsSectionSync = true

	/** Raycast view where plants and torches are pickable but fluids are not. */
	const targetView: VoxelView = {
		...world.voxels,
		isSolid: (x: number, y: number, z: number): boolean => {
			const id = world.blockAt(x, y, z)
			return id !== BLOCK.AIR && !FLUID_BLOCKS.includes(id)
		},
	}

	const playSound = (name: string): void => {
		audio.play(name)
	}

	// --- editing ------------------------------------------------------------

	const breakAt = (x: number, y: number, z: number): boolean => {
		const bx = Math.floor(x)
		const by = Math.floor(y)
		const bz = Math.floor(z)
		const previous = world.blockAt(bx, by, bz)
		if (previous === BLOCK.AIR) return false
		const definition = BLOCKS.tryById(previous)
		// A negative hardness is the contract's "unbreakable", such as bedrock.
		if (definition === undefined || definition.hardness < 0) return false
		if (!world.setBlock(bx, by, bz, BLOCK.AIR)) return false
		if (!isCreative(gameMode)) {
			const itemId = definition.itemId ?? null
			if (itemId !== null) addStack(player.inventory, makeStack(itemId, 1))
		}
		needsSectionSync = true
		playSound(WOOD_BLOCKS.includes(previous) ? 'dig_wood' : 'dig_stone')
		return true
	}

	const placeAt = (x: number, y: number, z: number, id: BlockId): boolean => {
		if (id === BLOCK.AIR) return false
		const definition = BLOCKS.tryById(id)
		if (definition === undefined) return false
		const bx = Math.floor(x)
		const by = Math.floor(y)
		const bz = Math.floor(z)
		const current = world.blockAt(bx, by, bz)
		if (current !== BLOCK.AIR && !isReplaceableBlock(current)) return false
		// Never seal the player inside a block. `aabbOverlaps` is strict, so a block
		// placed against the feet or the head still fits.
		if (definition.solid && aabbOverlaps(player.box(), voxelBox(bx, by, bz))) return false
		if (!world.setBlock(bx, by, bz, id)) return false
		if (!isCreative(gameMode)) {
			const held = heldStack(player.inventory)
			if (held !== null) removeItem(player.inventory, held.item, 1)
		}
		needsSectionSync = true
		playSound('place_generic')
		return true
	}

	const targeted = (): RayHit | null =>
		raycastVoxels(player.eye(), player.lookDirection(), PHYSICS.reach, targetView)

	const breakTargeted = (): void => {
		const hit = targeted()
		if (hit === null) return
		breakAt(hit.block.x, hit.block.y, hit.block.z)
	}

	const placeTargeted = (): void => {
		const hit = targeted()
		if (hit === null) return
		const id = heldBlockId(player.inventory)
		if (id === null) return
		placeAt(hit.block.x + hit.normal.x, hit.block.y + hit.normal.y, hit.block.z + hit.normal.z, id)
	}

	// --- section streaming --------------------------------------------------

	/** Section key -> revision already handed to the mesher pool. */
	const requested = new Map<string, number>()

	const syncSections = (): void => {
		const centerCx = worldToChunk(Math.floor(player.x))
		const centerCz = worldToChunk(Math.floor(player.z))
		const centerSy = Math.floor(player.y / SECTION_Y)
		const distance = renderer.getRenderDistance()
		const wanted = new Set<string>()
		const todo: { cx: number; cz: number; sy: number; cost: number }[] = []

		for (let cx = centerCx - distance; cx <= centerCx + distance; cx++) {
			for (let cz = centerCz - distance; cz <= centerCz + distance; cz++) {
				if (!world.hasTerrain(cx, cz)) continue
				for (let sy = centerSy - VERTICAL_BAND; sy <= centerSy + VERTICAL_BAND; sy++) {
					if (sy < 0 || sy >= SECTIONS_PER_CHUNK) continue
					const key = sectionKey(cx, cz, sy)
					wanted.add(key)
					if (world.isSectionEmpty(cx, cz, sy)) continue
					if (requested.get(key) === world.revisionOf(cx, cz, sy)) continue
					const dx = cx - centerCx
					const dz = cz - centerCz
					const dy = sy - centerSy
					todo.push({ cx, cz, sy, cost: dx * dx + dz * dz + dy * dy })
				}
			}
		}

		for (const key of [...requested.keys()]) {
			if (wanted.has(key)) continue
			requested.delete(key)
			pool.cancel(key)
			renderer.removeSection(key)
		}

		// Nearest first, so the view around the camera fills in before the edges.
		todo.sort((a, b) => a.cost - b.cost)
		for (const item of todo.slice(0, REQUESTS_PER_FRAME)) {
			const request = world.buildMeshRequest(item.cx, item.cz, item.sy)
			requested.set(request.key, request.revision)
			pool.request(request, (response) => {
				if (response.type === 'mesh') {
					renderer.enqueue(response.result)
					return
				}
				if (response.type === 'error') {
					errors.push(`mesher: ${response.message}`)
					console.warn('[voxelcraft] mesher error', response.message)
				}
			})
		}
		needsSectionSync = todo.length > REQUESTS_PER_FRAME
	}

	// --- saving --------------------------------------------------------------

	let worlds: readonly UiWorldEntry[] = []

	const refreshWorlds = async (): Promise<void> => {
		const list = await persistence.listWorlds()
		worlds = list.map((entry) => ({
			worldId: entry.worldId,
			name: entry.name,
			seed: entry.seed,
			lastPlayedAt: entry.lastPlayedAt,
		}))
	}
	await refreshWorlds()

	let saving: Promise<void> | null = null

	/** Single flight: a second call joins the write already in progress. */
	const saveWorld = (): Promise<void> => {
		if (saving !== null) return saving
		const run = async (): Promise<void> => {
			const chunks = world.savePayloads()
			await persistence.save({
				meta: createSaveMeta({
					worldId,
					name: meta?.name,
					seed,
					createdAt: meta?.createdAt,
					gameMode,
					generatorVersion: world.generator.version,
				}),
				player: player.save(),
				settings,
				chunks,
			})
			for (const payload of chunks) savedKeys.add(chunkKey(payload.cx, payload.cz))
			await refreshWorlds()
		}
		const pending = run()
			.catch((error: unknown) => {
				errors.push(`save: ${String(error)}`)
				console.warn('[voxelcraft] save failed:', error)
			})
			.finally(() => {
				saving = null
			})
		saving = pending
		return pending
	}

	// --- ui ------------------------------------------------------------------

	const gotoWorld = (id: string, worldSeed: number): void => {
		const next = new URLSearchParams(window.location.search)
		next.set('world', id)
		next.set('seed', String(worldSeed >>> 0))
		window.location.search = `?${next.toString()}`
	}

	const applySetting = (key: keyof UiSettings, value: number | boolean): void => {
		if (key === 'showDebug') {
			settings.showDebug = value === true
			return
		}
		if (typeof value !== 'number' || !Number.isFinite(value)) return
		if (key === 'renderDistance') {
			settings.renderDistance = clampDistance(value)
			renderer.setRenderDistance(settings.renderDistance)
			needsSectionSync = true
			return
		}
		if (key === 'fov') {
			settings.fov = value
			renderer.setFov(value)
			return
		}
		if (key === 'sensitivity') {
			settings.sensitivity = value
			return
		}
		settings.volume = value
		audio.setVolume(value)
	}

	const host: UiHost = {
		onSelectHotbar(index: number): void {
			selectHotbar(player.inventory, index)
		},
		onToggleInventory(): void {
			screen = screen === 'inventory' ? 'playing' : 'inventory'
		},
		onCloseScreen(): void {
			screen = 'playing'
		},
		onResume(): void {
			screen = 'playing'
		},
		onOpenSettings(): void {
			screen = 'settings'
		},
		onChangeSetting(key: keyof UiSettings, value: number | boolean): void {
			applySetting(key, value)
		},
		onCreateWorld(name: string, newSeed: number): void {
			const go = async (): Promise<void> => {
				await saveWorld()
				gotoWorld(worldIdFromName(name), newSeed)
			}
			void go().catch((error: unknown) => {
				console.warn('[voxelcraft] world create failed:', error)
			})
		},
		onSelectWorld(id: string): void {
			const go = async (): Promise<void> => {
				await saveWorld()
				const target = await persistence.loadMeta(id)
				gotoWorld(id, target?.seed ?? seed)
			}
			void go().catch((error: unknown) => {
				console.warn('[voxelcraft] world switch failed:', error)
			})
		},
		onDeleteWorld(id: string): void {
			void persistence
				.deleteWorld(id)
				.then(refreshWorlds)
				.catch((error: unknown) => {
					console.warn('[voxelcraft] world delete failed:', error)
				})
		},
		onSave(): void {
			void saveWorld()
		},
		onQuit(): void {
			void saveWorld()
			screen = 'title'
		},
		onCraft(): void {
			if (craftFromInventory(player.inventory) !== null) playSound('place_generic')
		},
		onMoveStack(from: number, to: number): void {
			// Pick the stack up, then put it down: the cursor is the UI's clipboard.
			swapCursorWithSlot(player.inventory, from)
			swapCursorWithSlot(player.inventory, to)
		},
		onPlaySound(name: string): void {
			playSound(name)
		},
	}

	const ui: UiHandle | null = uiRoot === null ? null : createUi(uiRoot, host)

	const pushUi = (): void => {
		if (ui === null) return
		const stats = renderer.stats()
		const debug: UiDebugInfo = {
			fps: Math.round(stats.fps),
			x: player.x,
			y: player.y,
			z: player.z,
			yaw: player.yaw,
			pitch: player.pitch,
			biome: world.biomeNameAt(Math.floor(player.x), Math.floor(player.z)),
			chunks: world.loadedChunks,
			drawCalls: stats.drawCalls,
			quads: stats.quads,
			// Every quad the greedy mesher emits is two triangles.
			triangles: stats.quads * 2,
			renderDistance: renderer.getRenderDistance(),
		}
		ui.update(
			buildSnapshot({
				screen,
				health: player.health,
				maxHealth: player.maxHealth,
				hunger: 20,
				inventory: player.inventory,
				debug,
				settings,
				worlds,
			}),
		)
	}

	// --- input ---------------------------------------------------------------

	const pressed = new Set<string>()
	const PITCH_LIMIT = Math.PI / 2 - 0.001

	const readMove = (): void => {
		if (screen !== 'playing') {
			player.clearMove()
			return
		}
		player.setMove({
			forward: (pressed.has('KeyW') ? 1 : 0) - (pressed.has('KeyS') ? 1 : 0),
			strafe: (pressed.has('KeyD') ? 1 : 0) - (pressed.has('KeyA') ? 1 : 0),
			jump: pressed.has('Space'),
			sprint: pressed.has('ShiftLeft') || pressed.has('ShiftRight'),
			sneak: pressed.has('ControlLeft') || pressed.has('ControlRight'),
		})
	}

	window.addEventListener('keydown', (event) => {
		pressed.add(event.code)
	})
	window.addEventListener('keyup', (event) => {
		pressed.delete(event.code)
	})
	window.addEventListener('blur', () => {
		pressed.clear()
		player.clearMove()
	})
	canvas.addEventListener('mousedown', (event) => {
		if (testMode || screen !== 'playing') return
		if (document.pointerLockElement !== canvas) {
			void canvas.requestPointerLock()
			return
		}
		if (event.button === 2) placeTargeted()
		else breakTargeted()
	})
	canvas.addEventListener('contextmenu', (event) => {
		event.preventDefault()
	})
	window.addEventListener('mousemove', (event) => {
		if (document.pointerLockElement !== canvas) return
		player.yaw -= event.movementX * settings.sensitivity
		player.pitch = Math.max(
			-PITCH_LIMIT,
			Math.min(PITCH_LIMIT, player.pitch - event.movementY * settings.sensitivity),
		)
	})
	window.addEventListener('resize', () => {
		if (testMode) return
		renderer.resize(window.innerWidth, window.innerHeight)
	})
	window.addEventListener('error', (event) => {
		errors.push(String(event.message))
	})
	window.addEventListener('unhandledrejection', () => {
		errors.push('unhandledrejection')
	})

	// --- frame loop ----------------------------------------------------------

	let lastFrame = performance.now()
	let elapsed = 0
	let sinceUi = 0
	let sinceSave = 0
	let sinceSync = 0
	let ready = false
	let resolveReady: () => void = () => {}
	const readyPromise = new Promise<void>((resolve) => {
		resolveReady = resolve
	})

	const frame = (): void => {
		const now = performance.now()
		const dt = Math.min((now - lastFrame) / 1000, MAX_FRAME_SECONDS)
		lastFrame = now
		elapsed += dt
		sinceUi += dt
		sinceSave += dt
		sinceSync += dt

		readMove()
		player.advance(dt * 1000)

		if (
			world.stream(
				worldToChunk(Math.floor(player.x)),
				worldToChunk(Math.floor(player.z)),
				renderer.getRenderDistance(),
				{
					terrain: TERRAIN_PER_FRAME,
					decorate: DECORATE_PER_FRAME,
				},
			)
		) {
			needsSectionSync = true
		}
		world.pumpDirty()

		if (needsSectionSync || sinceSync >= SECTION_SYNC_SECONDS) {
			sinceSync = 0
			syncSections()
		}

		const eye = player.eye()
		renderer.camera.position.set(eye.x, eye.y, eye.z)
		renderer.camera.rotation.set(player.pitch, player.yaw, 0)
		// Test mode freezes the sun at noon so screenshots are comparable.
		renderer.setTimeOfDay(testMode ? 0.5 : (elapsed % DAY_LENGTH_SECONDS) / DAY_LENGTH_SECONDS)
		renderer.setUnderwater(player.inWater)
		renderer.flushUploads(PERF.uploadsPerFrame)
		renderer.render(dt)

		if (sinceUi >= UI_INTERVAL_SECONDS) {
			sinceUi = 0
			pushUi()
		}
		if (!testMode && sinceSave >= AUTOSAVE_SECONDS) {
			sinceSave = 0
			void saveWorld()
		}
		// Ready once the first geometry is on screen; the timeout keeps the promise
		// from hanging if the camera happens to look at nothing but air.
		if (!ready && (renderer.stats().quads > 0 || elapsed > 5)) {
			ready = true
			resolveReady()
		}
		requestAnimationFrame(frame)
	}

	// --- automation hooks ----------------------------------------------------

	const api: VcTestApi = {
		ready: readyPromise,
		state(): VcState {
			const stats = renderer.stats()
			return {
				screen,
				seed,
				worldId,
				x: player.x,
				y: player.y,
				z: player.z,
				chunks: world.loadedChunks,
				quads: stats.quads,
				drawCalls: stats.drawCalls,
				fps: Math.round(stats.fps),
				tick: player.tick,
				renderDistance: renderer.getRenderDistance(),
			}
		},
		getBlock(x: number, y: number, z: number): number {
			return world.blockAt(Math.floor(x), Math.floor(y), Math.floor(z))
		},
		breakBlock(x: number, y: number, z: number): void {
			breakAt(x, y, z)
		},
		placeBlock(x: number, y: number, z: number, id: number): void {
			placeAt(x, y, z, (id | 0) as BlockId)
		},
		save(): Promise<void> {
			return saveWorld()
		},
		hash(): number {
			return world.stateHash()
		},
		errors,
	}
	window.__vc = api

	syncSections()
	pushUi()
	requestAnimationFrame(frame)
}

async function start(): Promise<void> {
	let assets: GameAssets
	try {
		assets = await loadGameAssets()
	} catch (error) {
		console.warn('[voxelcraft] asset loading failed, using fallbacks:', error)
		assets = { atlas: fallbackAtlas(), sounds: null }
	}
	await boot(assets)
	window.dispatchEvent(
		new CustomEvent('voxelcraft.assetsReady', {
			detail: { generated: assets.atlas.generated, sounds: assets.sounds !== null },
		}),
	)
}

void start().catch((error: unknown) => {
	console.warn('[voxelcraft] boot failed:', error)
})
