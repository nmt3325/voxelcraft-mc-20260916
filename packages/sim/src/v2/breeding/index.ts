/**
 * Baby mobs, love mode and breeding for the v1.1 simulation.
 *
 * `babyComponents.ts` holds the data and the local constants, `babyBehavior.ts`
 * the per tick behaviour, and `breedingApi.ts` the entry points
 * `@voxelcraft/gameplay` calls. Nothing in this folder registers a schedule
 * slot: `breedTickSystem` is exported for the host to call once per tick.
 */
export * from './babyComponents'
export * from './babyBehavior'
export * from './breedingApi'
