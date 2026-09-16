/**
 * Nether generation entry point. Owned by task v2-world (L1-F).
 *
 * `terrain.ts` builds the shell, the caverns and the lava sea; `decoration.ts`
 * adds the quartz veins, soul sand and magma patches to that filled chunk and
 * hangs the glowstone clusters through the edit view. `src/dimension.ts` runs
 * the two in that order, so the bulk pass stays independent of the features
 * placed on top of it.
 */
export { createNetherTerrain } from './terrain'
export { createNetherDecoration } from './decoration'
