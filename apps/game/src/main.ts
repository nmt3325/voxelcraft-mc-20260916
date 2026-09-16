import {
	BLOCK,
	CHUNK_Y,
	EVENT,
	PERF,
	SECTION_Y,
	sectionKey,
	type GameSettings,
} from '@voxelcraft/core-types'
import {
	VoxelRenderer,
	appearanceOf,
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
import { loadGameAssets, type GameAssets } from './assets'
import { raycastVoxels, type RaycastHit, type Vec3 } from './raycast'
import { HOTBAR, buildSnapshot, hotbarBlockId } from './ui-bridge'
import { LocalWorld } from './world/localWorld'
import { DEFAULT_SETTINGS, createWorldStore, type WorldRecord } from './world/store'

/**
 * Game entry point: world -> mesher pool -> renderer, plus input, UI, audio and
 * saving.
 *
 * The UI and audio layers live in `@voxelcraft/client` (UI/QA subtree); this
 * file owns the game state and adapts it into their contracts, and exposes the
 * `window.__vc` automation hooks the E2E suite drives.
 */

const DEFAULT_SEED = 20260916
const PLAYER_HALF = 0.3
const PLAYER_HEIGHT = 1.8
const PLAYER_EYE = 1.62
const REACH = 5.5
const GRAVITY = 26
const JUMP_SPEED = 8.6
const WALK_SPEED = 4.6
const SPRINT_SPEED = 7.2
const DAY_LENGTH_SECONDS = 600
const AUTOSAVE_SECONDS = 15
const UI_INTERVAL_SECONDS = 0.1
const SECTIONS_PER_COLUMN = CHUNK_Y / SECTION_Y
const VERTICAL_BAND = 3
const REQUESTS_PER_FRAME = 3

/** Mirrors `VcState` in tests/e2e/src/harness.ts. */
interface VcState {
	screen: string
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

/** Mirrors `VcTestApi` in tests/e2e/src/harness.ts. */
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

function queryParams(): URLSearchParams {
	return new URLSearchParams(window.location.search)
}

function numberParam(params: URLSearchParams, name: string): number | null {
	const raw = params.get(name)
	if (raw === null) return null
	const value = Number(raw)
	return Number.isFinite(value) ? value : null
}

/** Blocks that stop movement: full cubes that are not fluids. */
function blocksMovement(id: number): boolean {
	if (id === BLOCK.AIR) return false
	if (id === BLOCK.WATER || id === BLOCK.WATER_FLOWING) return false
	if (id === BLOCK.LAVA || id === BLOCK.LAVA_FLOWING) return false
	const appearance = appearanceOf(id)
	return appearance !== null && appearance.fullCube
}

/** Blocks the crosshair can target. */
function targetable(id: number): boolean {
	if (id === BLOCK.AIR) return false
	if (id === BLOCK.WATER || id === BLOCK.WATER_FLOWING) return false
	return appearanceOf(id) !== null
}

function main(assets: GameAssets): void {
	const params = queryParams()
	const testMode = params.get('test') === '1'
	const errors: string[] = []

	const canvas = document.getElementById('game-canvas')
	if (!(canvas instanceof HTMLCanvasElement)) {
		throw new Error('#game-canvas is missing')
	}

	// --- world and settings -------------------------------------------------

	const store = createWorldStore()
	const requestedSeed = numberParam(params, 'seed')
	const worldId =
		params.get('world') ?? (testMode && requestedSeed !== null ? `e2e-${requestedSeed}` : 'default')
	const saved = store.load(worldId)
	const seed = requestedSeed ?? saved?.seed ?? DEFAULT_SEED
	const world = new LocalWorld(seed)
	if (saved !== null) world.applyEdits(saved.edits)

	const settings: GameSettings = {
		...DEFAULT_SETTINGS,
		...(saved?.settings ?? {}),
		renderDistance:
			numberParam(params, 'rd') ??
			(testMode
				? PERF.e2eRenderDistance
				: (saved?.settings.renderDistance ?? DEFAULT_SETTINGS.renderDistance)),
	}

	const width = numberParam(params, 'w') ?? (testMode ? PERF.e2eCanvasWidth : window.innerWidth)
	const height = numberParam(params, 'h') ?? (testMode ? PERF.e2eCanvasHeight : window.innerHeight)

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

	const spawnX = 8
	const spawnZ = 8
	const player = {
		x: saved?.player.x ?? spawnX + 0.5,
		y: saved?.player.y ?? world.spawnHeight(spawnX, spawnZ),
		z: saved?.player.z ?? spawnZ + 0.5,
		yaw: saved?.player.yaw ?? 0,
		pitch: saved?.player.pitch ?? -0.2,
		vy: 0,
		onGround: false,
		health: saved?.player.health ?? 20,
		hunger: saved?.player.hunger ?? 20,
		hotbar: saved?.player.hotbar ?? 0,
	}

	const requested = new Map<string, number>()
	const keys = new Set<string>()
	let needsSectionSync = true
	let ready = false
	let tick = 0
	let screen: UiScreen = testMode ? 'playing' : 'title'
	let resolveReady = (): void => {}
	const whenReady = new Promise<void>((resolve) => {
		resolveReady = resolve
	})

	const listWorlds = (): UiWorldEntry[] =>
		store
			.list()
			.map((record) => ({
				worldId: record.name,
				name: record.name,
				seed: record.seed,
				lastPlayedAt: record.updatedAt,
			}))
			.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
	let worlds: readonly UiWorldEntry[] = listWorlds()

	const notify = (name: string, detail: Record<string, unknown>): void => {
		window.dispatchEvent(new CustomEvent(name, { detail }))
	}

	/** The UI uses dotted sound names; the generated manifest uses underscores. */
	const playSound = (name: string): void => {
		const sound = name.replace(/\./g, '_')
		audio.play(sound)
		notify(EVENT.SoundPlay, { sound })
	}

	// --- section streaming --------------------------------------------------

	const syncSections = (): void => {
		const centreX = Math.floor(player.x / SECTION_Y)
		const centreZ = Math.floor(player.z / SECTION_Y)
		const centreY = Math.floor(player.y / SECTION_Y)
		const distance = renderer.getRenderDistance()
		const wanted = new Set<string>()
		const todo: Array<{ cx: number; sy: number; cz: number; cost: number }> = []

		for (let cx = centreX - distance; cx <= centreX + distance; cx++) {
			for (let cz = centreZ - distance; cz <= centreZ + distance; cz++) {
				for (let sy = centreY - VERTICAL_BAND; sy <= centreY + VERTICAL_BAND; sy++) {
					if (sy < 0 || sy >= SECTIONS_PER_COLUMN) continue
					const key = sectionKey(cx, sy, cz)
					wanted.add(key)
					const revision = world.revisionOf(cx, sy, cz)
					if (requested.get(key) === revision) continue
					todo.push({
						cx,
						sy,
						cz,
						cost: Math.abs(cx - centreX) + Math.abs(cz - centreZ) + Math.abs(sy - centreY) * 2,
					})
				}
			}
		}

		for (const key of [...requested.keys()]) {
			if (wanted.has(key)) continue
			requested.delete(key)
			pool.cancel(key)
			renderer.removeSection(key)
		}

		todo.sort((a, b) => a.cost - b.cost)
		for (const item of todo.slice(0, REQUESTS_PER_FRAME)) {
			const request = world.buildMeshRequest(item.cx, item.sy, item.cz)
			requested.set(request.key, request.revision)
			pool.request(request, (response) => {
				if (response.type === 'mesh') {
					renderer.enqueue(response.result)
					notify(EVENT.ChunkMeshed, {
						key: response.result.key,
						quads: response.result.stats.quads,
					})
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

	// --- editing ------------------------------------------------------------

	const intersectsPlayer = (at: Vec3): boolean =>
		at.x === Math.floor(player.x) &&
		at.z === Math.floor(player.z) &&
		(at.y === Math.floor(player.y) || at.y === Math.floor(player.y + PLAYER_HEIGHT - 0.01))

	const pick = (): RaycastHit | null => {
		const cosPitch = Math.cos(player.pitch)
		const direction: Vec3 = {
			x: -Math.sin(player.yaw) * cosPitch,
			y: Math.sin(player.pitch),
			z: -Math.cos(player.yaw) * cosPitch,
		}
		const eye: Vec3 = { x: player.x, y: player.y + PLAYER_EYE, z: player.z }
		return raycastVoxels(eye, direction, REACH, (x, y, z) => targetable(world.blockAt(x, y, z)))
	}

	const editAt = (at: Vec3, id: number): boolean => {
		if (!world.setBlock(at.x, at.y, at.z, id)) return false
		needsSectionSync = true
		syncSections()
		return true
	}

	const breakAt = (x: number, y: number, z: number): boolean => {
		const at: Vec3 = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) }
		const previous = world.blockAt(at.x, at.y, at.z)
		if (previous === BLOCK.AIR || previous === BLOCK.BEDROCK) return false
		if (!editAt(at, BLOCK.AIR)) return false
		playSound(previous === BLOCK.OAK_LOG ? 'dig_wood' : 'dig_stone')
		return true
	}

	const placeAt = (x: number, y: number, z: number, id: number): boolean => {
		const at: Vec3 = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) }
		// Never seal the player inside a block.
		if (blocksMovement(id) && intersectsPlayer(at)) return false
		if (!editAt(at, id)) return false
		playSound('place_generic')
		return true
	}

	const breakTargeted = (): void => {
		const hit = pick()
		if (hit !== null) breakAt(hit.block.x, hit.block.y, hit.block.z)
	}

	const placeTargeted = (): void => {
		const hit = pick()
		if (hit !== null) placeAt(hit.place.x, hit.place.y, hit.place.z, hotbarBlockId(player.hotbar))
	}

	// --- movement -----------------------------------------------------------

	const collides = (x: number, y: number, z: number): boolean => {
		const minX = Math.floor(x - PLAYER_HALF)
		const maxX = Math.floor(x + PLAYER_HALF)
		const minY = Math.floor(y)
		const maxY = Math.floor(y + PLAYER_HEIGHT - 0.01)
		const minZ = Math.floor(z - PLAYER_HALF)
		const maxZ = Math.floor(z + PLAYER_HALF)
		for (let bx = minX; bx <= maxX; bx++) {
			for (let by = minY; by <= maxY; by++) {
				for (let bz = minZ; bz <= maxZ; bz++) {
					if (blocksMovement(world.blockAt(bx, by, bz))) return true
				}
			}
		}
		return false
	}

	const move = (dt: number): void => {
		const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight')
		const speed = (sprint ? SPRINT_SPEED : WALK_SPEED) * dt
		let forward = 0
		let strafe = 0
		if (keys.has('KeyW')) forward += 1
		if (keys.has('KeyS')) forward -= 1
		if (keys.has('KeyD')) strafe += 1
		if (keys.has('KeyA')) strafe -= 1

		const sinYaw = Math.sin(player.yaw)
		const cosYaw = Math.cos(player.yaw)
		let dx = (-sinYaw * forward + cosYaw * strafe) * speed
		let dz = (-cosYaw * forward - sinYaw * strafe) * speed
		const magnitude = Math.hypot(dx, dz)
		if (magnitude > speed && magnitude > 0) {
			dx = (dx / magnitude) * speed
			dz = (dz / magnitude) * speed
		}

		if (!collides(player.x + dx, player.y, player.z)) player.x += dx
		if (!collides(player.x, player.y, player.z + dz)) player.z += dz

		const inWater = world.blockAt(
			Math.floor(player.x),
			Math.floor(player.y + 0.5),
			Math.floor(player.z),
		)
		const swimming = inWater === BLOCK.WATER || inWater === BLOCK.WATER_FLOWING
		player.vy -= GRAVITY * dt * (swimming ? 0.25 : 1)
		if (keys.has('Space')) {
			if (player.onGround) player.vy = JUMP_SPEED
			else if (swimming) player.vy = JUMP_SPEED * 0.45
		}
		player.vy = Math.max(-40, Math.min(40, player.vy))

		const dy = player.vy * dt
		if (!collides(player.x, player.y + dy, player.z)) {
			player.y += dy
			player.onGround = false
		} else {
			player.onGround = player.vy < 0
			player.vy = 0
		}
		if (player.y < -8) {
			player.y = world.spawnHeight(Math.floor(player.x), Math.floor(player.z))
			player.vy = 0
		}
	}

	// --- persistence --------------------------------------------------------

	const saveWorld = (): void => {
		const now = Date.now()
		const record: WorldRecord = {
			name: worldId,
			seed,
			createdAt: saved?.createdAt ?? now,
			updatedAt: now,
			player: {
				x: player.x,
				y: player.y,
				z: player.z,
				yaw: player.yaw,
				pitch: player.pitch,
				health: player.health,
				hunger: player.hunger,
				hotbar: player.hotbar,
			},
			edits: world.listEdits(),
			settings,
		}
		store.save(record)
		worlds = listWorlds()
	}

	/** World switching reloads the page so every subsystem restarts cleanly. */
	const gotoWorld = (name: string, worldSeed: number): void => {
		const next = new URLSearchParams(window.location.search)
		next.set('world', name)
		next.set('seed', String(worldSeed))
		window.location.search = next.toString()
	}

	// --- UI -----------------------------------------------------------------

	const applySetting = (key: keyof UiSettings, value: number | boolean): void => {
		if (key === 'showDebug') {
			settings.showDebug = value === true
			return
		}
		if (typeof value !== 'number' || !Number.isFinite(value)) return
		if (key === 'renderDistance') {
			settings.renderDistance = Math.max(
				PERF.renderDistanceMin,
				Math.min(PERF.renderDistanceMax, Math.round(value)),
			)
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
			if (index >= 0 && index < HOTBAR.length) player.hotbar = index
		},
		onToggleInventory(): void {
			screen = screen === 'inventory' ? 'playing' : 'inventory'
		},
		onCloseScreen(): void {
			if (screen === 'title') {
				worlds = listWorlds()
				screen = 'worldSelect'
				return
			}
			if (screen === 'worldSelect') {
				screen = 'title'
				return
			}
			if (screen === 'settings') {
				screen = 'pause'
				return
			}
			screen = screen === 'playing' ? 'pause' : 'playing'
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
		onCreateWorld(name: string, worldSeed: number): void {
			gotoWorld(name, worldSeed)
		},
		onSelectWorld(id: string): void {
			const record = store.load(id)
			gotoWorld(id, record?.seed ?? seed)
		},
		onDeleteWorld(id: string): void {
			store.remove(id)
			worlds = listWorlds()
		},
		onSave(): void {
			saveWorld()
		},
		onQuit(): void {
			saveWorld()
			screen = 'title'
		},
		onCraft(): void {
			// Crafting recipes live in the gameplay subtree; nothing to apply yet.
		},
		onMoveStack(): void {
			// The hotbar is fixed in this build, so stacks cannot move.
		},
		onPlaySound(name: string): void {
			playSound(name)
		},
	}

	const uiRoot = document.getElementById('ui-root')
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
			biome: world.biomeAt(Math.floor(player.x), Math.floor(player.z)),
			chunks: stats.sections,
			drawCalls: stats.drawCalls,
			quads: stats.quads,
			triangles: stats.triangles,
			renderDistance: renderer.getRenderDistance(),
		}
		ui.update(
			buildSnapshot({
				screen,
				health: player.health,
				hunger: player.hunger,
				selectedSlot: player.hotbar,
				debug,
				settings,
				worlds,
			}),
		)
	}

	// --- input --------------------------------------------------------------
	// Hotbar digits, Escape, E and F3 are handled by the UI layer, which reports
	// them through `host`; duplicating them here would cancel each toggle out.

	canvas.addEventListener('click', () => {
		if (testMode || screen !== 'playing') return
		if (document.pointerLockElement !== canvas) {
			void canvas.requestPointerLock()
			return
		}
		breakTargeted()
	})
	canvas.addEventListener('contextmenu', (event) => {
		event.preventDefault()
		if (!testMode && screen === 'playing') placeTargeted()
	})
	window.addEventListener('mousemove', (event) => {
		if (document.pointerLockElement !== canvas) return
		player.yaw -= event.movementX * settings.sensitivity
		player.pitch = Math.max(
			-Math.PI / 2 + 0.01,
			Math.min(Math.PI / 2 - 0.01, player.pitch - event.movementY * settings.sensitivity),
		)
	})
	window.addEventListener('keydown', (event) => {
		keys.add(event.code)
	})
	window.addEventListener('keyup', (event) => {
		keys.delete(event.code)
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

	// --- frame loop ---------------------------------------------------------

	let lastFrame = performance.now()
	let sinceSave = 0
	let sinceSync = 0
	let sinceUi = 0
	let elapsed = 0

	const frame = (): void => {
		const now = performance.now()
		const dt = Math.min(0.05, (now - lastFrame) / 1000)
		lastFrame = now
		elapsed += dt
		sinceSync += dt
		sinceSave += dt
		sinceUi += dt
		tick += 1

		if (!testMode && screen === 'playing') move(dt)

		if (needsSectionSync || sinceSync > 0.25) {
			syncSections()
			sinceSync = 0
		}

		if (testMode) {
			// A fixed time of day keeps E2E screenshots deterministic.
			renderer.setTimeOfDay(0.25)
		} else {
			renderer.setTimeOfDay(0.25 + elapsed / DAY_LENGTH_SECONDS)
			if (sinceSave > AUTOSAVE_SECONDS) {
				saveWorld()
				sinceSave = 0
			}
		}

		const eyeBlock = world.blockAt(
			Math.floor(player.x),
			Math.floor(player.y + PLAYER_EYE),
			Math.floor(player.z),
		)
		renderer.setUnderwater(eyeBlock === BLOCK.WATER || eyeBlock === BLOCK.WATER_FLOWING)

		renderer.camera.position.set(player.x, player.y + PLAYER_EYE, player.z)
		renderer.camera.rotation.set(player.pitch, player.yaw, 0)
		renderer.flushUploads()
		renderer.render(dt)

		if (sinceUi > UI_INTERVAL_SECONDS) {
			pushUi()
			sinceUi = 0
		}

		if (!ready && renderer.stats().sections > 0) {
			ready = true
			resolveReady()
		}
		requestAnimationFrame(frame)
	}

	// --- automation hooks ---------------------------------------------------

	const api: VcTestApi = {
		ready: whenReady,
		state(): VcState {
			const stats = renderer.stats()
			return {
				screen,
				seed,
				worldId,
				x: player.x,
				y: player.y,
				z: player.z,
				chunks: stats.sections,
				quads: stats.quads,
				drawCalls: stats.drawCalls,
				fps: stats.fps,
				tick,
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
			placeAt(x, y, z, id)
		},
		save(): Promise<void> {
			saveWorld()
			return Promise.resolve()
		},
		hash(): number {
			return Number.parseInt(world.stateHash(), 16)
		},
		errors,
	}
	window.__vc = api

	syncSections()
	pushUi()
	requestAnimationFrame(frame)
}

/**
 * Generated assets are optional: when `packages/assets-gen` has not run, the
 * build flips `__VC_HAS_ASSETS__` off and the renderer keeps its procedural
 * placeholder atlas, so the game still boots with no failed requests.
 */
void loadGameAssets('./')
	.then((assets) => {
		main(assets)
		window.dispatchEvent(
			new CustomEvent('voxelcraft.assetsReady', {
				detail: { generated: assets.atlas.generated, sounds: assets.sounds !== null },
			}),
		)
	})
	.catch((error: unknown) => {
		console.warn('[voxelcraft] asset loading failed, using fallbacks:', error)
		main({ atlas: fallbackAtlas(), sounds: null })
	})
