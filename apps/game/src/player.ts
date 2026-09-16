/**
 * The player, as a real simulation entity.
 *
 * apps/game no longer integrates movement itself: the player is an ECS entity
 * carrying the contract's components, and the fixed 20 Hz schedule of
 * `@voxelcraft/sim` runs fluid, light and physics for it in `SYSTEM_ORDER`.
 * Input only writes `Intent`, exactly like mob AI does.
 *
 * Yaw convention: the three.js camera looks down -Z at yaw 0, while
 * `intentToWorld` in the sim faces +Z. The intent therefore carries
 * `yaw + Math.PI` and a negated strafe, which is the same direction expressed
 * in the other basis.
 */
import {
	GAME_MODE,
	PHYSICS,
	type AABB,
	type EntityId,
	type GameMode,
	type InventoryState,
	type PlayerSave,
	type Vec3f,
	type Vec3i,
	type SystemEntry,
} from '@voxelcraft/core-types'
import { cloneInventoryState } from '@voxelcraft/gameplay'
import {
	Collider,
	Health,
	Intent,
	PhysicsState,
	PlayerTag,
	Transform,
	Velocity,
	createEcsWorld,
	createPhysicsSystem,
	createSchedule,
	createTickRunner,
	defineSystem,
	fluidSystemEntry,
	lightSystemEntry,
	playerBox,
	type HealthComp,
	type IntentComp,
	type PhysicsStateComp,
	type SimEcsWorld,
	type TickRunner,
	type TransformComp,
	type VelocityComp,
} from '@voxelcraft/sim'
import type { ChunkWorld } from './world/chunkWorld'

/** Rotation between the camera basis and the simulation basis. */
export const SIM_YAW_OFFSET = Math.PI

export interface MoveInput {
	forward: number
	strafe: number
	jump: boolean
	sprint: boolean
	sneak: boolean
}

export interface SpawnPoint {
	x: number
	y: number
	z: number
	yaw?: number
	pitch?: number
}

export interface PlayerRuntimeOptions {
	world: ChunkWorld
	spawn: SpawnPoint
	inventory: InventoryState
	gameMode?: GameMode
	health?: number
	tick?: number
	respawn?: Vec3i | null
	/**
	 * Test mode freezes the player, so a screenshot and the world hash stay
	 * comparable across a reload. Fluid and light keep ticking either way.
	 */
	simulatePlayer?: boolean
}

function clampAxis(value: number): number {
	if (!Number.isFinite(value)) return 0
	return Math.max(-1, Math.min(1, value))
}

export class PlayerRuntime {
	readonly ecs: SimEcsWorld
	readonly entity: EntityId
	readonly runner: TickRunner
	readonly inventory: InventoryState
	gameMode: GameMode
	respawn: Vec3i | null

	private readonly spawn: Required<SpawnPoint>
	private readonly transform: TransformComp
	private readonly velocity: VelocityComp
	private readonly physics: PhysicsStateComp
	private readonly intent: IntentComp
	private readonly vitals: HealthComp

	constructor(options: PlayerRuntimeOptions) {
		const world = options.world
		this.inventory = options.inventory
		this.gameMode = options.gameMode ?? GAME_MODE.Creative
		this.respawn = options.respawn ?? null
		this.spawn = {
			x: options.spawn.x,
			y: options.spawn.y,
			z: options.spawn.z,
			yaw: options.spawn.yaw ?? 0,
			pitch: options.spawn.pitch ?? 0,
		}

		this.ecs = createEcsWorld()
		this.entity = this.ecs.create()
		this.ecs.add(this.entity, PlayerTag, { name: 'player' })
		this.ecs.add(this.entity, Transform, {
			x: this.spawn.x,
			y: this.spawn.y,
			z: this.spawn.z,
			yaw: this.spawn.yaw,
			pitch: this.spawn.pitch,
		})
		this.ecs.add(this.entity, Velocity, { x: 0, y: 0, z: 0 })
		this.ecs.add(this.entity, Collider, {
			width: PHYSICS.playerWidth,
			height: PHYSICS.playerHeight,
		})
		this.ecs.add(this.entity, PhysicsState, {
			onGround: false,
			inWater: false,
			inLava: false,
			steppedUp: false,
			fallDistance: 0,
			pendingFallDamage: 0,
			fallStartY: this.spawn.y,
		})
		this.ecs.add(this.entity, Intent, Intent.create())
		const health = options.health ?? 20
		this.ecs.add(this.entity, Health, {
			current: health,
			max: Math.max(health, 20),
			invulnerableTicks: 0,
		})
		this.ecs.flush()

		this.transform = requireComponent(this.ecs.get(this.entity, Transform), 'transform')
		this.velocity = requireComponent(this.ecs.get(this.entity, Velocity), 'velocity')
		this.physics = requireComponent(this.ecs.get(this.entity, PhysicsState), 'physicsState')
		this.intent = requireComponent(this.ecs.get(this.entity, Intent), 'intent')
		this.vitals = requireComponent(this.ecs.get(this.entity, Health), 'health')

		// SYSTEM_ORDER sorts these into fluid -> light -> physics.
		const entries: SystemEntry[] = [fluidSystemEntry(world.fluids), lightSystemEntry(world.light)]
		if (options.simulatePlayer !== false) {
			entries.push(defineSystem('physics', createPhysicsSystem(world.voxels)))
		}
		this.runner = createTickRunner(this.ecs, createSchedule(entries), options.tick ?? 0)
	}

