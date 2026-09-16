# Review rev1 — core-types, world, sim (light/fluid), orchestration docs

**Verdict: request changes** — 1 blocker, 3 majors, 6 minors. All four gates are green, the frozen
contract values are honoured and core-types is untouched since the freeze; the blocker is that the
integration branch is missing the tip of `feat/mc-20260916/world-b`, which silently drops 427 lines
of noise contract-guard tests.

- Reviewed at integration sha `9c59c8ab15cc586f37412624ea1acc9f24dd2c24`, compared against contract
  sha `83c5553aacc1115c5c2e93a0622ceb685eb813ef`.
- Scope: `packages/core-types`, `packages/world`, `packages/sim` (light + fluid), `docs/orchestration`.
- Everything below was run on the gha mcp runner `linux-s4rptd3x` from `wt/rev1`. Job ids are quoted
  so each claim can be re-checked.
- I changed no source file. `pnpm bench` rewrote `tests/bench/results/bench.json`; I restored it with
  `git checkout --`, so this branch adds only this file.

## Findings

| id | severity | file:line | evidence (short) | suggested fix |
| --- | --- | --- | --- | --- |
| R-01 | blocker | `packages/world/src/__tests__/world-b.guards.test.ts` (absent at HEAD); deleted by `61d8159`, restored by `ecaf330` | `git cat-file -e HEAD:...world-b.guards.test.ts` → “does not exist in 'HEAD'”. `git merge-base --is-ancestor 61d8159 HEAD` = 0, `--is-ancestor ecaf330 HEAD` = 1; `ecaf330` lives only on `remotes/origin/feat/mc-20260916/world-b` | Cherry-pick `ecaf330` (or merge the world-b tip) into `integration/mc-20260916` and re-run `pnpm -r test`. If the file is genuinely out of scope for world-b, re-home it — do not drop it |
| R-02 | major | `packages/world/src/__tests__/golden.json` (all 5 entries); asserted at `world-a.terrain.test.ts:37-51`; cases at `packages/world/scripts/update-golden.ts:22-28` | Every golden `fluids` value is `1582341573`, which equals `hashBuffer(new Uint8Array(65536))`; all 5 golden chunks generate `nonZeroFluid=0`, `waterBlocks=0` | Add an ocean case (seed 1337 chunk (30,−48) or seed 20260916 (−39,−48)) to `CASES` and regenerate with `pnpm --filter @voxelcraft/world run golden:update` |
| R-03 | major | `packages/sim/src/fluid/fluidEngine.ts:116-152` (used at `:183`), `:200`, `:219-222`, `:302`, `:313` | Measured 0.057–0.067 ms per processed cell; worst tick 25.09 ms for 440 cells; a full `PERF.fluidCellsPerTick=4096` tick extrapolates to ≈121 ms vs the 50 ms `PERF.simTickMs`. `pnpm bench` never exercises fluids (`simTickAvgMs = 0.082 ms`) | Packed integer keys instead of `Set<string>`/template keys, cache downhill distance per plane+revision instead of 4 floods per neighbour per cell, and add a fluid-churn scenario with a budget check to `tests/bench` |
| R-04 | major | `packages/sim/src/fluid/fluidEngine.ts:271-275` (dead branch) and `:278-282` | Nothing in the repo ever writes `BLOCK.WATER_FLOWING`/`LAVA_FLOWING`; spreading fluid only sets the fluid byte. Light reads emission from block ids (`lightEngine.ts:170`, `:365`), so flowing lava is dark, and `client/src/mesher/appearance.ts:204,217` plus `apps/game/src/main.ts:105,106,114,377,639` are unreachable | Pick one source of truth: either write the `*_FLOWING` ids in `applyCell` and notify the light engine there, or delete the dead branch and make consumers read `fluidStateAt`. Cross-package → record the choice in `docs/orchestration/decisions.md` |
| R-05 | minor | `packages/world/src/__tests__/world-a.terrain.test.ts:200`, `world-c.features.test.ts:506-507` | Gate is `BENCH.chunkGenAvgMsMax * BENCH.failFactor` = 18 ms while the frozen budget is `PERF.chunkGenBudgetMs = 4`. Recorded 13.590 ms / 10.248 ms in vitest, but 2.67 → 2.28 ms in a plain tsx script and 0.321 ms in `pnpm bench` over 289 chunks | Make the vitest timing informational (console only) and let `tests/bench` own the budget gate, or assert against `BENCH.chunkGenAvgMsMax` with the bench harness’ warm-up |
| R-06 | minor | `packages/sim/src/light/lightEngine.ts:72-81`, `:212-213`, `:239-240`, `:288-289`, `:459-464` | `recycle` only truncates when the queue is fully drained, so a budget-limited `step` leaves every consumed record in `data`; `onBlockChanged` pushes 14 records per edit, including non-writable neighbours | Compact when `head` passes a threshold (`data.splice(0, head)`) or use a fixed-capacity ring buffer; add a test asserting `pending` stays bounded under sustained edits |
| R-07 | minor | `packages/core-types/src/rng.ts:111-121` | The high byte is mixed only when `data[i] > 0xff`, so the byte stream is variable length: `hashBuffer(new Uint16Array([258,1])) === hashBuffer(new Uint16Array([2,257])) === 2742805879`. Safe today (max id seen = 31, registry tops out at 63) | Always mix both bytes and regenerate every pinned fixture in the same commit. Contract change → L0 owns it |
| R-08 | minor | `docs/reports/` (no `sim-b.json`); `packages/sim/src/light/index.ts:1-3`, `packages/sim/src/fluid/index.ts:1-3` | Every other task has a report; light/fluid are marked “Started by the sim-b L2 session and completed by sim-a after that session died” and arrive via `d37070e`, `1610ef1`, `09bff01` | Have the merging owner write `docs/reports/sim-b.json` to the `plan.md` schema; R-03 and R-06 are exactly what that report should have covered |
| R-09 | minor | `packages/sim/src/fluid/fluidEngine.ts:339-352`; `packages/sim/src/fluid/fluid.test.ts:51-160` | `settle()` stops at `maxTicks` (default 4096) and returns only the tick count, with work still queued. My single-source drain scenario needed 391 ticks, so the default is not obviously generous, and the tests never check `pending` | Return the remaining `pending` (or throw) on budget exhaustion, and add `expect(engine.pending).toBe(0)` after each `settle()` |
| R-10 | minor | `packages/core-types/src/rng.ts:99-102`; relied on by `packages/world/src/features/ores.ts:10-15`, `:94` | `nextInt` is `nextU32() % maxExclusive` (modulo bias; negligible at the 5/6/16 bounds in use) and returns 0 **without consuming a draw** for `maxExclusive <= 0`, while ore vein pruning is only output-preserving because “nextInt takes one nextU32 per call” | Throw (or still consume a draw) for non-positive bounds, use rejection sampling, and pin “one draw per `nextInt` call” in `rng.test.ts` |

