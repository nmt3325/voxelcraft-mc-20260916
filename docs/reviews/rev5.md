# rev5 - independent review of integration/mc-20260916

- Reviewed sha: `40e1a3f5c6d35ad364af6e49a296a64756921850`
- Date (UTC): 2026-09-16
- Reviewer: rev5, independent. Every fact below comes from a command I ran myself on the runner.
- Worktree: `/home/runner/work/_temp/gha-mcp/linux-8jp3kpf1/work/vc/wt/rev3`, branch `review/rev5`
- Scope: gameplay and world correctness, and whether the v2 feature set is genuinely reachable rather than dead code.

## Verdict

**request changes**

One blocker, three majors, six minors. All eight gates are green on this sha, and that is part of the finding: the blocker sits in the only code path the running game uses for breaking and placing v2 blocks, and no gate can see it. I proved that by breaking that path on purpose and watching every relevant gate stay green (section 8.2).

## Sync to the head containing the newest L0 commit

```
$ git fetch origin --prune
$ git merge-base --is-ancestor c6d3ce964e9d963b5e2ba930302d5b756f91587f origin/integration/mc-20260916
ANCESTOR_NOT_YET        (first attempt)
ANCESTOR_OK attempt=2   (after sleep 60)
$ git reset --hard origin/integration/mc-20260916
HEAD is now at 40e1a3f
$ git rev-parse HEAD
REVIEWED_SHA=40e1a3f5c6d35ad364af6e49a296a64756921850
```

## 1. Gate set, run by me on a clean tree, in the prescribed order

Driver: `/tmp/rev5-gates.sh`. Each gate ran unpiped and its exit code was captured from `$?` on the next line, so no code is masked by a pipeline.

| # | command | exit code |
| --- | --- | --- |
| 1 | `pnpm install --no-frozen-lockfile` | 0 |
| 2 | `pnpm -r exec tsc --noEmit` | 0 |
| 3 | `pnpm -r lint` | 0 |
| 4 | `pnpm -r test` | 0 |
| 5 | `pnpm build` | 0 |
| 6 | `pnpm size` | 0 |
| 7 | `pnpm test:e2e` | 0 |
| 8 | `pnpm bench` | 0 |

Verbatim summary written by the driver:

```
pnpm install --no-frozen-lockfile|exit=0
pnpm -r exec tsc --noEmit|exit=0
pnpm -r lint|exit=0
pnpm -r test|exit=0
pnpm build|exit=0
pnpm size|exit=0
pnpm test:e2e|exit=0
pnpm bench|exit=0
```

Unit totals from gate 4 (`Scope: 11 of 12 workspace projects`):

```
packages/core-types test:  Test Files  5 passed (5)        Tests  46 passed (46)
tests/e2e test:            Test Files  1 passed (1)        Tests   3 passed (3)
packages/assets-gen test:  Test Files  5 passed (5)        Tests  32 passed (32)
packages/net test:         Test Files 11 passed (11)       Tests 149 passed (149)
packages/world test:       Test Files 12 passed (12)       Tests 176 passed (176)
apps/server test:          Test Files 10 passed (10)       Tests 106 passed (106)
packages/sim test:         Test Files 21 passed (21)       Tests 166 passed (166)
packages/gameplay test:    Test Files 18 passed (18)       Tests 220 passed (220)
packages/client test:      Test Files 12 passed (12)       Tests 140 passed (140)
apps/game test:            Test Files  2 passed (2)        Tests   9 passed (9)
```

Gate 7 (`pnpm test:e2e`), all 13 specs:

```
Running 13 tests using 1 worker
  ok   5 specs/farming.spec.ts:51:2 > farming > a tilled plot grows a crop on the fixed schedule and yields a harvest (1.4s)
  ok   6 specs/nether.spec.ts:20:2 > nether > a portal carries the player to the nether and back (1.5s)
  ok   9 specs/persistence.spec.ts:26:2 > deterministic world persistence > break, place, save and reload restore the same world state (3.1s)
  ok  10 specs/progression.spec.ts:21:2 > experience > breaking ore grants xp, spawns particles and updates the hud (1.5s)
  13 passed (22.1s)
```

