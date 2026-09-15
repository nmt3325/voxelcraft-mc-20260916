# VoxelCraft

A Minecraft-like voxel sandbox built with TypeScript, Vite and three.js (WebGL2).
All textures and sounds are generated procedurally by scripts in this repository:
no third-party assets are bundled.

> Status: scaffold. Built by a hierarchical multi-agent orchestration run (`mc-20260916`).
> Architecture, controls and reproduction steps are finalized before v1 sign-off.

## Quick start

```bash
pnpm install
pnpm assets      # generate textures + sounds into packages/*/generated
pnpm dev         # http://127.0.0.1:5173
```

## Verification commands

| Goal | Command |
| --- | --- |
| Types | `pnpm -r exec tsc --noEmit` |
| Lint | `pnpm -r lint` |
| Unit tests | `pnpm -r test` |
| Production build | `pnpm build` (outputs `dist/`) |
| Bundle size | `pnpm size` |
| E2E (headless) | `pnpm test:e2e` |
| Performance harness | `pnpm bench` |

## Workspace layout

| Package | Responsibility |
| --- | --- |
| `packages/core-types` | Shared contract: blocks, items, recipes, chunk serialization, events, mobs |
| `packages/world` | Deterministic terrain: noise, biomes, caves, ores, features |
| `packages/sim` | Physics, fluids, light propagation, ECS, mob AI, combat |
| `packages/gameplay` | Block/item registries, inventory, crafting, block entities, redstone, persistence |
| `packages/client` | Meshing, renderer, shaders, input, UI, audio |
| `packages/assets-gen` | Procedural texture atlas and sound generation |
| `apps/game` | Vite application entry point |
| `tests/e2e` | Playwright headless end-to-end suite |
| `tests/bench` | Performance harness |

## License

MIT - see `LICENSE`.
