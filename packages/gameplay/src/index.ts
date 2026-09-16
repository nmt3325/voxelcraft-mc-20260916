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
// Chunk codec, world stores (IndexedDB / memory / fs) and batched writes.
export * from './persistence'
// Redstone wire propagation, inputs, doors, lamps and pistons.
export * from './redstone'
// Experience orbs, the level curve and the xp gains that feed them.
export * from './experience'

// Farmland, hydration and the eight-stage crop growth cycle.
export * from './farming'
// Both redstone and farming answer "can this block be replaced": keep the
// redstone meaning as the default export and expose the farming one by name.
export { isReplaceable } from './redstone'
export { isReplaceable as isFarmReplaceable } from './farming'

// Enchantment tables, deterministic offers and the applied tool effects.
export * from './enchanting'
// Fortune appears in two drop paths: the enchanting helper is the general
// roll, the farming one is the positional crop roll.
export { fortuneBonus } from './enchanting'
export { fortuneBonus as cropFortuneBonus } from './farming'