Gate 6 tail: `TOTAL raw=1040207 gzip=452273`. Gate 8 budgets:

```
[bench] chunkGenAvgMs = 2.125 ms (budget 6 ms, fail > 18 ms) -> ok
[bench] chunkMeshAvgMs = 3.609 ms (budget 12 ms, fail > 36 ms) -> ok
[bench] simTickAvgMs = 1.156 ms (budget 8 ms, fail > 24 ms) -> ok
[bench] lightSeedAvgMs = 4.627 ms (budget 6 ms, fail > 18 ms) -> ok
```

## 2. Status of every earlier finding

| earlier finding | status on this sha | where proved |
| --- | --- | --- |
| B-01: BLOCK_V2 / ITEM_V2 ids do not resolve through the shipped registries | **closed** | section 3 |
| major: XP and orbs unreachable | **closed**, player can trigger it | section 6 |
| major: enchanting unreachable | **closed**, player can trigger it | section 6 |
| major: farming and crops unreachable | **closed**, player can trigger it | section 6 |
| major: Nether and portals unreachable | **closed**, player can trigger it | section 6 |
| major: breeding unreachable | **not closed**, still dead code in the app | M-01 |

## Blockers

### B-02: the running game resolves v2 blocks from an app-local duplicate table that contradicts the shipped definitions

B-01 was fixed inside `packages/gameplay`, but `apps/game` still breaks and places blocks through its own merged table, so the fix does not reach the player. `apps/game/src/main.ts` never consults `BLOCKS`:

```
$ grep -n 'registries' apps/game/src/main.ts
88:import { BLOCKS_V2, V2_INVENTORY } from './registries'
$ sed -n '505,545p' apps/game/src/main.ts
		const breakAt = (x: number, y: number, z: number): boolean => {
			const previous = world.blockAt(bx, by, bz)
			if (previous === BLOCK.AIR) return false
			const definition = BLOCKS_V2.tryById(previous)
			// A negative hardness is the contract's "unbreakable", such as bedrock.
			if (definition === undefined || definition.hardness < 0) return false
			if (!world.setBlock(bx, by, bz, BLOCK.AIR)) return false
			if (!isCreative(gameMode)) {
				const itemId = definition.itemId ?? null
				if (itemId !== null) addStack(player.inventory, makeStack(itemId, 1), V2_INVENTORY)
			}
		const placeAt = (x: number, y: number, z: number, id: BlockId): boolean => {
			const definition = BLOCKS_V2.tryById(id)
			if (definition === undefined) return false
```

(`game/dimensions.ts:88,108` use `BLOCKS_V2.isSolid` for collision, `game/progression.ts:65,139` use `ITEMS_V2` for tool class and names. `BLOCKS`/`ITEMS` from `@voxelcraft/gameplay` are imported nowhere in `apps/game/src`.)

I diffed the two tables field by field with a scratch probe that imports exactly what the app imports (`@voxelcraft/gameplay` and `apps/game/src/registries`), then deleted the probe. Output, verbatim:

```
DRIFT_PROBE_EXIT=0
id 64 netherrack DRIFT 2
    minTier: gameplay=1 app=0
    drops: gameplay=[{"item":64,"min":1,"max":1,"chance":1,"requiresTier":1}] app=[{"item":64,"min":1,"max":1,"chance":1,"requiresTier":0}]
id 65 nether_portal DRIFT 3
    hardness: gameplay=-1 app=0
    itemId: gameplay=0 app=65
    replaceable: gameplay=true app=false
id 66 soul_sand IDENTICAL
id 67 quartz_ore DRIFT 2
    displayName: gameplay=Quartz Ore app=Nether Quartz Ore
    drops: gameplay=[{"item":312,"min":1,"max":1,"chance":1,"requiresTier":1}] app=[{"item":67,"min":1,"max":1,"chance":1,"requiresTier":0}]
id 68 nether_bricks DRIFT 2
    minTier: gameplay=1 app=0
    drops: gameplay=[{"item":68,...,"requiresTier":1}] app=[{"item":68,...,"requiresTier":0}]
id 69 magma_block DRIFT 2
    minTier: gameplay=1 app=0
    drops: gameplay=[{"item":69,...,"requiresTier":1}] app=[{"item":69,...,"requiresTier":0}]
id 70 farmland IDENTICAL
id 71 farmland_wet DRIFT 2
    displayName: gameplay=Farmland Wet app=Wet Farmland
    itemId: gameplay=70 app=71
id 72 wheat_crop DRIFT 4
    displayName: gameplay=Wheat Crop app=Wheat
    itemId: gameplay=0 app=72
    replaceable: gameplay=true app=false
    drops: gameplay=[{"item":305,"min":1,"max":1,"chance":1,"requiresTier":0}] app=[]
id 73 carrot_crop DRIFT 4
    displayName: gameplay=Carrot Crop app=Carrots
    itemId: gameplay=0 app=73
    replaceable: gameplay=true app=false
    drops: gameplay=[{"item":308,...}] app=[]
id 74 potato_crop DRIFT 4
    displayName: gameplay=Potato Crop app=Potatoes
    itemId: gameplay=0 app=74
    replaceable: gameplay=true app=false
    drops: gameplay=[{"item":309,...}] app=[]
id 75 enchanting_table DRIFT 5
    fullCube: gameplay=true app=false
    opacity: gameplay=15 app=0
    emission: gameplay=0 app=7
    skyPassThrough: gameplay=false app=true
    drops: gameplay=[{"item":75,...,"requiresTier":1}] app=[{"item":75,...,"requiresTier":0}]
id 76 bookshelf IDENTICAL
id 77 gravel_path IDENTICAL
id 78 cobblestone_wall DRIFT 4
    minTier: gameplay=1 app=0
    skyPassThrough: gameplay=false app=true
    layer: gameplay=1 app=0
    drops: gameplay=[{"item":78,...,"requiresTier":1}] app=[{"item":78,...,"requiresTier":0}]
id 79 hay_block DRIFT 1
    displayName: gameplay=Hay Block app=Hay Bale
id 80 fence DRIFT 2
    skyPassThrough: gameplay=false app=true
    layer: gameplay=1 app=0
id 81 fence_gate DRIFT 2
    skyPassThrough: gameplay=false app=true
    layer: gameplay=1 app=0
DRIFT_IDS=14 of 18
PORTAL gameplay hardness=-1 itemId=0 drops=[]
PORTAL app      hardness=0 itemId=65 drops=[]
PORTAL app breakable by main.ts rule (hardness < 0 blocks it): true
PORTAL app item form: null
QUARTZ_ORE gameplay drops=[{"item":312,...,"requiresTier":1}] -> nether_quartz
QUARTZ_ORE app      drops=[{"item":67,...,"requiresTier":0}] -> quartz_ore
NETHER_QUARTZ id=312 reachable from app break path: false
PROBE_DRIFT_DONE
```

14 of 18 v2 ids differ. Two of the differences are player-visible today, and both contradict a gameplay test that is currently green:

1. **The Nether portal is breakable in the shipped app and yields an item that does not exist.** `packages/gameplay/src/v2blocks/v2blocks.test.ts:128-129` asserts "Only the portal is indestructible" via `hardness < 0`, and the default registry agrees (`hardness=-1 itemId=0`). The app table says `hardness=0 itemId=65`, so `breakAt` passes its `definition.hardness < 0` guard and runs `addStack(player.inventory, makeStack(65, 1), V2_INVENTORY)`. Item 65 has no definition in the app registry either (`PORTAL app item form: null`), so a survival player who mines a portal destroys it and receives an unnamed stack that falls back to `Item 65` in `itemDisplayName`.
2. **Crops have an item form they must not have.** The contract and the default registry give the three crops `itemId=0` (no item); the app table gives them `itemId=72/73/74`. Breaking a crop therefore runs the harvest path (`progression.harvest`, which yields wheat/carrot/potato) *and* inserts a placeable crop block item, so a mature plant can be picked up and replanted as a finished crop.

