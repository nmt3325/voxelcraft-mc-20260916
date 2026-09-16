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
	BLOCK_V2,
	CHUNK_X,
	CHUNK_Z,
	chunkKey,
	DIMENSION,
	FARMING,
	GAME_MODE,
	INPUT_BIT,
	ITEM_V2,
	NET,
	PARTICLE,
	PERF,
	PHYSICS,
	SECTION_Y,
	sectionKey,
	SECTIONS_PER_CHUNK,
	worldToChunk,
	type BlockId,
	type GameSettings,
	type ParticleId,
	type RayHit,
	type VoxelView,
} from '@voxelcraft/core-types'
import {
	ParticlePool,
	ParticleRenderer,
	SOUND_EVENT,
	VoxelRenderer,
	createAudio,
	createMesherPool,
	createSoundEvents,
	createUi,
	fallbackAtlas,
	type AudioHandle,
	type MesherPool,
	type SoundEventPlayer,
	type UiDebugInfo,
	type UiHandle,
	type UiHost,
	type UiScreen,
	type UiSettings,
	type UiWorldEntry,
} from '@voxelcraft/client'
import {
	addStack,
	craftFromInventory,
	heldStack,
	isCreative,
	isOreBlock,
	makeStack,
	removeItem,
	selectHotbar,
	setHeldStack,
	swapCursorWithSlot,
	type FarmWorld,
} from '@voxelcraft/gameplay'
import {
	aabbOverlaps,
	createEventBusV2,
	isReplaceableBlock,
	raycastVoxels,
	voxelBox,
} from '@voxelcraft/sim'
import { loadGameAssets, type GameAssets } from './assets'
import { PlayerRuntime } from './player'
import { buildSnapshot, createCreativeInventory, heldBlockId } from './ui-bridge'
import { ChunkWorld } from './world/chunkWorld'
import { createSaveMeta, openWorldPersistence } from './world/store'
import { createDimensions } from './game/dimensions'
import { createMultiplayer } from './game/multiplayer'
import { createProgression } from './game/progression'
import { BLOCKS_V2, V2_INVENTORY } from './registries'

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

/** Mesher pool telemetry, so e2e can prove meshing really ran in a worker. */
interface VcMesherStats {
	workers: number
	inline: number
	worker: number
	meshed: number
	skipped: number
	errors: number
	requested: number
	pending: number
}

/** Particle telemetry, so e2e can prove the pool and the batch are wired up. */
interface VcParticleStats {
	alive: number
	visible: number
	drawCalls: number
	capacity: number
	spawnBudget: number
}

/** Experience the HUD shows, so e2e can prove the xp path is wired. */
interface VcXpInfo {
	level: number
	total: number
	progress: number
	orbs: number
}

interface VcFarmInfo {
	crops: number
	mature: number
}

interface VcDimensionInfo {
	id: number
	label: string
}

interface VcEnchantInfo {
	open: boolean
	bookshelves: number
	offers: number
}

interface VcNetInfo {
	enabled: boolean
	state: string
	players: number
	address: string
}

interface VcPos {
	x: number
	y: number
	z: number
}

