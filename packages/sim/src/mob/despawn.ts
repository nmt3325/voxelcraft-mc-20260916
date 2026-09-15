import { MOB_SPAWN } from '@voxelcraft/core-types'
import type { EcsWorld, EntityId, SystemFn, Tick } from '@voxelcraft/core-types'
import { Despawn, PlayerTag, Transform, type DespawnComp } from '../ecs'
import { MobTag } from './components'
import { mobNearestAnchor, mobPlayerAnchors } from './targets'

/** Marks an entity for removal, overwriting any existing marker. */
export function mobMarkDespawn(
	world: EcsWorld,
	entity: EntityId,
	reason: DespawnComp['reason'],
	tick: Tick,
): void {
	const despawn = world.get(entity, Despawn)
	if (despawn) {
		despawn.reason = reason
		despawn.tick = tick
		return
	}
	world.add(entity, Despawn, { reason, tick })
}

/**
 * `SYSTEM_ORDER` slot `despawn`.
 *
 * Marks mobs further away than `MOB_SPAWN.despawnDistance` from every player
 * and destroys everything that already carries a `Despawn` marker. Players are
 * never destroyed. Because structural changes made during a query are buffered
 * until `flush()`, an entity marked on one tick disappears on the next.
 */
export const mobDespawnSystem: SystemFn = (world, _dt, tick) => {
	const anchors = mobPlayerAnchors(world)
	if (anchors.length > 0) {
		for (const entity of world.query([MobTag, Transform])) {
			if (world.has(entity, Despawn)) continue
			const transform = world.get(entity, Transform)
			if (!transform) continue
			const nearest = mobNearestAnchor(anchors, transform.x, transform.y, transform.z)
			if (nearest && nearest.dist > MOB_SPAWN.despawnDistance) {
				mobMarkDespawn(world, entity, 'distance', tick)
			}
		}
	}
	for (const entity of world.query([Despawn])) {
		if (world.has(entity, PlayerTag)) continue
		world.destroy(entity)
	}
}
