/**
 * VoxelCraft shared contract. Owned by L0 only.
 * Children must report `contract_changes_needed` instead of editing this package.
 */
export const CONTRACT_VERSION = '1.1.0'

export * from './ids'
export * from './chunk'
export * from './blockEntity'
export * from './blocks'
export * from './items'
export * from './recipes'
export * from './light'
export * from './fluid'
export * from './world'
export * from './mesh'
export * from './ecs'
export * from './physics'
export * from './pathfind'
export * from './mob'
export * from './redstone'
export * from './events'
export * from './persistence'
export * from './perf'
export * from './rng'

export * from './v2'