The remaining twelve differences are latent rather than player-visible on this sha, and I checked each rather than assuming: `apps/game` never gates breaking by tool tier (`grep -rn 'minTier\|requiresTier' apps/game/src` returns only the three definition sites inside `registries.ts`, `APP_TIER_MATCHES=3`), and the only consumer of `blockDef.drops` is `packages/gameplay/src/enchanting/effects.ts:78` (`enchantedDrops`), which has no caller in `apps` (`progression.ts:234` iterates crop-harvest drops, not block drops). So the drop-table and tier drift, the enchanting-table light values, and the fence/wall `skyPassThrough` and `layer` drift are wrong data that nothing reads yet. They will become wrong behaviour the moment silk touch, fortune, tier gating, or registry-driven lighting is wired.

Why this is a blocker and not a major: the class of defect the last two rounds found was "the shipped path does not resolve the v2 contract". After fix-c, fix-d, wire-b and the L0 commit, the shipped path still does not resolve the *authoritative* v2 contract; it resolves a hand-maintained copy that disagrees with it on 14 of 18 ids, and section 8.2 shows no gate can detect corruption in that copy. Recommended fix: delete `BLOCKS_V2`/`ITEMS_V2` from `apps/game/src/registries.ts` and import `BLOCKS`/`ITEMS`/`RECIPES` from `@voxelcraft/gameplay`, keeping only the app-specific helpers (`V2_INVENTORY`, display names). If the duplicate must survive, add a test that asserts every field of every id 64..81 is identical in both tables.

## Majors

### M-01: breeding is still dead code in the app (earlier reachability major not closed)

The brief requires each Phase 8 system to have callers outside `packages/gameplay`. Breeding does not:

```
$ grep -rn 'breed' apps/game/src --include='*.ts'
(no matches)
$ grep -rn 'herd' apps packages --include='*.ts' | grep -v '\.test\.ts'
apps/game/src/ui-bridge.ts:145:	herd?: UiHerdInfo
apps/game/src/ui-bridge.ts:180:	herd: input.herd ?? BASE.herd
packages/client/src/ui/snapshot.ts:58:	herd: { animals: 0, babies: 0, inLove: 0 }
packages/client/src/ui/debug.ts:27,58,59
packages/client/src/ui/types.ts:130
```

`main.ts` never passes `herd`, so the HUD always renders the hardcoded zeros from `snapshot.ts:58`. The breeding module and its unit tests are real, but nothing a player does can reach them. `docs/orchestration/decisions.md` D-064 records this as deliberate ("breeding verified only at the gameplay API level; wiring deferred"), so this is an accepted gap rather than a surprise - but it is still an unreachable v2 system, and the review scope asks for it plainly: **of the five Phase 8 systems, four are player-triggerable and breeding is not.**

### M-02: no gate covers `apps/game/src/registries.ts`, the table the game actually uses

```
$ grep -rln 'BLOCKS_V2\|ITEMS_V2' $(find apps packages tests -name '*.test.ts') | wc -l
APP_V2_TEST_MATCHES=0
$ ls apps/game/src/**/*.test.ts
apps/game/src/world/store.test.ts
apps/game/src/world/chunkWorld.test.ts
```

Zero test files anywhere in the repo import the app registries. Section 8.2 turns this into a demonstrated blind spot: deleting farmland from `BLOCKS_V2` leaves `apps/game` tests, `packages/gameplay` tests, `packages/sim` tests and typecheck all green. The guard tests added in `6a9a5cf` protect `packages/gameplay` and `packages/sim` only.

### M-03: the Nether data-loss limitation is not documented in README.md

The limitation is real and is documented in decisions, but not where the brief requires it:

```
$ grep -c -i nether README.md
README_NETHER_COUNT=0
$ grep -n 'D-063' -A 3 docs/orchestration/decisions.md
D-063 Nether edits are not persisted in v1.2. SAVE_VERSION 1 has no per-dimension
      namespace, so only the Overworld is written.
```

A player who builds in the Nether loses that work silently on reload. One line in the README, next to the save documentation, closes this.