## Details on the blocker and the majors

### R-01 — integration lost 427 lines of noise contract guards

Jobs `9d7c4d1838ab43ee`, `d61a27fd90c8405a`, `16fb5921e4284f14` (all exit 0).

- `61d8159 world-b test(world-b): drop out-of-scope guards test added by another process` deletes
  `packages/world/src/__tests__/world-b.guards.test.ts` (427 deletions) and **is** an ancestor of HEAD.
- `ecaf330 test(world): make the seed-sensitivity bounds exact, restore the noise guards` re-adds the
  same 427 lines plus a 22-line tightening of `world-b.noise.test.ts`, and is **not** an ancestor of
  HEAD; it exists only on `remotes/origin/feat/mc-20260916/world-b`. `git diff --stat ecaf330 HEAD --
  packages/world/src/__tests__/world-b.noise.test.ts` still reports 6 insertions / 16 deletions, so the
  noise-test half of that commit is missing from integration too.
- Coverage that exists nowhere else at HEAD: the noise-layer banned-API scan (it also bans `Math.tan`
  and `new Date`, which the surviving scan at `world-a.terrain.test.ts:101` does not), the import
  allowlist, improved-Perlin “fixed gradient table + quintic fade, bit for bit” (with a cubic-fade
  counter-check), the fBm octave progression (`gain^o`, `lacunarity^o`, salt stride, per-octave
  rotation, amplitude normalisation), “shared scratch buffers never leak state between climate, warp
  and warp-stage calls”, and “same climate values sampled whole or in reversed tiles”.
- That scratch-buffer guard is not hypothetical: the module-level buffers it pins are still there
  (`packages/world/src/noise/climate.ts:23` `STAGES`, `packages/world/src/noise/fbm.ts:38`
  `WARP_SCRATCH`, read back at `:210-211`), introduced by the perf commits `4234e19` and `c6dc219`
  (“1.21x faster, bit-exact”). Those buffers are shared by every generator instance in a thread, and
  the reversed-tile test is what backed the “identical across worker and main thread paths” claim.

