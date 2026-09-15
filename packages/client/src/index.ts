/**
 * `@voxelcraft/client`: greedy mesher, mesher worker pool, three.js renderer,
 * UI layer and audio playback.
 *
 * `apps/game` owns the game loop and wires these pieces together.
 */

export const PACKAGE_NAME = '@voxelcraft/client'

export * from './audio'
export * from './mesher'
export * from './render'
export * from './ui'
export * from './worker/pool'
export * from './worker/protocol'
