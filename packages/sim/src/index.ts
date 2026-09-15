/**
 * @voxelcraft/sim
 *
 * Ownership map inside this package. Do not edit across these lines:
 *  - sim-a: index.ts, shared/, ecs/, schedule/, physics/, testing/, replay/
 *  - sim-b: light/, fluid/
 *  - sim-c: mob/, pathfind/, combat/
 *
 * Every subtree re-exports flat, so public symbols are prefixed by subtree
 * (light*, fluid*, mob*, path*, combat*) to keep this barrel collision free.
 */
export const PACKAGE_NAME = '@voxelcraft/sim'

export * from './shared'
export * from './ecs'
export * from './schedule'
export * from './physics'
export * from './replay'
export * from './testing'
export * from './light'
export * from './fluid'
export * from './mob'
export * from './pathfind'
export * from './combat'
