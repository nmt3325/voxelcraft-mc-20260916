/**
 * Nether generation entry point. Owned by task v2-world (L1-F).
 *
 * `terrain.ts` builds the shell, the caverns and the lava sea. Ores, patches
 * and glowstone clusters live in `decoration.ts` and are wired in by
 * `src/dimension.ts`, so the bulk pass stays independent of them.
 */
export { createNetherTerrain } from './terrain'