This is a mechanical fix with an already-authored patch, which is why I am blocking on it rather than
filing it as a follow-up.

### R-02 — the golden fixture cannot fail on fluids

Jobs `4eb67b4a3fd24ca4`, `8ff71c2f9d8a4890` (exit 0).

```
hashBuffer(all-zero Uint8Array[65536]) = 1582341573
golden fluids value in golden.json     = 1582341573   (all 5 entries)
seed=1337    cx=0   cz=0   fluidsHash=1582341573 nonZeroFluid=0 waterBlocks=0
seed=1337    cx=5   cz=-3  fluidsHash=1582341573 nonZeroFluid=0 waterBlocks=0
seed=1337    cx=-12 cz=7   fluidsHash=1582341573 nonZeroFluid=0 waterBlocks=0
seed=20260916 cx=0  cz=0   fluidsHash=1582341573 nonZeroFluid=0 waterBlocks=0
seed=20260916 cx=31 cz=29  fluidsHash=1582341573 nonZeroFluid=0 waterBlocks=0
```

So half of “reproduces the pinned fixture byte for byte” is a constant, and the `blocks` half never
covers a chunk that contains water, ice or a sea floor. Commit `2fdcf73` (“regenerate golden chunk
hashes after L2 noise and feature merges”) changed only the five `blocks` values, which is exactly
what this blind spot predicts. The regeneration path itself is clean: both golden commits are
world-a regenerations and `packages/world/scripts/update-golden.ts` + the `golden:update` script
exist, so nothing looks hand-edited.

The ocean invariants are *not* untested elsewhere — `world-a.terrain.test.ts:161-184` and
`world-c.features.test.ts:182-218` are real, non-vacuous assertions, and my probe confirms their
subject matter (2710 and 1641 water voxels in the two ocean chunks, fluid byte 16 = water/level 0,
no water directly above air, zero block/fluid mismatches). That is why this is major, not a blocker.

### R-03 — fluid tick cost vs `PERF.fluidCellsPerTick`

Job `20e25488e87e4902` (exit 0), `PERF.fluidCellsPerTick=4096`, `PERF.simTickMs=50`,
`FLUID_TICKS.downhillSearchRadius=4`:

```
A closed floor:    ticks=41  cells=568  wallMs=38.2  msPerCell=0.0673  maxLevel=7 maxManhattan=7
B floor with hole: ticks=391 cells=1457 wallMs=82.2  msPerCell=0.0564
C pool+drain:      40 ticks totalMs=128.8 cells=4346 avgMsPerTick=3.22 worstTickMs=25.09 (440 cells)
C extrapolated:    a full 4096-cell tick ≈ 121 ms vs the 50 ms tick budget
```

The hot path is `holeDistanceFrom` (`fluidEngine.ts:116-140`): a `Set<string>` plus template-literal
keys per visited column, run four times per cell by `flowFaces` (`:143-152`), and `flowFaces` is
itself called per fluid-bearing neighbour inside `computeFluidAt` (`:183`). `schedule` adds another
string key per voxel (`:200`, `:219-222`) and `tick` rebuilds the due list with `concat`/`slice`
(`:302`, `:313`).

Honest caveat: this is tsx on a shared 4-CPU runner, and my chunk-gen numbers show how much
warm-up/scale matters (2.67 ms in a small script vs 0.321 ms in the bench harness). Even a 10×
improvement, though, leaves a saturated fluid tick at roughly half the entire 50 ms budget, and
nothing currently measures it.

### R-04 — flowing fluid has no block-level representation

Job `1cfb9e026521474c` (exit 0). `applyCell` writes `packFluid(next)` only (`:278-282`), so a
spreading voxel keeps `BLOCK.AIR`. The cleanup branch at `:271-275` that clears `WATER_FLOWING` /
`LAVA_FLOWING` can therefore never fire — a grep across `packages`, `apps` and `tests` finds only the
id definitions (`core-types/src/blocks.ts:109-110`), block defs (`gameplay/src/blocks/blockDefs.ts:418-425`,
where `LAVA_FLOWING` carries `emission: 15`), the mesher appearance map, `apps/game` swim/underwater
checks and bench fixtures — no producer anywhere. Because the light engine derives emission from the
block id (`lightEngine.ts:170`, `:365`), flowing lava emits no light at all.

## Verified green