interface VcTestApi {
	ready: Promise<void>
	state(): VcState
	mesher(): VcMesherStats
	particles(): VcParticleStats
	getBlock(x: number, y: number, z: number): number
	breakBlock(x: number, y: number, z: number): void
	placeBlock(x: number, y: number, z: number, id: number): void
	save(): Promise<void>
	hash(): number
	xp(): VcXpInfo
	farm(): VcFarmInfo
	dimension(): VcDimensionInfo
	enchanting(): VcEnchantInfo
	net(): VcNetInfo
	/** Advances the fixed 20 Hz simulation. Returns the new tick. */
	advanceTicks(count: number): number
	teleport(x: number, y: number, z: number): void
	till(x: number, y: number, z: number): boolean
	plant(x: number, y: number, z: number): boolean
	harvest(x: number, y: number, z: number): number
	buildPortal(): VcPos
	xpFromOre(): number
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

/** Breaking one of these is a harvest, so it also raises the farming cue. */
const CROP_BLOCKS: readonly BlockId[] = [
	BLOCK_V2.WHEAT_CROP,
	BLOCK_V2.CARROT_CROP,
	BLOCK_V2.POTATO_CROP,
]

/** Particles spawned per broken block and per placed block. */
const BREAK_PARTICLES = 14
const PLACE_PARTICLES = 6

/** Particles for a crop that just grew a stage. */
const GROW_PARTICLES = 3

/** Sim ticks caught up per frame for growth, orbs and portal travel. */
const SIM_CATCHUP_LIMIT = 8

/** Cap for the automation hook that fast-forwards the simulation. */
const MAX_ADVANCE_TICKS = 2000

/** Repeat cadence while a touch long-press holds the attack button. */
const TOUCH_MINE_SECONDS = 0.25

/** Pitch clamp shared by mouse look and touch drag look. */
const PITCH_LIMIT = Math.PI / 2 - 0.001

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

