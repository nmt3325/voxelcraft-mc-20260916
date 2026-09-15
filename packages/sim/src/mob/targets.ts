import type { EcsWorld, EntityId, Vec3f } from '@voxelcraft/core-types'
import { PlayerTag, Transform } from '../ecs'

/** A position the spawn, despawn and AI distance rules are measured against. */
export interface MobAnchor {
	entity: EntityId
	x: number
	y: number
	z: number
}

/** Euclidean distance between two points. */
export function mobDistance(
	ax: number,
	ay: number,
	az: number,
	bx: number,
	by: number,
	bz: number,
): number {
	const dx = ax - bx
	const dy = ay - by
	const dz = az - bz
	return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** Every player position, in ascending entity order. */
export function mobPlayerAnchors(world: EcsWorld): MobAnchor[] {
	const anchors: MobAnchor[] = []
	for (const entity of world.query([PlayerTag, Transform])) {
		const transform = world.get(entity, Transform)
		if (!transform) continue
		anchors.push({ entity, x: transform.x, y: transform.y, z: transform.z })
	}
	return anchors
}

/** Closest anchor to a position, or `undefined` when there is none. */
export function mobNearestAnchor(
	anchors: readonly MobAnchor[],
	x: number,
	y: number,
	z: number,
): { anchor: MobAnchor; dist: number } | undefined {
	let best: MobAnchor | undefined
	let bestDist = Number.POSITIVE_INFINITY
	for (const anchor of anchors) {
		const dist = mobDistance(anchor.x, anchor.y, anchor.z, x, y, z)
		if (dist < bestDist) {
			best = anchor
			bestDist = dist
		}
	}
	return best ? { anchor: best, dist: bestDist } : undefined
}

/** Position of an entity, or `undefined` when it is gone or has no transform. */
export function mobEntityPosition(world: EcsWorld, entity: EntityId): Vec3f | undefined {
	if (entity < 0 || !world.alive(entity)) return undefined
	const transform = world.get(entity, Transform)
	if (!transform) return undefined
	return { x: transform.x, y: transform.y, z: transform.z }
}