All four required gates, one job, `wt/rev1`, 77.5 s, job `09de889aff134ee4`, marker
`=== ALL STEPS DONE ===`:

| command | exit code |
| --- | --- |
| `pnpm -r exec tsc --noEmit` | 0 |
| `pnpm -r lint` | 0 (9 workspace projects) |
| `pnpm -r test` | 0 |
| `pnpm build` | 0 |
| `pnpm bench` (optional, job `6059ba2adad44376`) | 0 — chunkGenAvgMs 0.321, chunkMeshAvgMs 4.557, simTickAvgMs 0.082, sectionMeshAvgMs 0.911 |

Other checks that came back clean:

- **Contract freeze** (job `04ab8fefb84943f9`): chunk 16×16×256, volume 65536, section 16,
  `blockIndex = (y<<8)|(z<<4)|x` (`core-types/src/chunk.ts:16-18`), magic `56 58 43 01` + codec
  version 1 (`chunk.ts:83-84`), palette widths {0,1,2,4,8,16}, light `(sky<<4)|block` with
  `MAX_LIGHT=15`, `packFluid = ((kind&3)<<4)|(falling?8:0)|(level&7)` with `FLUID_MAX_LEVEL=7`,
  `SEA_LEVEL=62`, `BEDROCK_LAYERS=4`, `WORLD_GEN_VERSION=1`, 20 Hz / 50 ms tick,
  `chunkGenBudgetMs=4`, mob ids 0..7, `CONTRACT_VERSION='1.0.0'` — every Section 2 value matches.
- **core-types untouched after the freeze** (job `ad17743dda024349`):
  `git diff --stat 83c5553..HEAD -- packages/core-types` is empty.
- **Determinism** (job `4eb67b4a3fd24ca4`): repeat generation of the same chunk is identical;
  forward vs reverse generation order on a fresh generator is identical; the golden block hashes
  reproduce the fixture exactly.
- **No non-determinism sources** (job `33d89c3f027e43ba`): no `Math.random`, `Date.now` or
  `new Date` anywhere in the three packages; `performance.now()` only in perf tests and the
  `pathfind/astar.ts:32` injectable default clock; no `.skip/.only/.todo`, no `as any`, no
  `@ts-ignore/@ts-expect-error/@ts-nocheck`, no `eslint-disable`, no catch blocks. Only `tests/e2e`
  and `packages/client` have vitest configs (job `a3d2518f01a44ce7`), so nothing filters tests out of
  core-types, world or sim; every package test script is `vitest run --passWithNoTests`.
- **Terrain, caves, ores** (job `8ff71c2f9d8a4890`): across 25 chunks of seed 20260916, y=0 is
  BEDROCK in all 6400 columns and there are 0 AIR voxels at y=1..3; max block id 31. Ore writes are
  clamped to `[minY,maxY]`, skip the bedrock shell and only replace STONE (`ores.ts:51-58`); the
  carver keeps `surfaceMargin + 6` of crust under submerged columns, caps shoreline columns at
  `SEA_LEVEL-2` and never carves below `yFloor = max(BEDROCK_LAYERS, CAVES.minY+1)`
  (`caves.ts:82`, `:137-145`); the vein-pruning draw accounting is exactly output-preserving
  (4 draws + `veinSize` on both paths).
- **Fluids** (job `20e25488e87e4902`): levels run 0..7 and stop at Manhattan 7 from a source; a hole
  produces `{kind: water, falling: true, level: 0}`; lava + water yields OBSIDIAN (54) in both
  placement orders.
- **Light**: sky fill/shadowing, per-step falloff, corner propagation against an independent
  reference BFS, incremental-equals-full-recompute for both placement and removal, and cross-seam
  stitching are all real equality assertions (`light.test.ts:128-153`, `:170-195`, `:199-230`,
  `:287-298`); `stitchBoundaries` defaults to 2 passes as the contract requires
  (`lightEngine.ts:385`), and the idempotence of extra passes is asserted at `:273-285`.
- **Serialization** (rev2’s package, checked because it is my contract surface):
  `packages/gameplay/src/persistence/chunkCodec.test.ts` pins the magic + version bytes, all-air and
  multi-section round trips, `bitsForPaletteLength` at the 1/2/3/4/5/16/17/256/257/65536 boundaries
  with `toThrow(RangeError)` at 0, no entry straddling a 32-bit word, a water chunk through the fluid
  RLE, block entities in ascending index order, and `canDecodeChunk` rejecting short, foreign and
  future payloads — green inside `pnpm -r test`.
