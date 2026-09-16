/**
 * Particle event emission for the v1.1 simulation.
 *
 * The simulation publishes `EVENT_V2.ParticleSpawn` and enforces the per-tick
 * spawn budget; the client subtree owns rendering and particle simulation.
 */
export * from './particleEvents'
