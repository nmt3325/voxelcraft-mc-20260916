/**
 * @voxelcraft/sim — v2 subtree (contract v1.1.0 features)
 *
 * Every module re-exports flat, so public symbols are prefixed to keep this
 * barrel collision free:
 *  - eventsV2      v2 event bus helpers (createEventBusV2, v2*)
 *  - dimension/    dim*, portalTravel*, DIM_*  (portals, per-dimension state)
 *  - breeding/     breed*, baby*, BREED_*, BABY_*
 *  - particles/    particle*, PARTICLE_SITUATION_*
 *
 * Nothing here is registered into SYSTEM_ORDER: the frozen v1.1.0 schedule has
 * no breeding or particle slot, so the host drives these ticks explicitly.
 * Recommended order inside one sim tick:
 *  1. particleCreateResetSystem(emitter)  — clears the per-tick spawn budget
 *  2. the frozen SYSTEM_ORDER schedule
 *  3. breedTickSystem                     — after mobAi, before locomotion
 *  4. portalTravelCreate(...).tick()
 *  5. dimCreateLavaAmbient(...).tick(tick)
 * Steps 3-5 buffer ECS adds/removes, so flush before reading their results.
 */
export * from './eventsV2'
export * from './dimension'
export * from './breeding'
export * from './particles'
