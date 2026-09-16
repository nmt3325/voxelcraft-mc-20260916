# VoxelCraft

A Minecraft-like voxel sandbox built with TypeScript, Vite and three.js (WebGL2 / GLSL3).
Infinite seeded terrain, greedy-meshed chunks, sky and block lighting, fluids, mobs, crafting,
block entities, simplified redstone, a Nether dimension, farming, enchanting, particles and
IndexedDB world saves, plus an authoritative WebSocket server for multiplayer.

All textures and sounds are generated procedurally by scripts in this repository, so no
third-party assets are bundled and every asset can be regenerated with `pnpm assets`
(119 atlas layers and 24 WAV effects at this revision).

## Requirements

- Node 22 or newer (developed on v22.23.2)
- pnpm 10 or newer (developed on 10.34.5)
- A WebGL2 browser for playing; Chromium for the headless E2E suite
  (`pnpm exec playwright install chromium`)

## Quick start

```bash
pnpm install

# generate the texture atlas and sound effects
pnpm assets

# serve the game on http://127.0.0.1:5173
pnpm dev
```

`pnpm build` writes a production bundle to `dist/`, and `pnpm preview` serves it.

Each comment sits on its own line on purpose: a shell without `interactive_comments`
enabled (plain `sh`, or a zsh that has not set it) hands a trailing `# ...` to the
command as arguments, and `vite` then exits with `CACError: Unused args`.

### Optional: multiplayer server

```bash
# listens on ws://127.0.0.1:8787/ws
pnpm --filter @voxelcraft/server start
```

`apps/server` is authoritative: it validates movement against the walk budget, rejects
out-of-reach or unknown edits, streams chunks at a bounded rate and kicks malformed clients.
The wire format and its constants live in `@voxelcraft/net` (protocol version 1, 20 Hz tick,
10 Hz snapshots, up to 8 players).

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
| Pause, release the mouse, or go back | `Esc` |
| Debug overlay (fps, position, biome, chunks, draw calls) | `F3` |
| Render distance, FOV, mouse sensitivity | Pause screen, then Settings |

The pointer is released on every screen except the game itself, and a release the browser
performs on its own -- `Esc` in Chrome and Safari, or switching apps on macOS -- pauses the
game instead of leaving the look input running. Click the canvas to capture it again.

Worlds are created and picked from the title screen; each world keeps its seed, so the same
seed always regenerates the same terrain.

## The Nether

An obsidian frame with an inner opening between 2x3 and 21x21 becomes a portal when ignited
(see `PORTAL` in `@voxelcraft/core-types`). Standing inside it for 80 ticks moves the player to
the matching Nether coordinates and starts a 300 tick cooldown. The Nether generates its own
terrain: a lava sea at y=31, a bedrock roof at y=120, quartz ore, glowstone clusters, soul sand
and magma patches, with the portal area lit to level 11.

Known limitation (decision D-063): the save format (`SAVE_VERSION` 1) persists Overworld columns
only, so blocks placed or broken in the Nether are regenerated from the seed on reload. Portal
frames are deterministic and therefore survive a reload.

## Architecture

```text
                     apps/game (Vite entry, frame loop, input, raycast, HUD)
                          |
      +-------------------+--------------------+-------------------+
      |                   |                    |                   |
@voxelcraft/client  @voxelcraft/gameplay  @voxelcraft/sim   @voxelcraft/world
  render/ three.js   block + item registry  fixed 20 Hz tick  seeded noise
  mesher/ greedy+AO  58 crafting recipes    ECS SYSTEM_ORDER  6 biomes + Nether
  worker/ mesh pool  furnace, enchanting    AABB physics      3D-noise caves
  ui/     HUD, menus block entities         fluids, redstone  ores, trees
  audio/  WAV player farming, breeding      sky + block light structures
      |                   |                    |                   |
      +-------------------+---------+----------+-------------------+
                                    |
                         @voxelcraft/core-types
              frozen v1 + v2 contract: block/item ids, constants,
              chunk codec, light/fluid packing, events, RNG helpers

@voxelcraft/net        -> binary protocol: opcodes, framing, inputs, snapshots
apps/server            -> authoritative host: validation, streaming, kicks
@voxelcraft/assets-gen -> 119-layer texture atlas + 24 procedural WAVs
tests/e2e (Playwright) -> boot, persistence, progression, farming, nether,
                          particles, worker (13 tests)
tests/bench            -> chunk gen, chunk mesh, sim tick, light seeding
```

