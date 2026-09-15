/**
 * `@voxelcraft/sim` - the deterministic simulation package.
 *
 * Layout (one owner per folder):
 *  - `shared/`   voxel storage, block facts, event bus        (sim-a)
 *  - `ecs/`      sparse-set ECS and shared components         (sim-a)
 *  - `schedule/` fixed 20 Hz tick scheduler                   (sim-a)
 *  - `physics/`  AABB sweep, DDA raycast, locomotion          (sim-a)
 *  - `replay/`   deterministic replay + state hashing         (sim-a)
 *  - `testing/`  world fixtures used by every test            (sim-a)
 *  - `light/`    sky and block light propagation              (sim-b)
 *  - `fluid/`    water and lava                               (sim-b)
 *  - `mob/`      mob types, spawning and AI                   (sim-c)
 *  - `pathfind/` A* navigation                                (sim-c)
 *  - `combat/`   damage, knockback, projectiles               (sim-c)
 *
 * Every number comes from `@voxelcraft/core-types` (PHYSICS / PERF / PATHFIND /
 * MOB_SPAWN / COMBAT). Nothing in this package re-defines a contract constant,
 * and randomness only ever comes from the contract's RNG helpers.
 *
 * Subtree barrels are re-exported flat, so public symbols are prefixed per
 * subtree (`light*`, `fluid*`, `mob*`, `path*`, `combat*`) to stay collision
 * free.
 */
export const PACKAGE_NAME = '@voxelcraft/sim'

export * from './shared'
export * from './ecs'
export * from './light'
export * from './fluid'
export * from './mob'
export * from './pathfind'
export * from './combat'