	get x(): number {
		return this.transform.x
	}
	get y(): number {
		return this.transform.y
	}
	get z(): number {
		return this.transform.z
	}
	get yaw(): number {
		return this.transform.yaw
	}
	set yaw(value: number) {
		this.transform.yaw = value
	}
	get pitch(): number {
		return this.transform.pitch
	}
	set pitch(value: number) {
		this.transform.pitch = value
	}
	get onGround(): boolean {
		return this.physics.onGround
	}
	get inWater(): boolean {
		return this.physics.inWater
	}
	get health(): number {
		return this.vitals.current
	}
	get maxHealth(): number {
		return this.vitals.max
	}
	get tick(): number {
		return this.runner.tick
	}

	eyeHeight(): number {
		return this.intent.sneak ? PHYSICS.sneakEyeHeight : PHYSICS.playerEyeHeight
	}

	eye(): Vec3f {
		return { x: this.transform.x, y: this.transform.y + this.eyeHeight(), z: this.transform.z }
	}

	/** Unit vector the camera looks along, in the renderer's basis. */
	lookDirection(): Vec3f {
		const cosPitch = Math.cos(this.transform.pitch)
		return {
			x: -Math.sin(this.transform.yaw) * cosPitch,
			y: Math.sin(this.transform.pitch),
			z: -Math.cos(this.transform.yaw) * cosPitch,
		}
	}

	box(): AABB {
		return playerBox(this.transform.x, this.transform.y, this.transform.z)
	}

	setMove(input: MoveInput): void {
		this.intent.forward = clampAxis(input.forward)
		this.intent.strafe = -clampAxis(input.strafe)
		this.intent.jump = input.jump
		this.intent.sprint = input.sprint
		this.intent.sneak = input.sneak
		this.intent.yaw = this.transform.yaw + SIM_YAW_OFFSET
	}

	clearMove(): void {
		this.setMove({ forward: 0, strafe: 0, jump: false, sprint: false, sneak: false })
	}

	/** Runs whole simulation ticks for the elapsed real time. */
	advance(realDeltaMs: number): number {
		const ticks = this.runner.advance(realDeltaMs)
		if (this.physics.pendingFallDamage > 0) {
			this.vitals.current = Math.max(0, this.vitals.current - this.physics.pendingFallDamage)
			this.physics.pendingFallDamage = 0
		}
		return ticks
	}

	teleport(x: number, y: number, z: number): void {
		this.transform.x = x
		this.transform.y = y
		this.transform.z = z
		this.velocity.x = 0
		this.velocity.y = 0
		this.velocity.z = 0
		this.physics.onGround = false
		this.physics.fallDistance = 0
		this.physics.pendingFallDamage = 0
		this.physics.fallStartY = y
	}

	/** Bed respawn point when there is one, else the world spawn. */
	respawnPlayer(): void {
		const point = this.respawn
		if (point === null) this.teleport(this.spawn.x, this.spawn.y, this.spawn.z)
		else this.teleport(point.x + 0.5, point.y, point.z + 0.5)
		this.vitals.current = this.vitals.max
	}

	save(): PlayerSave {
		return {
			position: { x: this.transform.x, y: this.transform.y, z: this.transform.z },
			yaw: this.transform.yaw,
			pitch: this.transform.pitch,
			health: this.vitals.current,
			gameMode: this.gameMode,
			inventory: cloneInventoryState(this.inventory),
			respawn: this.respawn,
			tick: this.runner.tick,
		}
	}
}

function requireComponent<T>(value: T | undefined, name: string): T {
	if (value === undefined) throw new Error(`player is missing its ${name} component`)
	return value
}
