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
	createMesherPool,
	loadAtlas,
	type AtlasSource,
	type MesherPool,
} from '@voxelcraft/client'
import { raycastVoxels, type RaycastHit, type Vec3 } from './raycast'
import { LocalWorld, SEA_LEVEL } from './world/localWorld'
import { DEFAULT_SETTINGS, createWorldStore, type WorldRecord } from './world/store'

/**
 * Game entry point: world -> mesher pool -> renderer, plus input and saving.
 *
 * The UI, audio and E2E suites are owned by the UI/QA subtree, so this file
 * only provides what they need: the `#ui-root` mount point, `EVENT`-based
 * notifications, and the `window.__vc` automation hooks.
 */

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
const SECTIONS_PER_COLUMN = CHUNK_Y / SECTION_Y
const VERTICAL_BAND = 3
const REQUESTS_PER_FRAME = 3

const HOTBAR: readonly number[] = [
	BLOCK.STONE,
	BLOCK.COBBLESTONE,
	BLOCK.DIRT,
	BLOCK.PLANKS,
	BLOCK.GLASS,
	BLOCK.SAND,
	BLOCK.OAK_LOG,
	BLOCK.TORCH,
	BLOCK.BRICKS,
]

interface VcTestApi {
	ready: boolean
	whenReady: Promise<void>
	seed: number
	state(): Record<string, unknown>
	getBlock(x: number, y: number, z: number): number
	setBlock(x: number, y: number, z: number, id: number): boolean
	breakBlock(target?: Vec3): Vec3 | null
	placeBlock(id?: number, target?: Vec3): Vec3 | null
	save(): string
	hash(): string
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

/** Blocks the crosshair can target (includes plants and fluids' surface). */
function targetable(id: number): boolean {
	if (id === BLOCK.AIR) return false
	if (id === BLOCK.WATER || id === BLOCK.WATER_FLOWING) return false
	return appearanceOf(id) !== null
}

function main(atlas: AtlasSource | null): void {
	const params = queryParams()
	const testMode = params.get('test') === '1'
	const errors: string[] = []

	const canvas = document.getElementById('game-canvas')
	if (!(canvas instanceof HTMLCanvasElement)) {
		throw new Error('#game-canvas is missing')
	}

	const store = createWorldStore()
	const worldName = params.get('world') ?? 'default'
	const saved = store.load(worldName)
	const seed = numberParam(params, 'seed') ?? saved?.seed ?? 20260916
	const world = new LocalWorld(seed)
	if (saved !== null) world.applyEdits(saved.edits)

	const settings: GameSettings = {
		...DEFAULT_SETTINGS,
		...(saved?.settings ?? {}),
		renderDistance:
			numberParam(params, 'rd') ??
			(testMode ? PERF.e2eRenderDistance : (saved?.settings.renderDistance ?? DEFAULT_SETTINGS.renderDistance)),
	}

	const width = numberParam(params, 'w') ?? (testMode ? PERF.e2eCanvasWidth : window.innerWidth)
	const height = numberParam(params, 'h') ?? (testMode ? PERF.e2eCanvasHeight : window.innerHeight)

	const renderer = new VoxelRenderer({
		canvas,
		width,
		height,
		renderDistance: settings.renderDistance,
		fov: settings.fov,
		...(atlas !== null ? { atlas } : {}),
	})
	renderer.camera.rotation.order = 'YXZ'

	// Workers are skipped under test so a worker load failure can never turn into
	// a console error; meshing then happens inline on the main thread.
	const pool: MesherPool = createMesherPool({ inline: testMode })

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
	let needsSectionSync = true
	let ready = false
	let resolveReady = (): void => {}
	const whenReady = new Promise<void>((resolve) => {
		resolveReady = resolve
	})

	const notify = (name: string, detail: Record<string, unknown>): void => {
		window.dispatchEvent(new CustomEvent(name, { detail }))
	}

	const playSound = (sound: string): void => {
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
						cost:
							Math.abs(cx - centreX) + Math.abs(cz - centreZ) + Math.abs(sy - centreY) * 2,
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
					notify(EVENT.ChunkMeshed, { key: response.result.key, quads: response.result.stats.quads })
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

	const applyEdit = (at: Vec3, id: number): boolean => {
		if (!world.setBlock(at.x, at.y, at.z, id)) return false
		needsSectionSync = true
		syncSections()
		return true
	}

	const breakBlock = (target?: Vec3): Vec3 | null => {
		const at = target ?? pick()?.block ?? null
		if (at === null) return null
		const previous = world.blockAt(at.x, at.y, at.z)
		if (!applyEdit(at, BLOCK.AIR)) return null
		playSound(previous === BLOCK.OAK_LOG ? 'dig_wood' : 'dig_stone')
		return at
	}

	const placeBlock = (id?: number, target?: Vec3): Vec3 | null => {
		const blockId = id ?? HOTBAR[player.hotbar] ?? BLOCK.STONE
		const at = target ?? pick()?.place ?? null
		if (at === null) return null
		// Never seal the player inside a block.
		if (blocksMovement(blockId) && intersectsPlayer(at)) return null
		if (!applyEdit(at, blockId)) return null
		playSound('place_generic')
		return at
	}

	const intersectsPlayer = (at: Vec3): boolean =>
		at.x === Math.floor(player.x) &&
		at.z === Math.floor(player.z) &&
		(at.y === Math.floor(player.y) || at.y === Math.floor(player.y + PLAYER_HEIGHT - 0.01))

	// --- movement -----------------------------------------------------------

	const keys = new Set<string>()
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

	const save = (): string => {
		const now = Date.now()
		const record: WorldRecord = {
			name: worldName,
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
		return world.stateHash()
	}

	// --- input --------------------------------------------------------------

	canvas.addEventListener('click', () => {
		if (testMode) return
		if (document.pointerLockElement !== canvas) {
			void canvas.requestPointerLock()
			return
		}
		breakBlock()
	})
	canvas.addEventListener('contextmenu', (event) => {
		event.preventDefault()
		if (!testMode) placeBlock()
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
		if (event.code.startsWith('Digit')) {
			const slot = Number(event.code.slice(5)) - 1
			if (slot >= 0 && slot < HOTBAR.length) player.hotbar = slot
		}
		if (event.code === 'F3') {
			settings.showDebug = !settings.showDebug
			event.preventDefault()
		}
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
	let elapsed = 0

	const frame = (): void => {
		const now = performance.now()
		const dt = Math.min(0.05, (now - lastFrame) / 1000)
		lastFrame = now
		elapsed += dt
		sinceSync += dt
		sinceSave += dt

		if (!testMode) move(dt)

		if (needsSectionSync || sinceSync > 0.25) {
			syncSections()
			sinceSync = 0
		}

		if (testMode) {
			renderer.setTimeOfDay(0.25)
		} else {
			renderer.setTimeOfDay(0.25 + elapsed / DAY_LENGTH_SECONDS)
			if (sinceSave > AUTOSAVE_SECONDS) {
				save()
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
		renderer.render(dt)

		if (!ready && renderer.stats().sections > 0) {
			ready = true
			api.ready = true
			resolveReady()
		}
		requestAnimationFrame(frame)
	}

	// --- automation hooks ---------------------------------------------------

	const api: VcTestApi = {
		ready: false,
		whenReady,
		seed,
		state(): Record<string, unknown> {
			const stats = renderer.stats()
			return {
				x: player.x,
				y: player.y,
				z: player.z,
				yaw: player.yaw,
				pitch: player.pitch,
				health: player.health,
				hunger: player.hunger,
				hotbar: player.hotbar,
				hotbarBlock: HOTBAR[player.hotbar],
				biome: world.biomeAt(Math.floor(player.x), Math.floor(player.z)),
				seaLevel: SEA_LEVEL,
				seed,
				renderDistance: renderer.getRenderDistance(),
				underwater: renderer.isUnderwater(),
				timeOfDay: renderer.getTimeOfDay(),
				fps: stats.fps,
				chunks: stats.sections,
				visibleChunks: stats.visibleSections,
				drawCalls: stats.drawCalls,
				triangles: stats.triangles,
				quads: stats.quads,
				mesher: pool.stats(),
				hash: world.stateHash(),
			}
		},
		getBlock(x, y, z) {
			return world.blockAt(Math.floor(x), Math.floor(y), Math.floor(z))
		},
		setBlock(x, y, z, id) {
			return applyEdit({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) }, id)
		},
		breakBlock,
		placeBlock,
		save,
		hash: () => world.stateHash(),
		errors,
	}
	window.__vc = api

	syncSections()
	requestAnimationFrame(frame)
}

/**
 * Load the generated atlas before the first frame. If it is missing (assets not
 * built yet) the renderer keeps its procedural placeholder atlas, so the game
 * still boots and the E2E suite still sees a rendered world.
 */
void loadAtlas('./')
	.then((atlas) => {
		main(atlas)
		window.dispatchEvent(
			new CustomEvent('voxelcraft.atlasReady', { detail: { generated: atlas.generated } }),
		)
	})
	.catch((error: unknown) => {
		console.warn('[voxelcraft] atlas unavailable, using fallback:', error)
		main(null)
	})
