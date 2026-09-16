/**
 * Presentation and physics tuning for the ten frozen particle ids.
 *
 * `PARTICLE`, `PARTICLE_BUDGET` and `ParticleId` come from
 * `@voxelcraft/core-types`; nothing here redefines them.
 */
import { PARTICLE, PARTICLE_BUDGET, type ParticleId } from '@voxelcraft/core-types'

export interface ParticleKind {
	/** Numeric id from the frozen `PARTICLE` map. */
	readonly id: ParticleId
	/** Stable debug name, matching the `PARTICLE` key. */
	readonly name: string
	/** Packed `0xRRGGBB` colour, unique per kind. */
	readonly color: number
	/** Quad size in world units. */
	readonly size: number
	/** Ticks a particle of this kind lives for. */
	readonly lifetimeTicks: number
	/** Multiplier on `PARTICLE_BUDGET.gravity`. Negative kinds float upwards. */
	readonly gravityScale: number
	/** Multiplier on the per-tick drag deficit `1 - PARTICLE_BUDGET.drag`. */
	readonly dragScale: number
}

const DEFAULT_LIFETIME = PARTICLE_BUDGET.defaultLifetimeTicks

/** Every kind differs from every other in colour, and in its motion profile. */
export const PARTICLE_KINDS: Readonly<Record<ParticleId, ParticleKind>> = {
	[PARTICLE.Smoke]: {
		id: PARTICLE.Smoke,
		name: 'Smoke',
		color: 0x9a9a9a,
		size: 0.3,
		lifetimeTicks: DEFAULT_LIFETIME,
		gravityScale: -0.15,
		dragScale: 1.25,
	},
	[PARTICLE.Flame]: {
		id: PARTICLE.Flame,
		name: 'Flame',
		color: 0xff9528,
		size: 0.22,
		lifetimeTicks: 24,
		gravityScale: -0.05,
		dragScale: 1,
	},
	[PARTICLE.Splash]: {
		id: PARTICLE.Splash,
		name: 'Splash',
		color: 0x3f76e4,
		size: 0.16,
		lifetimeTicks: 20,
		gravityScale: 1,
		dragScale: 0.6,
	},
	[PARTICLE.Bubble]: {
		id: PARTICLE.Bubble,
		name: 'Bubble',
		color: 0x9fd7ff,
		size: 0.12,
		lifetimeTicks: 30,
		gravityScale: -0.4,
		dragScale: 1.4,
	},
	[PARTICLE.Crit]: {
		id: PARTICLE.Crit,
		name: 'Crit',
		color: 0xffe97f,
		size: 0.14,
		lifetimeTicks: 16,
		gravityScale: 0.35,
		dragScale: 0.8,
	},
	[PARTICLE.BlockBreak]: {
		id: PARTICLE.BlockBreak,
		name: 'BlockBreak',
		color: 0x8b6a45,
		size: 0.18,
		lifetimeTicks: DEFAULT_LIFETIME,
		gravityScale: 1,
		dragScale: 1,
	},
	[PARTICLE.Redstone]: {
		id: PARTICLE.Redstone,
		name: 'Redstone',
		color: 0xd42b1f,
		size: 0.13,
		lifetimeTicks: 28,
		gravityScale: 0.2,
		dragScale: 1.1,
	},
	[PARTICLE.Heart]: {
		id: PARTICLE.Heart,
		name: 'Heart',
		color: 0xff6ba6,
		size: 0.26,
		lifetimeTicks: 36,
		gravityScale: -0.2,
		dragScale: 1.3,
	},
	[PARTICLE.Portal]: {
		id: PARTICLE.Portal,
		name: 'Portal',
		color: 0xa24bd6,
		size: 0.2,
		lifetimeTicks: 48,
		gravityScale: -0.1,
		dragScale: 0.9,
	},
	[PARTICLE.Lava]: {
		id: PARTICLE.Lava,
		name: 'Lava',
		color: 0xef4f12,
		size: 0.24,
		lifetimeTicks: 44,
		gravityScale: 1.2,
		dragScale: 0.5,
	},
}

/** All ten ids, in contract order. */
export const PARTICLE_KIND_IDS: readonly ParticleId[] = Object.values(PARTICLE)

export function isParticleId(value: number): value is ParticleId {
	return Object.prototype.hasOwnProperty.call(PARTICLE_KINDS, value)
}

/** Kind table lookup. Unknown ids fall back to `Smoke` rather than throwing. */
export function particleKind(id: ParticleId): ParticleKind {
	return isParticleId(id) ? PARTICLE_KINDS[id] : PARTICLE_KINDS[PARTICLE.Smoke]
}

/** Blocks per tick squared, already scaled for this kind. */
export function kindGravityPerTick(kind: ParticleKind): number {
	return PARTICLE_BUDGET.gravity * kind.gravityScale
}

/** Velocity multiplier per tick, clamped to a physical `[0, 1]`. */
export function kindDragPerTick(kind: ParticleKind): number {
	const deficit = (1 - PARTICLE_BUDGET.drag) * kind.dragScale
	return Math.min(1, Math.max(0, 1 - deficit))
}
