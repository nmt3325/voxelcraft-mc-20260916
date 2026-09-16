# VoxelCraft

A Minecraft-like voxel sandbox built with TypeScript, Vite and three.js (WebGL2 / GLSL3).
Infinite seeded terrain, greedy-meshed chunks, sky and block lighting, fluids, mobs, crafting,
block entities, simplified redstone and IndexedDB world saves.

All textures and sounds are generated procedurally by scripts in this repository, so no
third-party assets are bundled and every asset can be regenerated with `pnpm assets`.

## Requirements

- Node 22 or newer (developed on v22.23.2)
- pnpm 10 or newer (developed on 10.34.5)
- A WebGL2 browser for playing; Chromium for the headless E2E suite
  (`pnpm exec playwright install chromium`)

## Quick start

```bash
pnpm install
pnpm assets      # generate the texture atlas and sound effects
pnpm dev         # http://127.0.0.1:5173
```

`pnpm build` writes a production bundle to `dist/`, and `pnpm preview` serves it.

## Controls

| Action | Input |
| --- | --- |
| Capture the mouse | Click the canvas once (pointer lock) |
| Look around | Mouse movement |
| Move | `W` `A` `S` `D` |
| Sprint | `Shift` |
| Jump, swim upwards | `Space` |
| Break the targeted block | Left click |
| Place the held block | Right click |
| Select a hotbar slot | `1` - `9` |
| Inventory, 2x2 and 3x3 crafting | `E` |
| Pause, go back, release the pointer | `Esc` |
| Debug overlay (fps, position, biome, chunks, draw calls) | `F3` |
| Render distance, FOV, mouse sensitivity | Pause screen, then Settings |

Worlds are created and picked from the title screen; each world keeps its seed, so the same
seed always regenerates the same terrain.

## Architecture

```text
                       apps/game  (Vite entry, frame loop, input, raycast, HUD wiring)
                            |
      +---------------------+-----------------------+----------------------+
      |                     |                       |                      |
@voxelcraft/client   @voxelcraft/gameplay     @voxelcraft/sim      @voxelcraft/world
  render/  three.js    block + item registry    fixed 20 Hz tick     seeded noise
  mesher/  greedy+AO   53 crafting recipes      ECS SYSTEM_ORDER     6 biomes
  worker/  mesh pool   furnace smelting         AABB physics         3D-noise caves
  ui/      HUD, menus  block entities           fluids water/lava    ore distribution
  audio/   WAV player  redstone, persistence    sky + block light    trees, vegetation
      |                     |                       |                      |
      +---------------------+-----------+-----------+----------------------+
                                        |
                             @voxelcraft/core-types
                   frozen contract: block/item ids, constants, chunk
                   codec, light and fluid packing, events, RNG helpers

           @voxelcraft/assets-gen  ->  73-layer texture atlas + 19 procedural WAVs
           tests/e2e (Playwright)  ->  boot, break, place, save, reload, screenshot
           tests/bench             ->  chunk gen, chunk mesh, section mesh, sim tick
```

How a chunk flows through the system:

1. `@voxelcraft/world` generates a 16 x 16 x 256 chunk deterministically from the world seed.
2. `@voxelcraft/sim` advances state in fixed 20 Hz ticks, in the order declared by `SYSTEM_ORDER`,
   and propagates light and fluids incrementally.
3. `@voxelcraft/client` meshes an 18-cube padded neighbourhood with greedy meshing plus ambient
   occlusion in a worker pool, then uploads per-section geometry to three.js.
4. `@voxelcraft/gameplay` serializes chunks (palette plus bit packing, magic `56 58 43 01`, codec
   version 1, run-length encoded fluids) into the IndexedDB database `voxelcraft`.

Every shared constant lives in `@voxelcraft/core-types` (`CONTRACT_VERSION` 1.0.0) and is the
single source of truth for all other packages.

## Verification commands

| Goal | Command |
| --- | --- |
| Types | `pnpm -r exec tsc --noEmit` (alias `pnpm typecheck`) |
| Lint | `pnpm -r lint` |
| Unit tests | `pnpm -r test` |
| Production build | `pnpm build` (outputs `dist/`) |
| Bundle size | `pnpm size` |
| E2E (headless) | `pnpm test:e2e` |
| Performance harness | `pnpm bench` |
| Formatting | `pnpm format` / `pnpm format:check` |

## Reproducing the release checks

```bash
git clone https://github.com/nmt3325/voxelcraft-mc-20260916.git
cd voxelcraft-mc-20260916
pnpm install
pnpm exec playwright install chromium
pnpm -r exec tsc --noEmit && pnpm -r lint && pnpm -r test
pnpm build && pnpm size && pnpm test:e2e && pnpm bench
```

Last measured on an Ubuntu runner with Node v22.23.2 and pnpm 10.34.5: every command exits 0,
the bundle is 767,099 B raw and 305,763 B gzipped, Playwright reports 4 passed with zero console
errors (SwiftShader, render distance 2, 640x360 canvas), and the bench harness reports chunk
generation 0.303 ms, chunk meshing 4.157 ms, section meshing 0.831 ms and a sim tick of 0.083 ms.

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

## How this repository was built

VoxelCraft was implemented by a four-level hierarchy of autonomous agents (run label
`mc-20260916`). The shared contract, task split, decisions and per-task reports are kept in the
repository: `docs/orchestration/plan.md`, `docs/orchestration/decisions.md`,
`docs/reports/*.json` and independent review reports in `docs/reviews/*.md`.

## License

MIT - see `LICENSE`.
