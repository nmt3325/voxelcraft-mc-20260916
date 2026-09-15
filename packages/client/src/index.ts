/**
 * `@voxelcraft/client`: greedy mesher, mesher worker pool and three.js renderer.
 *
 * UI and audio (owned by the UI/QA subtree) are wired in by `apps/game`.
 */

export const PACKAGE_NAME = '@voxelcraft/client'

export * from './mesher'
export * from './render'
export * from './worker/pool'
export * from './worker/protocol'
