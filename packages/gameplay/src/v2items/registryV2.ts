import { createItemRegistry, type GameplayItemRegistry } from '../items/registry'
import { ALL_ITEM_DEFS } from './itemDefsV2'

/**
 * v1 and v2 items in one registry.
 *
 * The shipped `ITEMS` registry already defines both bands, so this factory
 * only builds a second, independent registry over the same merged table. It
 * lives in its own file so `itemDefsV2.ts` stays pure data and
 * `items/registry.ts` can merge that data without an import cycle.
 */
export function createV2ItemRegistry(): GameplayItemRegistry {
	return createItemRegistry(ALL_ITEM_DEFS)
}
