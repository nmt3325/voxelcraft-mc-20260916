export const PACKAGE_NAME = '@voxelcraft/gameplay'

// Block and item definition tables plus their registries.
export * from './blocks'
export * from './items'
// Chest / furnace / crafting table / door / bed payloads and behaviour.
export * from './blockEntities'
// Shared world abstraction used by block entities, redstone and persistence.
export * from './support'
// 36-slot inventory, stack merging, tool durability and game-mode rules.
export * from './inventory'
// Recipe registry, shaped/shapeless crafting and furnace smelting.
export * from './crafting'