## Minors

- **m-01: the header comment of `apps/game/src/registries.ts` is now false.** It still says `BLOCKS.tryById(BLOCK_V2.FARMLAND)` is `undefined` and that both packages are frozen: "no registry entry describes them, so `BLOCKS.tryById(BLOCK_V2.FARMLAND)` is `undefined`: nothing could be named, placed or dropped. Both packages are frozen for this task." Since `d5450a1` the default registries do describe them (section 3), so the stated reason for the duplicate table no longer holds.
- **m-02: one guard test is tautological.** `packages/sim/src/shared/blockPropsV2.test.ts:91-96` is commented "covers every BLOCK_V2 id, so none falls back to air", but it only asserts that each id appears in one of the test file's own `OPAQUE_V2`/`PARTIAL_V2`/`NON_SOLID_V2` arrays. It tests the fixture, not the table: deleting a row from the production table cannot fail it. The real coverage comes from `v2blocks.test.ts:149-176`, which mirrors the definitions into `blockPropsOf`. Similarly `v2blocks.test.ts:139-146` (`expect(RECIPES.count()).toBe(v2.count())`) compares two registries built from the same def arrays and would pass if both lost the same recipe; it is saved by the neighbouring `toBe(ALL_RECIPE_DEF_COUNT)` and per-id assertions.
- **m-03: `pnpm bench` dirties a tracked file.** After gate 8: `git status --porcelain` printed ` M tests/bench/results/bench.json`. Anyone running the gate set before committing will sweep a machine-dependent benchmark file into their commit (I restored it with `git checkout -- tests/bench/results/bench.json`). Either gitignore the results file or make the bench write only under `artifacts/`.
- **m-04: typecheck depends on a fresh install in a provisioned worktree.** Before gate 1, `pnpm --filter @voxelcraft/game run typecheck` failed on this sha: `src/game/multiplayer.ts(121,20): error TS7006: Parameter 'state' implicitly has an 'any' type.`, `src/game/multiplayer.ts(128,14): error TS7006: Parameter 'error' implicitly has an 'any' type.`, `Exit status 2`. The worktree had been provisioned before `c6d3ce9` added the `@voxelcraft/net` workspace dependency, so `apps/game/node_modules/@voxelcraft/net` was missing and the imported types degraded to `any`. After `pnpm install --no-frozen-lockfile`, `pnpm -r exec tsc --noEmit` exits 0. Not a defect in the branch, but worth knowing that a stale `node_modules` turns a missing workspace link into implicit-any errors rather than a module-not-found error.
- **m-05: the brief's property names do not exist.** `grep -rn 'simSolid\|simReplaceable' packages apps tests` returns nothing. The real API is `isSolidBlock` / `isReplaceableBlock` over `SimBlockProps.solid` / `.replaceable`; I reviewed those (section 4).
- **m-06: nothing tests the documented Nether limitation.** `grep -rn -i nether tests/e2e/specs packages/gameplay/src/persistence apps/game/src/world` returns four matches, all in `nether.spec.ts` and all about portal travel (`expect(arrived.id, 'the portal must carry the player to the Nether').toBe(DIMENSION.Nether)`). The "Nether edits are not persisted" behaviour is documented in D-063 and enforced only by a comment in `saveWorld`. A three-line test (edit in the Nether, save, reload, assert the edit is gone) would pin it.

## 3. Block, item and recipe registries: B-01 is closed

I wrote a probe that imports the same entry points `apps/game` uses (`@voxelcraft/gameplay` for the defaults, `apps/game/src/registries` for the app tables), ran it with `pnpm exec tsx`, and deleted it afterwards. Verbatim output, trimmed to the assertions:

