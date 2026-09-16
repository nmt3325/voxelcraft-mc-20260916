/**
 * Client particle system: the fixed-capacity pool, the per-kind table and the
 * single-draw-call three.js batch that renders it.
 *
 * `apps/game` owns the loop: call `pool.spawn(...)` on gameplay events,
 * `pool.update(dtTicks)` once per tick and `renderer.sync(pool)` once per
 * frame.
 */
export * from './kinds'
export * from './pool'
export * from './renderer'