	let world = new ChunkWorld({
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

	// --- v2 features ---------------------------------------------------------

	// One bus carries the v2 events (xp.changed, crop.grown, dimension.changed,
	// portal.used, enchant.applied) between the modules below.
	const events = createEventBusV2()

	/** Farming and enchanting read and write through the active world. */
	const farmWorld: FarmWorld = {
		getBlock: (x, y, z) => world.blockAt(x, y, z),
		setBlock: (x, y, z, id) => {
			if (world.setBlock(x, y, z, id)) needsSectionSync = true
		},
	}

	// The Overworld is the world built above, so a restored save stays
	// authoritative; the Nether is generated from the seed on first entry.
	const dimensions = createDimensions({
		seed,
		ecs: player.ecs,
		entity: player.entity,
		events,
		overworld: world,
		onWorldEdited: () => {
			needsSectionSync = true
		},
	})

	const progression = createProgression({
		seed,
		events,
		onEffect: (effect, x, y, z) => {
			if (effect === 'enchant') {
				burstAt(x, y, z, PARTICLE.Portal, PLACE_PARTICLES)
				soundEvents.play(SOUND_EVENT.EnchantApply)
				return
			}
			if (effect === 'crop-harvest') {
				burstAt(x, y, z, PARTICLE.BlockBreak, PLACE_PARTICLES)
				return
			}
			burstAt(x, y, z, PARTICLE.Smoke, effect === 'crop-grown' ? GROW_PARTICLES : PLACE_PARTICLES)
		},
	})

	// Single player by default: this only dials out with `?mp=1` or the pause
	// menu toggle.
	const multiplayer = createMultiplayer({
		params,
		playerName: worldId,
		onError: (message) => {
			errors.push(`net: ${message}`)
		},
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

	// Workers run under test too, and the e2e suite asserts that meshing really
	// goes through them. `workers=0` opts out so the inline fallback stays testable.
	const inlineMeshing = params.get('workers') === '0'
	const pool: MesherPool = createMesherPool({ inline: inlineMeshing })
	const audio: AudioHandle = createAudio({
		manifest: assets.sounds,
		baseUrl: './',
		volume: settings.volume,
	})

	// One fixed-capacity pool, plus the single batched draw call that shows it.
	const particles = new ParticlePool()
	const particleBatch = new ParticleRenderer()
	renderer.scene.add(particleBatch.object)
	// v2 cues (portal, enchanting, harvest, pops) resolved against the manifest once.
	const soundEvents: SoundEventPlayer = createSoundEvents({
		audio,
		manifest: assets.sounds,
	})

	let screen: UiScreen = 'playing'
	let needsSectionSync = true
	/** Latest INPUT_BIT mask from the touch overlay, merged with the keyboard. */
	let touchBits = 0
	/** True while a touch long-press holds the attack button down. */
	let touchAttack = false
	let sinceMine = 0

	/** Raycast view where plants and torches are pickable but fluids are not. */
	const targetViewOf = (target: ChunkWorld): VoxelView => ({
		...target.voxels,
		isSolid: (x: number, y: number, z: number): boolean => {
			const id = target.blockAt(x, y, z)
			return id !== BLOCK.AIR && !FLUID_BLOCKS.includes(id)
		},
	})
	// Rebuilt on a dimension change: the view wraps one world's voxels.
	let targetView: VoxelView = targetViewOf(world)

	const playSound = (name: string): void => {
		audio.play(name)
	}

	// --- particles ----------------------------------------------------------

	/** Burst at a block centre. The pool clamps this to its per-tick budget. */
	const burstAt = (x: number, y: number, z: number, kind: ParticleId, count: number): void => {
		particles.spawn({ kind, x: x + 0.5, y: y + 0.5, z: z + 0.5, count, spread: 0.12 })
		soundEvents.play(SOUND_EVENT.ParticlePop)
	}

	const isCrop = (id: BlockId): boolean => CROP_BLOCKS.includes(id)

	/** A bookshelf inside the vanilla 5x3x5 reach powers an enchanting table. */
	const poweringTable = (x: number, y: number, z: number): boolean => {
		for (let dy = -1; dy <= 1; dy++) {
			for (let dz = -2; dz <= 2; dz++) {
				for (let dx = -2; dx <= 2; dx++) {
					if (world.blockAt(x + dx, y + dy, z + dz) === BLOCK_V2.ENCHANTING_TABLE) return true
				}
			}
		}
		return false
	}

	const nearPortal = (x: number, y: number, z: number): boolean =>
		world.blockAt(x + 1, y, z) === BLOCK_V2.NETHER_PORTAL ||
		world.blockAt(x - 1, y, z) === BLOCK_V2.NETHER_PORTAL ||
		world.blockAt(x, y, z + 1) === BLOCK_V2.NETHER_PORTAL ||
		world.blockAt(x, y, z - 1) === BLOCK_V2.NETHER_PORTAL

	// --- editing ------------------------------------------------------------

	const breakAt = (x: number, y: number, z: number): boolean => {
		const bx = Math.floor(x)
		const by = Math.floor(y)
		const bz = Math.floor(z)
		const previous = world.blockAt(bx, by, bz)
		if (previous === BLOCK.AIR) return false
		const definition = BLOCKS_V2.tryById(previous)
		// A negative hardness is the contract's "unbreakable", such as bedrock.
		if (definition === undefined || definition.hardness < 0) return false
		if (!world.setBlock(bx, by, bz, BLOCK.AIR)) return false
		if (!isCreative(gameMode)) {
			const itemId = definition.itemId ?? null
			if (itemId !== null) addStack(player.inventory, makeStack(itemId, 1), V2_INVENTORY)
		}
		needsSectionSync = true
		playSound(WOOD_BLOCKS.includes(previous) ? 'dig_wood' : 'dig_stone')
		burstAt(bx, by, bz, PARTICLE.BlockBreak, BREAK_PARTICLES)
		// A broken crop is a harvest, and an ore releases its experience.
		if (isCrop(previous)) progression.harvest(farmWorld, player.inventory, bx, by, bz)
		progression.blockBroken(bx, by, bz, previous)
		if (isCrop(previous)) soundEvents.play(SOUND_EVENT.CropHarvest)
		return true
	}

	const placeAt = (x: number, y: number, z: number, id: BlockId): boolean => {
		if (id === BLOCK.AIR) return false
		const definition = BLOCKS_V2.tryById(id)
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
		burstAt(bx, by, bz, PARTICLE.Smoke, PLACE_PARTICLES)
		if (isCrop(id)) soundEvents.play(SOUND_EVENT.CropPlant)
		if (id === BLOCK_V2.ENCHANTING_TABLE) soundEvents.play(SOUND_EVENT.EnchantStart)
		if (id === BLOCK_V2.BOOKSHELF && poweringTable(bx, by, bz)) {
			soundEvents.play(SOUND_EVENT.EnchantApply)
		}
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

	/** Touch attack is a hold, so the break repeats on a fixed cadence. */
	const mineHeld = (dt: number): void => {
		sinceMine += dt
		if (sinceMine < TOUCH_MINE_SECONDS) return
		sinceMine = 0
		breakTargeted()
	}

	/** Travel cue inside a portal, ambient hum while standing next to one. */
	const portalCue = (): void => {
		const eye = player.eye()
		const bx = Math.floor(eye.x)
		const by = Math.floor(eye.y)
		const bz = Math.floor(eye.z)
		if (world.blockAt(bx, by, bz) === BLOCK_V2.NETHER_PORTAL) {
			soundEvents.play(SOUND_EVENT.PortalTravel)
			particles.spawn({
				kind: PARTICLE.Portal,
				x: eye.x,
				y: eye.y,
				z: eye.z,
				count: 2,
				spread: 0.25,
			})
			return
		}
		if (nearPortal(bx, by, bz)) soundEvents.play(SOUND_EVENT.PortalAmbient)
	}

	// --- dimensions ----------------------------------------------------------

	/** Travel swapped the world: the renderer and the schedule follow it. */
	const syncDimension = (): void => {
		const next = dimensions.world
		if (next === world) return
		world = next
		targetView = targetViewOf(world)
		player.retarget(world)
		for (const key of [...requested.keys()]) {
			requested.delete(key)
			pool.cancel(key)
			renderer.removeSection(key)
		}
		needsSectionSync = true
		soundEvents.play(SOUND_EVENT.PortalAmbient)
	}

	/** Sim ticks the app owns: crop growth, orb ageing and portal travel. */
	let lastSimTick = player.tick
	let lastSentTick = player.tick
	const runSim = (limit: number): void => {
		let steps = 0
		while (lastSimTick < player.tick && steps < limit) {
			lastSimTick += 1
			steps += 1
			progression.tick(farmWorld, lastSimTick)
			dimensions.tick()
			syncDimension()
		}
		// A long stall must not replay thousands of ticks on the next frame.
		if (player.tick - lastSimTick > limit) lastSimTick = player.tick
	}

	/** INPUT_BIT mask of this frame, which is what the server speaks. */
	const inputBits = (): number => {
		let bits = touchBits
		if (pressed.has('KeyW')) bits |= INPUT_BIT.Forward
		if (pressed.has('KeyS')) bits |= INPUT_BIT.Back
		if (pressed.has('KeyA')) bits |= INPUT_BIT.Left
		if (pressed.has('KeyD')) bits |= INPUT_BIT.Right
		if (pressed.has('Space')) bits |= INPUT_BIT.Jump
		if (pressed.has('ShiftLeft') || pressed.has('ShiftRight')) bits |= INPUT_BIT.Sprint
		if (pressed.has('ControlLeft') || pressed.has('ControlRight')) bits |= INPUT_BIT.Sneak
		return bits
	}

	/**
	 * Right click. The targeted block gets first refusal: an enchanting table
	 * opens its screen, a hoe tills soil and seeds are planted. Anything else
	 * falls back to placing the held block.
	 */
	const useTargeted = (): void => {
		const hit = targeted()
		if (hit === null) return
		const bx = hit.block.x
		const by = hit.block.y
		const bz = hit.block.z
		if (world.blockAt(bx, by, bz) === BLOCK_V2.ENCHANTING_TABLE) {
			progression.openTable(farmWorld, player.inventory, bx, by, bz)
			screen = 'enchanting'
			soundEvents.play(SOUND_EVENT.EnchantStart)
			return
		}
		const held = heldStack(player.inventory)
		if (progression.till(farmWorld, bx, by, bz, held)) {
			needsSectionSync = true
			return
		}
		if (held !== null) {
			const px = bx + hit.normal.x
			const py = by + hit.normal.y
			const pz = bz + hit.normal.z
			if (progression.plant(farmWorld, px, py, pz, held.item)) {
				if (!isCreative(gameMode)) removeItem(player.inventory, held.item, 1)
				needsSectionSync = true
				return
			}
		}
		placeTargeted()
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
			// Only the Overworld is persisted, so a save while in the Nether must
			// not write its regenerated chunks over the saved ones.
			const overworld = dimensions.worldOf(DIMENSION.Overworld)
			const chunks = overworld.savePayloads()
			await persistence.save({
				meta: createSaveMeta({
					worldId,
					name: meta?.name,
					seed,
					createdAt: meta?.createdAt,
					gameMode,
					generatorVersion: overworld.generator.version,
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
			if (screen === 'enchanting') progression.closeTable()
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
			swapCursorWithSlot(player.inventory, from, V2_INVENTORY)
			swapCursorWithSlot(player.inventory, to, V2_INVENTORY)
		},
		onPlaySound(name: string): void {
			playSound(name)
		},
		onTakeEnchantOffer(slot: number): void {
			progression.takeOffer(player.inventory, slot)
		},
		onToggleMultiplayer(): void {
			multiplayer.toggle()
		},
		onTouchInput(bits: number): void {
			touchBits = bits
		},
		onTouchLook(delta: { yaw: number; pitch: number }): void {
			if (screen !== 'playing') return
			player.yaw -= delta.yaw
			player.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, player.pitch + delta.pitch))
		},
		onTouchUse(): void {
			if (screen === 'playing') useTargeted()
		},
		onTouchAttack(active: boolean): void {
			touchAttack = active
			sinceMine = TOUCH_MINE_SECONDS
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
				xp: progression.xpInfo(),
				dimension: dimensions.label(),
				farm: progression.farmInfo(),
				multiplayer: multiplayer.status(),
				enchanting: progression.enchantInfo(player.inventory),
			}),
		)
	}

	// --- input ---------------------------------------------------------------

	const pressed = new Set<string>()

	const readMove = (): void => {
		if (screen !== 'playing') {
			touchBits = 0
			touchAttack = false
			player.clearMove()
			return
		}
		// Touch and keyboard are additive: either surface can drive the player.
		const touched = (bit: number): boolean => (touchBits & bit) !== 0
		player.setMove({
			forward:
				(pressed.has('KeyW') || touched(INPUT_BIT.Forward) ? 1 : 0) -
				(pressed.has('KeyS') || touched(INPUT_BIT.Back) ? 1 : 0),
			strafe:
				(pressed.has('KeyD') || touched(INPUT_BIT.Right) ? 1 : 0) -
				(pressed.has('KeyA') || touched(INPUT_BIT.Left) ? 1 : 0),
			jump: pressed.has('Space') || touched(INPUT_BIT.Jump),
			sprint: pressed.has('ShiftLeft') || pressed.has('ShiftRight') || touched(INPUT_BIT.Sprint),
			sneak: pressed.has('ControlLeft') || pressed.has('ControlRight') || touched(INPUT_BIT.Sneak),
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
		if (event.button === 2) useTargeted()
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
		if (touchAttack && screen === 'playing') mineHeld(dt)
		player.advance(dt * 1000)
		runSim(SIM_CATCHUP_LIMIT)
		progression.collectAt(player.x, player.y, player.z)
		multiplayer.tick(now)
		if (player.tick !== lastSentTick) {
			lastSentTick = player.tick
			multiplayer.sendInput({
				tick: player.tick,
				bits: inputBits(),
				yaw: player.yaw,
				pitch: player.pitch,
				hotbar: player.inventory.selectedHotbar,
			})
		}

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

		// Particles advance on the sim clock (20 Hz), not on wall-clock frame time.
		particles.update(dt * NET.tickHz)
		particleBatch.sync(particles)
		portalCue()

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
		mesher(): VcMesherStats {
			const mesh = pool.stats()
			return {
				workers: mesh.workers,
				inline: mesh.inlineMeshed,
				worker: mesh.workerMeshed,
				meshed: mesh.meshed,
				skipped: mesh.skipped,
				errors: mesh.errors,
				requested: mesh.requested,
				pending: mesh.pending,
			}
		},
		particles(): VcParticleStats {
			return {
				alive: particles.aliveCount,
				visible: particleBatch.visibleCount,
				drawCalls: particleBatch.drawCalls,
				capacity: particles.capacity,
				spawnBudget: particles.spawnBudgetRemaining,
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
		xp(): VcXpInfo {
			return progression.xpInfo()
		},
		farm(): VcFarmInfo {
			return progression.farmInfo()
		},
		dimension(): VcDimensionInfo {
			return { id: dimensions.current, label: dimensions.label() }
		},
		enchanting(): VcEnchantInfo {
			const info = progression.enchantInfo(player.inventory)
			return {
				open: info !== null,
				bookshelves: info?.bookshelves ?? 0,
				offers: info?.offers.length ?? 0,
			}
		},
		net(): VcNetInfo {
			return multiplayer.status()
		},
		advanceTicks(count: number): number {
			const steps = Math.max(0, Math.min(Math.floor(count), MAX_ADVANCE_TICKS))
			const target = player.tick + steps
			// One tick per step. The runner may clamp a single long catch-up, so
			// this walks to the target instead of trusting one big advance.
			let guard = steps * 4 + 16
			while (player.tick < target && guard > 0) {
				guard -= 1
				player.advance(1000 / NET.tickHz)
				runSim(SIM_CATCHUP_LIMIT)
			}
			return player.tick
		},
		teleport(x: number, y: number, z: number): void {
			player.teleport(x, y, z)
			needsSectionSync = true
		},
		till(x: number, y: number, z: number): boolean {
			// The kit's hoe, put in hand the way the inventory screen would.
			const hoe = makeStack(FARMING.hoeItem, 1)
			setHeldStack(player.inventory, hoe)
			return progression.till(farmWorld, x, y, z, hoe)
		},
		plant(x: number, y: number, z: number): boolean {
			return progression.plant(farmWorld, x, y, z, ITEM_V2.WHEAT_SEEDS)
		},
		harvest(x: number, y: number, z: number): number {
			return progression.harvest(farmWorld, player.inventory, x, y, z).length
		},
		buildPortal(): VcPos {
			const base = {
				x: Math.floor(player.x) + 2,
				y: Math.floor(player.y),
				z: Math.floor(player.z),
			}
			dimensions.buildFrame(dimensions.current, base)
			needsSectionSync = true
			// The frame opening, which is where travel is detected.
			const inside = { x: base.x + 1.5, y: base.y + 1, z: base.z + 0.5 }
			player.teleport(inside.x, inside.y, inside.z)
			return inside
		},
		xpFromOre(): number {
			// The real path: breaking an ore drops orbs, which are then collected.
			let ore: BlockId | null = null
			for (let id = 1; id < BLOCK_V2.NETHERRACK && ore === null; id += 1) {
				if (isOreBlock(id as BlockId)) ore = id as BlockId
			}
			if (ore === null) return 0
			const bx = Math.floor(player.x)
			const by = Math.floor(player.y) + 2
			const bz = Math.floor(player.z)
			world.setBlock(bx, by, bz, ore)
			needsSectionSync = true
			breakAt(bx, by, bz)
			return progression.collectAt(bx + 0.5, by + 0.5, bz + 0.5)
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