```
REGISTRY_PROBE_EXIT=0
CONTRACT BLOCK_V2 ids: [64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81]
CONTRACT ITEM_V2 ids: [305,...,322]
block 64 default=netherrack appRegistry=netherrack
...
block 70 default=farmland appRegistry=farmland
...
block 81 default=fence_gate appRegistry=fence_gate
item 305 default=wheat_seeds ... item 322 default=leather_v2
BLOCK_DEF_COUNT(v1)=64 BLOCK_V2_DEFS=18 BLOCKS.count()=82
ITEM_DEF_COUNT(v1)=96 ITEM_V2_DEFS=18 ITEMS.count()=127 createV2ItemRegistry().count()=127
RECIPE_DEF_COUNT(v1)=53 RECIPE_V2_DEFS=5
RECIPES.count()=58 createV2RecipeRegistry().count()=58 EQUAL=true
all 58 recipe ids inDefaultRegistry=true
FAILS=[]
PROBE_REGISTRIES_OK
```

Every BLOCK_V2 id 64..81 and every ITEM_V2 id 305..322 resolves through the default `BLOCKS` and `ITEMS` used by the shipped `packages/gameplay` entry point, not only through the v2 factory, and the default recipe count equals the v2 recipe registry count (58 = 58) with every id present in the default registry. `BLOCKS = createDefaultBlockRegistry()` is `createBlockRegistry(ALL_BLOCK_DEFS)` at `packages/gameplay/src/blocks/registry.ts:133`, and `ALL_BLOCK_DEFS = [...BLOCK_DEFS, ...BLOCK_V2_DEFS]`, so the v2 defs are in the shipped path by construction. **B-01: closed.** What remains is B-02: the app does not use these registries.

## 4. `packages/sim` block properties for ids >= 64

Second probe, same method:

```
SIM_PROBE_EXIT=0
AIR(0) props = {"opacity":0,"emission":0,"skyPassThrough":true,"skyFilter":0,"solid":false,"fullCube":false,"fluid":0,"climbable":false,"replaceable":true}
MAX_LIGHT=15 PORTAL.lightLevel=11
id 64..81: each MATCHES gameplay def (opacity, emission, skyPassThrough, solid, fullCube, replaceable)
AIR_FALLBACK=true only for 72, 73, 74
ids 82, 99, 200, 255 remain air-like
```

Ids >= 64 return real values, not the air fallback: for example the enchanting table is opaque and solid, netherrack and nether bricks are full cubes, magma block emits light (`emissionOf(MAGMA_BLOCK) === 3`, asserted at `blockPropsV2.test.ts:85-89`), and the portal carries `PORTAL.lightLevel = 11`. The three crops measure air-like by design (non-solid, replaceable, transparent), which is why my probe's crude "is it identical to air" heuristic flagged `id 72/73/74 still measures exactly like air` - that is correct behaviour for a crop, not a fallback. Ids above the v2 band (82, 99, 200, 255) are still air-like, as they should be. The brief's `simSolid`/`simReplaceable` names do not exist (m-05); I checked `SimBlockProps.solid`/`.replaceable` through `isSolidBlock`/`isReplaceableBlock`.

## 5. Village structures are breakable and placeable

The generator writes v2 ids:

```
$ grep -n 'BLOCK_V2' packages/world/src/village/builder.ts
136:	COBBLESTONE_WALL
175:	FENCE_GATE
184:	HAY_BLOCK
274:	GRAVEL_PATH
```

All four ids (78, 81, 79, 77) resolve in the default registry and in the app table (section 3 probe), so `breakAt` and `placeAt` both pass their `tryById(...) === undefined` guards on village blocks. `v2blocks.test.ts:179-209` backs this with a real generation run: it generates a region around `firstVillage()` with `SEED = 1337` and asserts every emitted id resolves in `BLOCKS`. Note the two sides use different tables (B-02): the walls and gates a player breaks are resolved from the app table, where `cobblestone_wall` and `fence_gate` carry `skyPassThrough=true` and `layer=0` instead of the authoritative `false`/`1`.

## 6. Phase 8 systems: what a player can actually trigger

The only non-gameplay caller of the Phase 8 modules is `apps/game/src/game/progression.ts`, which `main.ts:395` instantiates with `createProgression(...)`. Tracing each system from an input event:

