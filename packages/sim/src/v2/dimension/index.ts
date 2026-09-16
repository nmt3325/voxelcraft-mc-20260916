// v2 dimension subtree barrel: per-dimension world and light state, the portal
// travel state machine and the terrain hook they need. Every exported symbol is
// prefixed (`dim*`, `Dim*`, `DIM_*`, `portalTravel*`, `PortalTravel*`) so the
// package barrel can keep using `export *` without collisions.
export * from './terrainAccess'
export * from './dimensionState'
export * from './portalTravel'
