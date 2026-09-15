import type { SystemEntry } from '@voxelcraft/core-types'
import { combatSystem } from '../combat/damage'
import { combatProjectileSystem } from '../combat/projectile'
import { mobAiSystem } from './ai'
import { mobDespawnSystem } from './despawn'
import { mobSpawnSystem } from './spawn'

/**
 * The five `SYSTEM_ORDER` slots owned by this subtree, in contract order.
 *
 * Registering them on the tick schedule is the scheduler owner's job, so this
 * only hands over the named entries.
 */
export function mobSimSystemEntries(): SystemEntry[] {
	return [
		{ name: 'mobSpawn', fn: mobSpawnSystem },
		{ name: 'mobAi', fn: mobAiSystem },
		{ name: 'combat', fn: combatSystem },
		{ name: 'projectile', fn: combatProjectileSystem },
		{ name: 'despawn', fn: mobDespawnSystem },
	]
}