| system | player action | wiring | verdict |
| --- | --- | --- | --- |
| XP and orbs | break any ore, then walk over the orbs | `main.ts:993-999` mousedown -> `breakTargeted()` -> `breakAt` -> `progression.blockBroken` (`progression.ts:205-208` -> `dropBlockBreakXp` / `xpForBlockBreak`); pickup at `main.ts:1050` -> `progression.collectAt` (`progression.ts:209-215` -> `collectOrbs`) | **reachable** |
| enchanting | right-click an enchanting table, take an offer | `main.ts:657-678` `useTargeted()` -> `:664 openTable`, `:665 screen='enchanting'`, `:896 onTakeEnchantOffer`, sounds at `:552-554`; UI screen in `packages/client/src/ui/enchanting.ts` | **reachable** |
| farming and crops | right-click grass with a hoe, plant seeds, break the grown crop | `main.ts:670 progression.till`, `:678 progression.plant`, `:525 progression.harvest`, growth on the world tick via `progression.tick` (`progression.ts:216-222` -> `randomTickCrops`) | **reachable** |
| Nether and portals | build a frame, light it, walk in | `main.ts:384 createDimensions`, `:499-503 nearPortal`, `:585-602 portalCue`, `:608-633 dimensions.tick()` / `syncDimension()`; `game/dimensions.ts` does the linking and travel delay | **reachable** |
| breeding | none | no caller outside `packages/gameplay`; HUD herd counters are hardcoded zeros | **not reachable** (M-01) |

Four of the five are confirmed end to end by gates I ran, not just by grep: `specs/progression.spec.ts` ("breaking ore grants xp, spawns particles and updates the hud"), `specs/farming.spec.ts` ("a tilled plot grows a crop on the fixed schedule and yields a harvest") and `specs/nether.spec.ts` ("a portal carries the player to the nether and back", driving `__vc.buildPortal()` and asserting `arrived.id === DIMENSION.Nether` and the return trip) all passed in gate 7. Enchanting has no e2e spec; I verified it by reading the full call chain from mousedown to `onTakeEnchantOffer` and the client screen, so it is reachable by inspection rather than by execution.

## 7. Persistence

```
$ sed -n '1,6p' packages/core-types/src/persistence.ts
export const SAVE_VERSION = 1
$ grep -n 'savePayloads' -B 3 apps/game/src/main.ts
			// Only the Overworld is persisted, so a save while in the Nether must not
			// write its regenerated chunks over the saved ones.
			dimensions.worldOf(DIMENSION.Overworld).savePayloads()
```

- **Overworld round trip: verified by a gate.** `specs/persistence.spec.ts:26` ("break, place, save and reload restore the same world state") breaks a block, places a replacement, calls `vc.save()`, reloads the page and asserts `after.block === replacement`, `after.hash === saved.hash`, the same `worldId` and `seed === E2E_SEED`, with zero console errors. It passed in gate 7. `apps/game/src/world/store.test.ts` and the `packages/gameplay/src/persistence` suites passed in gate 4.
- **The documented Nether limitation is true.** `SAVE_VERSION = 1` has no per-dimension namespace, and the save path only ever serialises `DIMENSION.Overworld`, with the header of `game/dimensions.ts` stating "Only the Overworld is persisted. The Nether is a pure function of the seed". So Nether edits are discarded on reload, exactly as claimed.
- **Documentation: half present.** D-063 in `docs/orchestration/decisions.md` documents it; `README.md` does not mention the Nether at all (`README_NETHER_COUNT=0`). That is M-03. No test pins the behaviour (m-06).

## 8. Gate adequacy: can the gates see a regression?

### 8.1 Yes, for `packages/gameplay` (the experiment the brief asked for)

Break - drop block id 70 (farmland) from the default registry factory:

```
$ sed -i 's/createBlockRegistry(ALL_BLOCK_DEFS)/createBlockRegistry(ALL_BLOCK_DEFS.filter((def) => def.id !== 70))/' packages/gameplay/src/blocks/registry.ts
$ git diff --stat
 packages/gameplay/src/blocks/registry.ts | 2 +-
```

Smallest gate that should catch it, and it went red:

