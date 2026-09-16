# rev4 — independent review (Phase 8 / v1.1.0 integration)

- Reviewer: rev4, independent. Branch `review/rev4`, based on `origin/integration/mc-20260916`.
- Reviewed commit: `9573084` ("Merge remote-tracking branch 'origin/l0-docs3' into l0-integ"). The task named `dae16174` as the integration head at launch; integration advanced before this review started, so everything below is measured on `9573084`.
- Scope: `packages/gameplay`, `packages/client`, `packages/assets-gen`, `apps/game`, `tests/e2e`, `tests/bench`.
- Environment: gha mcp runner env `linux-8jp3kpf1`, worktree `…/work/vc/wt/rev4`, node v22.23.2, pnpm 10.34.5, Playwright chromium installed.

## Verdict

**Request changes.**

Every gate is green and every hardening item H-01…H-06 is genuinely fixed (details in
[Hardening verification](#hardening-verification)). The problem is what the gates do not
cover: none of the Phase 8 feature set is reachable from the shipped app, and the v2 blocks
that overworld generation *does* write into an ordinary world are undefined in every
registry and property table the app consults. That is a player-visible defect (indestructible,
shadowless village blocks) on top of a large amount of dead feature code, and it passes all
seven gates unnoticed.

## Gate table

All gates were run from the review worktree by one driver script
(`/tmp/rev4-gates.sh`, job `b39a58715a0c45f2`), sequentially, one heavy build at a time.

| # | Command | Exit code | Wall | Notes |
|---|---------|-----------|------|-------|
| 1 | `pnpm -r exec tsc --noEmit` | 0 | 32 s | clean |
| 2 | `pnpm -r lint` | 0 | 13 s | clean |
| 3 | `pnpm -r test` | 0 | 57 s | all package unit suites |
| 4 | `pnpm build` | 0 | 3 s | vite 8.3.0, 202 modules |
| 5 | `pnpm size` | 0 | 1 s | TOTAL raw 996532 / gzip 437851 |
| 6 | `pnpm test:e2e` | 0 | 27 s | `10 passed (21.9s)`, 1 worker |
| 7 | `pnpm bench` | 0 | 6 s | all budgets ok |

Gate 4/6 build output: `assets-gen: atlas.png 34673 bytes, 27 files written`,
`dist/assets/index-BdEiw_Tz.js 721.51 kB (gzip 198.82 kB)`,
`dist/assets/mesher.worker-CaCQdkwD.js 14.12 kB`.

Gate 7 figures: `chunkGenAvgMs = 2.607` (budget 6, fail > 18) ok,
`chunkMeshAvgMs = 4.323` (budget 12) ok, `simTickAvgMs = 1.876` (budget 8) ok,
`sectionMeshAvgMs = 0.865` (budget 1.5); light seed+stitch `1403.973 ms` over 225 decorated
chunks ≈ **6.24 ms/chunk**, against the H-05 target of ≤ 15 ms (was ~45 ms).

## Blockers

### B-01 — Every v2 block and item id is undefined in the registries and tables the app uses

The contract defines 18 `BLOCK_V2` ids (64…81) and 18 `ITEM_V2` ids (305…322). None of them
are defined in the registries `apps/game` imports, and no v2 block registry exists at all:

- `packages/gameplay/src/blocks/registry.ts:129` — `BLOCKS = createBlockRegistry(BLOCK_DEFS)`;
  `BLOCK_DEFS` (`blocks/blockDefs.ts:476`) holds v1 only. `BLOCKS.count() === 64`.
- `packages/gameplay/src/items/registry.ts:73` — `ITEMS = createItemRegistry(ITEM_DEFS)`, v1 only.
- `packages/gameplay/src/crafting/registry.ts:225` — `RECIPES = createRecipeRegistry(RECIPE_DEFS)`, 53 recipes.
- The opt-in variants `createV2ItemRegistry()` / `createV2RecipeRegistry()` (58 recipes) exist but
  are referenced only from `packages/gameplay/src/v2items/v2items.test.ts`. There is no
  `BLOCK_V2_DEFS` or `createV2BlockRegistry` anywhere in `packages/gameplay/src`.

Measured (probe A, job `d835d7e66ba141fd`):

```text
BLOCK_V2 total=18 missingFromBLOCKS=18      (all 18 report gameplayDef=MISSING)
BLOCKS.count()=64 v1 STONE def=true
ITEM_V2 total=18 missingFromITEMS=18
missing: WHEAT_SEEDS:305, WHEAT:306, BREAD:307, CARROT:308, POTATO:309, BAKED_POTATO:310,
         ENCHANTED_BOOK:311, NETHER_QUARTZ:312, FLINT_AND_STEEL:313, EGG:314, RAW_BEEF:315,
         COOKED_BEEF:316, RAW_PORK:317, COOKED_PORK:318, RAW_CHICKEN:319, COOKED_CHICKEN:320,
         MUTTON:321, LEATHER:322
default RECIPES count=53
createV2RecipeRegistry count=58
```

The same probe shows the client *does* know how to draw all 18
(`packages/client/src/mesher/appearance.ts:268-332`, every id reports `clientAppearance=yes`),
so this is a registry gap, not a render gap.

**This is reachable in a normal game, not a theoretical gap.** Villages are decorated by the
overworld generator that `apps/game` instantiates (`packages/world/src/index.ts:76-79`,
`decorate()` → `features.decorator.decorate` then `villages.decorate`; `apps/game` builds its
ChunkWorld on `createWorldGenerator(seed)`). With the E2E seed 1337, the nearest planned village
is 636 blocks from the origin and is built entirely out of undefined ids
(probe B, job `abac91c248ac4e15`):

```text
seed=1337 regions scanned=49 villages planned=7
nearest village: region(0,1) center block(72,632) distance=636 blocks, pieces=7
decorated 121 chunks around chunk(4,39)
FENCE              id= 80 voxels=    40 BLOCKS.tryById=undefined
GRAVEL_PATH        id= 77 voxels=    32 BLOCKS.tryById=undefined
FARMLAND           id= 70 voxels=    20 BLOCKS.tryById=undefined
WHEAT_CROP         id= 72 voxels=    19 BLOCKS.tryById=undefined
COBBLESTONE_WALL   id= 78 voxels=     8 BLOCKS.tryById=undefined
FARMLAND_WET       id= 71 voxels=     5 BLOCKS.tryById=undefined
HAY_BLOCK          id= 79 voxels=     1 BLOCKS.tryById=undefined
FENCE_GATE         id= 81 voxels=     1 BLOCKS.tryById=undefined
total v2 voxels=126 undefinedInGameplayRegistry=126
```

Consequences that follow directly from the code paths in scope:

1. **Indestructible and unplaceable.** `apps/game/src/main.ts:383-385` aborts the break when
   `BLOCKS.tryById(previous) === undefined`, and `main.ts:398-401` aborts the place when
   `BLOCKS.tryById(id) === undefined`. Every village voxel above, and every nether block
   (`NETHERRACK`, `QUARTZ_ORE`, `MAGMA_BLOCK`, `SOUL_SAND`), is therefore permanently
   unbreakable and can never be held or placed.
2. **Treated as air by lighting and fluids.** `apps/game/src/world/chunkWorld.ts:53` takes
   `lightPropsOf` from `@voxelcraft/sim`, whose table is v1-sized and falls back to the air
   entry for anything above it (`packages/sim/src/shared/blockProps.ts:172-176`). Measured
   (probe C, job `6372555c227c4072`): every v2 id reports `opacity=0 skyPassThrough=true
   simSolid=false simFullCube=false simReplaceable=true`, identical to `AIR`, while `STONE`
   reports `opacity=15 skyPassThrough=false simSolid=true`. Village walls, hay and fences cast
   no shadow, let skylight straight through, and are "replaceable" to sim-side logic. The
   gameplay registry has the same air-like fallback by design
   (`blocks/registry.ts:13-18` `UNKNOWN_LIGHT_PROPS`, probe D job `5a17fd00366e4e1a`).
   Player collision still works only because `main.ts:337-339` uses its own
   "not air and not fluid" test rather than the registry.
3. **Unobtainable items and recipes.** The 18 v2 items and the 5 v2 recipes cannot be crafted,
   held or dropped in the shipped app, because the app instantiates the v1-only registries.

Suggested fix direction (owner's call): define the v2 blocks in `packages/gameplay` (a
`BLOCK_V2_DEFS` table plus a v2 registry factory, mirroring `v2items`), extend the sim block
property table through `BLOCK_V2_MAX`, and have `apps/game` build the v2 registries. Until the
block defs exist, nothing downstream can behave correctly.

## Majors

### M-01 — No Phase 8 gameplay system is wired into `apps/game`

`apps/game/src/main.ts` imports exactly `BLOCKS, addStack, craftFromInventory, heldStack,
isCreative, makeStack, removeItem, selectHotbar, swapCursorWithSlot` from `@voxelcraft/gameplay`,
and `apps/game/src/ui-bridge.ts` imports `ITEMS, craftableFromInventory, createInventoryState,
heldStack, makeStack, maxDurabilityOf, remainingDurability`. A grep across `apps/game/src`,
`packages/client/src` and `tests` for the v2 gameplay entry points
(`tillFarmland`, `advanceFarmland`, `grantXp`/`addXp`, `enchantOffers`/`applyEnchant`,
`feedAnimal`/`tryBreed`, …) returns **no matches at all** (job `90040388409041bf`).
XP, enchanting, farmland hydration, the 8-stage crop growth and breeding therefore never run
outside their own unit tests. The only trace of them in the app is cosmetic: `main.ts:419-421`
plays a sound cue when the player stands near `BLOCK_V2.ENCHANTING_TABLE`/`BOOKSHELF`, blocks
that (per B-01) can never exist in a player-reachable form.

### M-02 — Nether and portals are unreachable from the app

`createWorldGenerator(seed, dimension = DIMENSION.Overworld)` is called from `apps/game` without
a dimension; the app holds a single `ChunkWorld` and never imports `createPortalLinker`,
`portalTravel` or `createDimensionState` (job `90040388409041bf`: no hits outside `packages/sim`).
`main.ts portalCue()` (451-470) only fires when the camera eye is inside a
`BLOCK_V2.NETHER_PORTAL` voxel, which nothing in the app can create. The nether generator,
portal linker and travel rules are complete but dead from the player's point of view.

### M-03 — The multiplayer net layer is unreachable from the client app

`grep -rn "@voxelcraft/net\|WebSocket" apps/game/src` returns nothing; `NET` is imported from
`core-types` only for `NET.tickHz` (particle dt scaling, `main.ts:848`). `packages/net` and
`apps/server` exist and are tested, but the shipped client has no way to connect, so "authoritative
multiplayer" is not a user-facing feature of this build.

### M-04 — The gate set cannot detect M-01…M-03 or B-01

The E2E suite covers boot, worker meshing, particles and persistence only
(`tests/e2e/specs/{boot,worker,particles,persistence}.spec.ts`, 10 tests). Nothing asserts that a
feature is reachable from `apps/game`: no spec opens the enchanting or farming UI, walks to a
village, breaks a generated v2 block, or checks that a v2 item can be obtained. As a result an
entire phase of work can land with seven green gates while being unreachable in the product.
Recommend at least one "reachability" E2E per feature area (or an app-level registry assertion
that every id world generation can emit is defined in the registries the app builds).

## Minors

- **m-01 — Audio is silent-by-design on every failure path and no gate notices.**
  `packages/client/src/audio/index.ts:47-69` returns a no-op handle when `AudioContext`, `fetch`
  or the manifest is missing, and `play()` (109-133) swallows all errors;
  `apps/game/src/assets.ts:19-30` returns `null` for any non-ok manifest response. The
  `voxelcraft.assetsReady` event (`main.ts:948-952`, detail `{generated, sounds}`) is dispatched but
  never asserted in E2E, so a build that ships with no sounds still passes. This is rev2's R2-02
  only partly addressed: the `console.warn` gate (H-02) catches a *failed* load, not a legitimately
  absent manifest.
- **m-02 — Unthrottled per-frame sound/particle triggers.** `portalCue()` runs every frame and
  `burstAt()` plays `SOUND_EVENT.ParticlePop` on every break/place; the only throttle is
  `SOUND_EVENT_MIN_INTERVAL_MS` inside `createSoundEvents` (`audio/events.ts:37-45`). It works, but
  the call-site contract is "spam and let the mixer drop", which is easy to break later.
- **m-03 — Particle budget is per-`update()`, not per-simulated-tick.**
  `ParticlePool.update()` resets `spawnedThisTick` (`particles/pool.ts:93-116`), so the 256/tick cap
  scales with frame rate; `spawn()` overwrites the oldest live particle via `oldestSlot()`
  (172-182), an O(live) scan up to `PARTICLE_BUDGET` 2048 on every spawn once full.
- **m-04 — `drawCalls` is derived, not measured.** `ParticleRenderer` reports `1/0`
  (`particles/renderer.ts:119-121`) and sets `points.frustumCulled = false`; fine as an intentional
  choice, but the E2E assertions on `drawCalls` are therefore tautological.
- **m-05 — `apps/game/package.json` still depends on `@voxelcraft/assets-gen`** while nothing in
  `apps/game/src` imports it (assets are consumed as built files). rev2's R2-07 partially persists.
- **m-06 — `MeshDebugInfo.droppedQuads` is a hard-coded `0`** (`mesher/greedy.ts:287,327`). Correct
  now that batches split instead of dropping, but a constant reported as a measurement will mask a
  future regression.
- **m-07 — Review drift.** Integration moved from `dae16174` (task) to `9573084` (reviewed) while the
  review ran. Worth pinning the sha in the launch prompt for the final release review.

## Hardening verification

| Item | Status | Evidence |
|------|--------|----------|
| H-01 worker path covered by E2E | fixed | `tests/e2e/specs/worker.spec.ts` boots `?test=1&…&workers=1` and asserts `workers>0`, `inline===0`, `worker===meshed`, `errors===0`, `state.quads>0`, plus an edit re-mesh test and a `workers=0` inline control. 3 tests, green in gate 6. |
| H-02 `console.warn` fails E2E | fixed | `tests/e2e/src/harness.ts:97-108` `collectConsoleIssues` records `console.error`, `console.warn` and `pageerror`; every spec asserts `issues.join(' \| ') === ''`. |
| H-03 no self-skipping specs | fixed | `waitForTestApi` throws `MISSING_TEST_API` after 30 s (`harness.ts:110-125`); `grep -rn "test.skip\|skip(" tests/e2e` → no matches. |
| H-04 u16 index overflow | fixed | `mesher/greedy.ts:65` `MAX_VERTICES_PER_BATCH = 65532`; `beginQuad()` closes a batch before overflow; `toBuffers()` emits multiple `MeshBuffer`s. `packages/client/src/__tests__/mesherOverflow.test.ts` (3 cases) proves 16384 cross quads → 2 batches with batch-local indices `0..vertexCount-1`. |
| H-05 light seeding ≤ 15 ms/chunk | fixed | gate 7: `light seed+stitch 1403.973 ms` / 225 decorated chunks ≈ 6.24 ms/chunk. |
| H-06 chunkGen budget | fixed | gate 7: `chunkGenAvgMs = 2.607` against budget 6 (fail > 18). |
| rev2 R2-04 bench fixtures | fixed | `tests/bench/src/bench.ts` uses `createWorldGenerator`, `createSimVoxelWorld`/`lightCreateEngine`/`fluidCreateEngine`/`createPhysicsSystem` and the real client mesher via `loadMesher()`; `meta.fixtureSubstitution.used: false`. Bench log confirms `mesher=client`, `real world gen v1`, 289 chunks generated / 225 decorated / 36452 quads. |

## Evidence and reproduction

All work ran on gha mcp env `linux-8jp3kpf1` in `…/work/vc/wt/rev4`. Probe scripts were written
outside the repo (`/tmp`) so the worktree stays clean; they import the workspace sources by
absolute path and run under `pnpm exec tsx`.

| Ref | Job | Command |
|-----|-----|---------|
| gates | `b39a58715a0c45f2` | `bash /tmp/rev4-gates.sh` (logs in `/tmp/rev4-gates/*.log`, summary ends `ALL_DONE`) |
| probe A (registries) | `d835d7e66ba141fd` | `pnpm exec tsx /tmp/rev4-probe1.mts` |
| probe B (village) | `abac91c248ac4e15` | `pnpm exec tsx /tmp/rev4-probe3.mts 1337 3` |
| probe C (sim tables) | `6372555c227c4072` | `pnpm exec tsx /tmp/rev4-probe5.mts` |
| probe D (gameplay tables) | `5a17fd00366e4e1a` | `pnpm exec tsx /tmp/rev4-probe4.mts` |
| v2 caller greps | `90040388409041bf`, `16cf7b6778884756` | `grep -rn` over `apps`, `packages/client`, `packages/sim`, `tests` |

Probe A core (registry gap):

```ts
const core = await import(`${WT}/packages/core-types/src/index.ts`)
const gameplay = await import(`${WT}/packages/gameplay/src/index.ts`)
const appearance = await import(`${WT}/packages/client/src/mesher/appearance.ts`)
for (const key of Object.keys(core.BLOCK_V2)) {
	const id = core.BLOCK_V2[key]
	console.log(key, id, gameplay.BLOCKS.tryById(id) === undefined ? 'MISSING' : 'def',
		appearance.appearanceOf(id) ? 'appearance=yes' : 'appearance=no')
}
```

Probe B core (village blocks in a normal overworld):

```ts
const terrain = world.createTerrain(SEED, world.createNoiseBasis(SEED))
const planner = world.createVillagePlanner(terrain)   // nearest plan to the origin
const generator = world.createOverworldGenerator(SEED) // same generator apps/game uses
// generate an 13x13 chunk window around the plan, decorate the inner 11x11,
// then count ids in 64..99 and check gameplay.BLOCKS.tryById(id)
```

E2E screenshots from the green gate run are in `tests/e2e/test-results/`
(`boot.png`, `boot-test-mode.png`, `ui-hud.png`, `seeded-boot.png`,
`persistence-after-reload.png`).

## What I did not review

`packages/net`, `packages/world`, `packages/sim` and `apps/server` internals are outside the rev4
scope; they appear above only where the app in scope consumes them (B-01 item 2, M-02, M-03).
The frozen contract in `packages/core-types/src` and `/src/v2` was treated as authoritative.