How a chunk flows through the system:

1. `@voxelcraft/world` generates a 16 x 16 x 256 chunk deterministically from the world seed.
2. `@voxelcraft/sim` advances state in fixed 20 Hz ticks, in the order declared by `SYSTEM_ORDER`,
   and propagates light and fluids incrementally.
3. `@voxelcraft/client` meshes an 18-cube padded neighbourhood with greedy meshing plus ambient
   occlusion in a worker pool, then uploads per-section geometry to three.js.
4. `@voxelcraft/gameplay` serializes chunks (palette plus bit packing, magic `56 58 43 01`, codec
   version 1, run-length encoded fluids) into the IndexedDB database `voxelcraft`.
5. In multiplayer, `apps/server` owns the same chunk store, validates every client input and
   broadcasts block changes and snapshots through `@voxelcraft/net`.

Every shared constant lives in `@voxelcraft/core-types` (`CONTRACT_VERSION` 1.1.0 and
`CONTRACT_V2_VERSION` 1.1.0) and is the single source of truth for all other packages.

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

Continuous integration runs the same commands in three jobs (`verify`, `e2e`, `bench`) and
installs with `--frozen-lockfile`.

## Reproducing the release checks

```bash
git clone https://github.com/nmt3325/voxelcraft-mc-20260916.git
cd voxelcraft-mc-20260916
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm -r exec tsc --noEmit && pnpm -r lint && pnpm -r test
pnpm build && pnpm size && pnpm test:e2e && pnpm bench
```

Last measured on an Ubuntu runner with Node v22.23.2 and pnpm 10.34.5: every command exits 0,
the production bundle is 1037502 B raw and 451420 B gzipped, Playwright reports 13 passed
with zero console errors (SwiftShader, render distance 2, 640x360 canvas), and the committed
bench baseline (`tests/bench/results/bench.json`, seed 1337, render distance 8) reports chunk
generation 2.093 ms, chunk meshing 3.717 ms, a sim tick of 1.207 ms and
light seeding 4.647 ms. Bench numbers move by a few tenths of a millisecond between
runs; the budgets and fail thresholds are declared in `PERF` and `BENCH`.

## Workspace layout

| Package | Responsibility |
| --- | --- |
| `packages/core-types` | Shared v1 + v2 contract: blocks, items, recipes, chunk codec, events, protocol |
| `packages/world` | Deterministic terrain: noise, biomes, caves, ores, features, Nether |
| `packages/sim` | Physics, fluids, light propagation, ECS, mob AI, combat |
| `packages/gameplay` | Registries, inventory, crafting, block entities, redstone, farming, persistence |
| `packages/client` | Meshing, renderer, shaders, input, UI, audio, particles |
| `packages/net` | Binary multiplayer protocol: opcodes, framing, encode/decode |
| `packages/assets-gen` | Procedural texture atlas and sound generation |
| `apps/game` | Vite application entry point |
| `apps/server` | Authoritative WebSocket server |
| `tests/e2e` | Playwright headless end-to-end suite |
| `tests/bench` | Performance harness |

## Known limitations

- Nether edits are not persisted; see decision D-063 above.
- Animal breeding is implemented and tested at the `@voxelcraft/gameplay` API level, but the
  client exposes no breeding interaction or herd counter yet (decisions D-064 and D-071).
- Nether chunk generation averages roughly 4.1 to 5.8 ms per chunk, above the 4 ms
  `PERF.chunkGenBudgetMs` target though inside the `BENCH` fail threshold. Overworld generation
  stays near 2.093 ms.

## How this repository was built

VoxelCraft was implemented by a four-level hierarchy of autonomous agents (run label
`mc-20260916`). The shared contract, task split, decisions and per-task reports are kept in the
repository: `docs/orchestration/plan.md`, `docs/orchestration/plan-v2.md`,
`docs/orchestration/decisions.md`, `docs/reports/*.json`, and six independent review reports in
`docs/reviews/*.md`.

## License

MIT - see `LICENSE`.
