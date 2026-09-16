/**
 * Village generation for the overworld: deterministic planning plus the
 * placement pass. Owned by task world-f (village), L2.
 *
 * L1-F wires createVillageBuilder(terrain) into the overworld generator and
 * calls its decorate after the terrain features, which is the only edit needed
 * outside this directory.
 */
export { createVillageBuilder } from './builder'
export { createVillagePlanner } from './planner'
export {
	PIECE_HEIGHT,
	VILLAGE_LAYOUT,
	doorColumn,
	isBuilding,
	pathColumns,
	siteColumns,
} from './layout'
export type { Bounds, Column } from './layout'