```
$ pnpm --filter @voxelcraft/gameplay test
GAMEPLAY_TEST_EXIT_BROKEN=1
FAIL  src/v2blocks/v2blocks.test.ts:96   AssertionError: expected 81 to be 82 // Object.is equality
FAIL  src/v2blocks/v2blocks.test.ts:193  AssertionError: overworld block id 70: expected undefined to be defined
FAIL  src/__tests__/v2Systems.integration.test.ts:82  AssertionError: 70: expected undefined to be defined
FAIL  src/blocks/blockDefs.test.ts:118   AssertionError: expected 81 to be 82
FAIL  src/blocks/blockDefs.test.ts:148   AssertionError: expected 81 to be 82
 Test Files  3 failed | 15 passed (18)
      Tests  5 failed | 215 passed (220)
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @voxelcraft/gameplay@0.1.0 test: `vitest run --passWithNoTests`
Exit status 1
```

Restore, and green again:

```
$ git checkout -- .
CHECKOUT_EXIT=0
$ git status --porcelain
(empty)
$ pnpm --filter @voxelcraft/gameplay test
GAMEPLAY_TEST_EXIT_RESTORED=0
 Test Files  18 passed (18)
      Tests  220 passed (220)
```

So the guard tests added in `6a9a5cf` are not tautological where `packages/gameplay` is concerned: they detect a single missing id, both by count and by id.

### 8.2 No, for the table the game actually uses

Same regression, applied to the app-local registry that `breakAt`/`placeAt` consult instead:

```
$ sed -i 's/^\t\.\.\.V2_BLOCK_DEFS,$/\t...V2_BLOCK_DEFS.filter((def) => def.id !== 70),/' apps/game/src/registries.ts
$ git diff apps/game/src/registries.ts
 export const BLOCKS_V2: GameplayBlockRegistry = createBlockRegistry([
 	...BLOCK_DEFS,
-	...V2_BLOCK_DEFS,
+	...V2_BLOCK_DEFS.filter((def) => def.id !== 70),
 ])
```

With farmland missing from the registry the running game uses for breaking, placing, naming and collision:

```
GAME_UNIT_TEST_EXIT=0    (apps/game: Test Files 2 passed (2), Tests 9 passed (9))
GAMEPLAY_TEST_EXIT=0
SIM_TEST_EXIT=0
GAME_TYPECHECK_EXIT=2    (only the pre-existing TS7006 errors of m-04, unrelated to the break)
RESTORE_EXIT=0           (git checkout -- ., git status --porcelain empty)
```

Nothing went red. Combined with `APP_V2_TEST_MATCHES=0` (M-02), the claimed protection for the shipped path is tautological: the tests guard a registry the app does not use, so a v2 id can be absent, misnamed or mis-specified in the app table and every gate stays green. That is the core of B-02.

## 9. Scope of this review

- Everything above was run by me on the reviewed sha in my own worktree. I never pushed to `main` or `integration/mc-20260916`, never used `git worktree`, and the only file I added is this one. Both experiments were reverted with `git checkout -- .` and verified clean, and the bench artifact was restored, so the tree was clean before committing this report.
- I did not spawn child sessions; the verification fit in one session.
- The gate set was run once. I did not assess flakiness, and I did not review `packages/net`, `apps/server` or the multiplayer panel beyond the fact that their suites pass in gate 4.
- Enchanting is the one Phase 8 system with no end-to-end proof; it is reachable by code reading only.

## What would flip this to approve

1. Make `apps/game` resolve blocks and items from `@voxelcraft/gameplay` (`BLOCKS`, `ITEMS`, `RECIPES`), or add a test that asserts field-for-field equality between the app table and the shipped defs for ids 64..81 and 305..322 (B-02).
2. Restore the portal contract in whatever table survives: `hardness = -1`, `itemId = 0`, and no item form for crops (B-02, points 1 and 2).
3. Give `apps/game/src/registries.ts` any test coverage at all, so an app-local registry regression cannot pass the gate set (M-02).
4. Document the Nether persistence limitation in `README.md` (M-03).
5. Either wire breeding to the app or state in the release notes that it ships disabled, so the v2 feature list does not claim it (M-01).
