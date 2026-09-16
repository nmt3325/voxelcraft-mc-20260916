# rev6 — independent review of `integration/mc-20260916`

- **Reviewed sha:** `40e1a3f5c6d35ad364af6e49a296a64756921850` (`Merge remote-tracking branch 'origin/l0-net' into l0-integ`, Wed Sep 16 10:10:19 2026 +0000)
- **Date:** 2026-09-16
- **Branch under review:** `integration/mc-20260916`, synced with `git fetch origin --prune` and `git reset --hard origin/integration/mc-20260916` after `git merge-base --is-ancestor c6d3ce96… origin/integration/mc-20260916` passed
- **Runner:** Linux x64, 4 CPUs, 15,989 MB RAM, Node v22.23.2, pnpm 10.34.5
- **Scope:** multiplayer server hardening, performance honesty, release hygiene

Every number below comes from a command I ran on this sha. The repository's own
tests were read, but they are not used as evidence anywhere in this report: all
abuse cases are driven by scripts I wrote (`adv1`–`adv5b`, listed under Method)
that import `apps/server` and `packages/net` directly.

## Verdict

**request changes**

One blocker, three majors, three minors.

Both server blockers from the previous round are genuinely closed; I re-measured
them adversarially and they hold. What stops the ship is a third fault in the
same subsystem: the authoritative world store silently discards accepted block
edits once the pinned set reaches its cache cap, and the server broadcasts a
`BlockChange` for edits that no longer exist.

## Gate commands

All eight gates were run in order in one session (runtime 108,675 ms, final line
`ALL_GATES_DONE`). Exit codes were captured per command:

| # | Command | Exit code |
| --- | --- | --- |
| 1 | `pnpm install --frozen-lockfile` | 0 |
| 2 | `pnpm -r exec tsc --noEmit` | 0 |
| 3 | `pnpm -r lint` | 0 |
| 4 | `pnpm -r test` | 0 |
| 5 | `pnpm build` | 0 |
| 6 | `pnpm size` | 0 |
| 7 | `pnpm test:e2e` | 0 |
| 8 | `pnpm bench` | 0 |

Verbatim summary file written by that run:

```
g1|pnpm install --frozen-lockfile|0
g2|pnpm -r exec tsc --noEmit|0
g3|pnpm -r lint|0
g4|pnpm -r test|0
g5|pnpm build|0
g6|pnpm size|0
g7|pnpm test:e2e|0
g8|pnpm bench|0
```

Notable output from those logs:

- g1: `Scope: all 12 workspace projects`, `Lockfile is up to date, resolution step is skipped`, `Done in 799ms using pnpm v10.34.5`
- g5: `dist/assets/index-DhfjUo7S.js   765.19 kB │ gzip: 213.37 kB`, atlas written as `atlas.png 34673 bytes, 27 files`
- g6: `TOTAL raw=1040207 gzip=452273`
- g7: `13 passed (22.1s)`
- g8: `chunkGenAvgMs` 2.077 ms, `chunkMeshAvgMs` 3.604 ms, `simTickAvgMs` 1.172 ms, `lightSeedAvgMs` 4.758 ms, `sectionMeshAvgMs` 0.721 ms; `warnings: []`, `failures: []`

The lockfile is healthy at this sha: gate 1 is the frozen install and it exits 0
with `Lockfile is up to date`, which is the specific risk the regenerated
lockfile introduced.

## The two earlier server blockers

### 1. Input flooding — **closed**

My own flood client (`adv1.ts`, six scenarios, driving a real `startGameServer`
over WebSocket) measured the following. The walk budget is 4.317 / 20 =
0.21585 blocks per tick; the sprint budget is 0.2806.

```
$ NODE_OPTIONS=--expose-gc pnpm exec tsx $OUT/adv1.ts
{"scenario":"A1-same-tick-200-default-limits","framesSent":200,"ticks":8,"displacement":0.21585,"blocksPerTick":0.02698125,"kicked":true,"kickReason":"bad_message","playersAfter":0,"socketClosed":true}
{"scenario":"A2-fresh-tick-200-default-limits","displacement":0.21585000099999996,"kicked":true,"kickReason":"bad_message"}
{"scenario":"A3-10x-rate-fresh-ticks-no-inbound-limit","framesSent":400,"ticks":40,"displacement":8.634000039999997,"blocksPerTick":0.2158500009999999,"kicked":false}
{"scenario":"A4-40x-rate-fresh-ticks-no-inbound-limit","framesSent":400,"ticks":10,"displacement":0.21585000099999996,"kicked":true,"kickReason":"bad_message"}
{"scenario":"A5-sprint-5x-rate-no-inbound-limit","framesSent":200,"ticks":40,"displacement":10.943400038999995,"blocksPerTick":0.2735850009749999,"kicked":false}
{"scenario":"A6-honest-1-per-tick","framesSent":40,"ticks":40,"displacement":8.633999999999993,"blocksPerTick":0.21584999999999982,"kicked":false}
```

**Measured:** 200 Input frames carrying the same tick moved the player
**0.21585 blocks in 8 server ticks** — exactly one tick of walk budget, against
the 43.17 blocks reported earlier — and the flooding client was kicked with
`bad_message`. Even with the inbound token bucket lifted so every frame reaches
the gate (A3), 400 frames over 40 ticks yield 0.21585 blocks per tick, i.e. the
budget and not a multiple of it. Sprinting is honoured but capped
(0.27359 ≤ 0.2806), and an honest 1-frame-per-tick client is not penalised.

### 2. Out-of-reach edit flooding — **closed**

```
$ NODE_OPTIONS=--expose-gc pnpm exec tsx $OUT/adv2.ts
{"scenario":"B1-300-out-of-reach-edits-shipped-defaults","editsSent":300,"loadedColumnsBefore":169,"loadedColumnsAfter":169,"rssBeforeMiB":228.6,"rssAfterMiB":228.8,"blockChangesReceived":0,"kicked":false,"kickReason":null,"playersAfter":1,"stillConnected":true,"worldCacheMaxColumns":338}
{"scenario":"B2-700-abusive-edits-validation-sees-all","editsSent":700,"loadedColumnsBefore":169,"loadedColumnsAfter":169,"rssBeforeMiB":231.1,"rssAfterMiB":231.2,"blockChangesReceived":72,"kicked":false,"kickReason":null,"playersAfter":1,"stillConnected":true}
```

**Measured:** 300 out-of-reach edits left loaded columns at **169 → 169** and RSS
at **228.6 → 228.8 MiB**, with **zero** `BlockChange` replies, against the
earlier 3 → 303 columns and 93.6 → 150.7 MiB. The client is not kicked, but it
also gains nothing: the rejection path only quotes a block back when
`world.hasColumn(...)` is already true, so a rejected edit can no longer
generate terrain. B2 repeats the abuse with the inbound bucket lifted and
`editsPerTick: 1_000_000` so validation sees all 700 frames; columns and RSS are
still flat and only the 72 edits that actually passed validation were broadcast.

Note that this fix is what makes the blocker below reachable in practice rather
than in theory: edits are now the only thing that pins a column.

## Blockers

### B-1 The world store silently discards accepted block edits, and the server broadcasts them anyway

`apps/server/src/world/worldStore.ts` pins every column an accepted edit touched
(`edited`, documented as "Pinned, never evicted") and caps residency at
`WORLD_CACHE.maxColumns = STREAM_WINDOW_COLUMNS * 2 = 338`. The pin is added
*after* the column is inserted and the cache is trimmed, so the trim can delete
the very column the edit is about to be written into.

`chunk()` inserts and trims:

```ts
columns.set(key, column)
evict()
```

`evict()` then looks for the oldest unpinned resident:

```ts
function evict(): void {
	if (columns.size <= maxColumns) return
	for (const key of columns.keys()) {
		if (columns.size <= maxColumns) return
		if (edited.has(key)) continue
		columns.delete(key)
	}
	// If every resident column is pinned the store stays above the cap on
	// purpose: player edits are not a cache the server may throw away.
}
```

and `setBlock()` writes first and pins afterwards, returning `true` either way.
Once 338 pinned columns are resident, the only unpinned entry at trim time is
the newcomer itself, so the store deletes it, `setBlock` writes into a detached
array, and the edit is gone on the next read or stream.

Measured with my own driver (`adv4.ts`; each position is a distinct column, and
the marker block is chosen per position from a pristine same-seed world so it
can never be confused with regenerated terrain):

```
$ NODE_OPTIONS=--expose-gc pnpm exec tsx $OUT/adv4.ts
{"scenario":"D1-control-100-edited-columns-under-cap","maxColumns":338,"editsAttempted":100,"setBlockReturnedTrue":100,"residentColumnsAfterEdits":100,"editsStillReadable":100,"editsSilentlyLost":0}
{"scenario":"D4-mechanism-with-maxColumns-4","maxColumns":4,"editsAttempted":6,"setBlockReturnedTrue":6,"residentColumnsAfterEdits":4,"editsStillReadable":4,"editsSilentlyLost":2,"lostIndexes":[4,5]}
{"scenario":"D5-accepted-edit-then-immediate-reread","maxColumns":2,"setBlockReturned":true,"pristineBlock":0,"markerWritten":1,"blockReadBack":0,"editSurvived":false,"residentColumns":3}
{"scenario":"D2-400-edited-columns-over-cap-shipped-config","maxColumns":338,"editsAttempted":400,"setBlockReturnedTrue":400,"residentColumnsAfterEdits":338,"editsStillReadable":338,"editsSilentlyLost":62,"firstLostIndexes":[338,339,340,341,342],"lastLostIndexes":[397,398,399]}
{"scenario":"D3-retouching-pinned-keys-exceeds-cap","maxColumns":338,"residentAfterRetouchingPinnedKeys":400,"rssDeltaMiB":0,"residentAfter600CleanColumnsOnTop":400}
```

What these say, in order of how damning they are:

- **D2, shipped configuration, no test-only options:** 400 edits in 400 distinct
  columns, `setBlock` returned `true` **400** times, and **62 edits were
  unreadable immediately afterwards** — every edit from the 339th distinct
  column onwards (`firstLostIndexes` starts at exactly 338, the cap).
- **D5:** the narrowest possible statement of the fault. `setBlock` returned
  `true`, the marker written was `1`, and the very next `block()` read returned
  `0`, the pristine generated value. Nothing failed, nothing logged.
- **D1:** the control. Under the cap, 100 of 100 edits survive, so the driver
  and the read-back method are sound.
- **D4:** the same mechanism with `maxColumns: 4`, where it takes six edits
  instead of 339 to reproduce.
- **D3:** the converse symptom of the same ordering bug. Re-touching the 400
  already-edited keys — which is exactly what streaming does when a player walks
  back over their own build — leaves **400 resident columns against a cap of
  338**, because a re-created key is already in `edited` and the victim search
  then finds nothing it may delete. Adding 600 clean columns on top does not
  bring it back down (still 400): the cap now only applies to unedited terrain.

Why this is a ship stopper rather than a major: the server tells every client the
edit succeeded. From `apps/server/src/gameServer.ts`:

```ts
if (!this.world.setBlock(edit.x, edit.y, edit.z, verdict.block)) return
// Including the editor: it must confirm against the server, not its guess.
this.sessions.broadcast(this.blockChangeFrame(edit.x, edit.y, edit.z, verdict.block))
```

So a build past the cap is broadcast as authoritative, is drawn by every client,
and then reverts the next time that column is streamed or read — silently, with
no kick, no log and no failed gate. 338 distinct edited columns is roughly 5.4 k
blocks of travel with one edit per column, well inside a single session, and the
pinned set only ever grows.

**Suggested direction (not verified by me):** pin the key before the insert that
may trim (`edited.add(key)` before `columnAt`/`chunk` runs, or an explicit
`chunk(cx, cz, { pinned: true })`), never let `evict()` choose the column just
inserted, and decide what should happen when pinned residency reaches the cap —
today both outcomes are wrong: dropped edits below, and an uncapped resident set
above. Whatever the policy, `setBlock` must not return `true` for a write that
was discarded.

## Majors

### M-1 CI does not run the gate set it is supposed to protect

`.github/workflows/ci.yml`, verbatim, lines 24 and 42:

```yaml
      - run: pnpm install --no-frozen-lockfile
```

Both the `verify` and the `e2e` job install with `--no-frozen-lockfile`, while
the local gate is `pnpm install --frozen-lockfile`. CI therefore repairs a drifted
lockfile instead of failing on it — the exact regression the freshly regenerated
lockfile (apps/game gaining a real `@voxelcraft/net` dependency) makes likely.
The full `verify` job is:

```yaml
      - run: pnpm install --no-frozen-lockfile
      - run: pnpm -r exec tsc --noEmit
      - run: pnpm -r lint
      - run: pnpm -r test
      - run: pnpm build
      - run: pnpm size
```

and `e2e` is `install --no-frozen-lockfile`, `playwright install --with-deps
chromium`, `pnpm test:e2e`. So `pnpm bench` — the entire performance gate, the
one that writes the committed baseline — **never runs in CI**. Seven of the eight
local gates are represented, one with the wrong flag, and the eighth is absent.

### M-2 The bench baseline is not honest about what it measures

`pnpm bench` exits 0 and the committed `tests/bench/results/bench.json` matches a
fresh run within noise (committed `chunkGenAvgMs` 2.109 vs fresh 2.077,
`chunkMeshAvgMs` 3.617 vs 3.604, `simTickAvgMs` 1.188 vs 1.172, `lightSeedAvgMs`
4.687 vs 4.758, `sectionMeshAvgMs` 0.723 vs 0.721; both `warnings: []` and
`failures: []`). The numbers are real. The framing is not:

1. **The task name is hard coded.** `tests/bench/src/bench.ts:362`:

   ```ts
   const report = {
       version: 1,
       task: 'fix-c',
   ```

   The committed baseline claims `"task": "fix-c"` at a sha that is a later
   integration merge, and it will keep claiming it forever. A baseline that
   cannot name the code it describes cannot be checked for staleness — the only
   honest field left is `generatedAt`, and the committed one
   (`2026-09-16T08:41:10.823Z`) predates the reviewed merge.

2. **Light seeding is gated against a borrowed budget.** `bench.ts:336`:

   ```ts
   makeMetric('lightSeedAvgMs', lightSeedAvgMs, BENCH.chunkGenAvgMsMax),
   ```

   `lightSeedAvgMs` (4.758 ms measured, threshold 6 ms, fail at 18 ms) is judged
   by the *chunk generation* budget. In the same run, light seed + stitch costs
   1,070.532 ms against terrain 554.958 ms and decorate 45.254 ms: the dominant
   cost in world generation is gated by a number chosen for something else, and
   the bench notes admit the contract "freezes no light budget of its own".
   Nothing here is a lie, but nothing here is a budget either.

3. **Section meshing is reported and never enforced.** `bench.ts:414-419` emits
   it under `informational` with a `budget: PERF.sectionMeshBudgetMs`, and the
   only other use is the log line at 453. The `budget` field is never compared
   to the value, so `sectionMeshAvgMs` cannot fail — a metric with a printed
   budget that no code checks reads as a gate and is not one.

4. **The gate only fires at 3×.** `failThreshold = threshold * BENCH.failFactor`
   with `failFactor: 3`, and only `failures` set a non-zero exit
   (`if (failures.length > 0) process.exitCode = 1`); a `warn` is silent to CI.
   Combined with M-1 (bench never runs in CI at all), the performance gate is
   currently advisory in every automated context.

### M-3 README misstates every published measurement and omits the multiplayer server

Measured on this sha versus what `README.md` claims:

| README claim | Line | Measured now |
| --- | --- | --- |
| `CONTRACT_VERSION` 1.0.0 | 82 | `1.1.0` (`packages/core-types/src/index.ts:5`, and `"contractVersion": "1.1.0"` in `bench.json`) |
| bundle 767,099 B raw / 305,763 B gzipped | 110 | `TOTAL raw=1040207 gzip=452273` |
| "Playwright reports 4 passed" | 110 | `13 passed (22.1s)`, across 7 spec files |
| chunk generation 0.303 ms | 112 | 2.077 ms |
| chunk meshing 4.157 ms | 112 | 3.604 ms |
| section meshing 0.831 ms | 112 | 0.721 ms |
| sim tick 0.083 ms | 112 | 1.172 ms |

The chunk-generation and sim-tick claims are off by 6.9× and 14×, and the bundle
is understated by 273 kB raw / 147 kB gzip. Every one of these is presented as
"Last measured on an Ubuntu runner with Node v22.23.2 and pnpm 10.34.5: every
command exits 0…", i.e. as a reproduced result.

Separately, the multiplayer server is undocumented. Searching the README for the
new subsystem returns nothing at all:

```
$ grep -n 'apps/server\|@voxelcraft/net\|multiplayer\|Multiplayer\|server' README.md | head -20
(no output)
```

The headings are `Requirements`, `Quick start`, `Controls`, `Architecture`,
`Verification commands`, `Reproducing the release checks`, `Workspace layout`,
`How this repository was built`, `License` — so the workspace-layout table and the
architecture walkthrough describe a client-only project, there is no run step for
`apps/server`, no port or URL, and no mention that `@voxelcraft/net` exists. The
controls section itself is accurate for the client.

## Minors

### m-1 Rate-limit and oversize-message disconnects are reported as the wrong thing

Both token buckets work, and both report `bad_message`:

```
$ pnpm exec tsx $OUT/adv5b.ts
{"scenario":"E2-frame-bucket-300-valid-frames-at-once","inbound":{"framesPerSecond":80,"frameBurst":40,"bytesPerSecond":1048576,"byteBurst":2097152},"framesSent":300,"kicked":true,"kickReason":"bad_message","kickAfterMs":18,"socketClosed":true,"playersAfter":0}
{"scenario":"E3-byte-bucket","maxMessageBytes":1048576,"byteBurst":2097152,"frameBurst":40,"biggestChatChars":65535,"frameBytes":65545,"framesNeededToExceedByteBurst":33,"byteBucketReachableBeforeFrameBucket":true,"framesSent":33,"bytesSent":2162985,"kicked":true,"kickReason":"bad_message","kickAfterMs":34,"socketClosed":false,"playersAfter":0}
```

300 individually legal Pong frames sent at once are cut off after 18 ms, and 33
maximal chat frames (2,162,985 B against a 2,097,152 B burst, deliberately kept
under the 40-frame burst so the byte bucket is what bites) after 34 ms. A client
that is merely too fast is told its messages were malformed. `NET_KICK_REASON`
has no rate-limit member, so this is a contract gap rather than a code slip, but
it makes a throttled client indistinguishable from a hostile one in logs. A
single 1.5 MiB WebSocket message is likewise disconnected with `shutdown`, which
reads as "the server is going away".

### m-2 Chat fan-out has no cadence of its own

```
{"scenario":"C1-chat-flood-inside-frame-bucket","chatsSent":160,"seconds":2.33,"broadcastsSeenByOtherClient":160,"bytesToOtherClient":217772,"senderKicked":false,"senderKickReason":null,"playersAfter":2}
```

160 chats of 300 characters each, paced to stay inside the 80 frames/s bucket,
are all broadcast: 217,772 bytes pushed at a bystander in 2.33 s from one
sender, with no kick. That is within the documented inbound budget and the text
is truncated to `MAX_CHAT_CHARS`, so nothing is violated — but chat is the one
opcode whose cost is multiplied by the room (×7 other clients at `maxPlayers` 8)
and it has no limit of its own beyond the generic frame bucket.

### m-3 A half-delivered frame holds a connection for the full heartbeat timeout

```
{"probe":"P8-header-only-declares-1MiB-then-idle","kicked":false,"kickReason":null,"socketClosed":false}
{"scenario":"E1-half-frame-declaring-1MiB-then-silent","timeoutMs":15000,"heartbeatMs":2000,"kicked":true,"kickReason":"timeout","kickAfterMs":15033,"socketClosed":true,"closedAfterMs":15033,"playersAfter":0}
```

A client that sends a header declaring 1 MiB and then nothing keeps its socket
and its partial reassembly buffer for 15,033 ms until the heartbeat closes it
with `timeout`. Buffered bytes are bounded by `maxMessageBytes`, the byte bucket
has already been charged for what arrived, and the player slot is released
correctly — so this is acceptable, and recorded here only because it is the one
path where an idle abuser is not rejected immediately.

## Verified sound

Each of these is something the scope asked about that I tried to break and could
not.

**Frame and opcode validation on every inbound frame** (`adv3.ts`, ten probes,
all against shipped defaults):

| Probe | Result |
| --- | --- |
| P1 server opcode (`Snapshot`) sent by a client | kicked `bad_message` |
| P2 unknown opcode 99 | kicked `bad_message` |
| P3 header protocol version + 1 | kicked `protocol_mismatch` |
| P4 bad magic | kicked `bad_message` |
| P5 `Input` before `Hello` | kicked `bad_message` |
| P6 `Hello` with `saveVersion` + 1 | kicked `protocol_mismatch` |
| P7 declared payload 2 MiB | kicked `bad_message` |
| P8 header only, declares 1 MiB, then idle | held to heartbeat timeout (m-3) |
| P9 single 1.5 MiB WebSocket message | disconnected, reason `shutdown` |
| P10 second `Hello` after `Welcome` | kicked `bad_message`, `playersAfter: 0` |

Protocol compatibility is enforced before any field is read
(`assertCompatibleProtocol(frame.version)` then `assertClientOpcode(frame.opcode)`
in `handle`), and bytes are charged before parsing in `receive`.

**Per-tick work budget** — a deliberately greedy streamer against the shipped
`WORK.chunkEncodesPerTick: 10`:

```
{"scenario":"W1-chunk-encode-budget-with-greedy-streamer","serverTicks":40,"chunkDataFrames":400,"perTick":10,"workBudget":{"chunkEncodesPerTick":10,"editsPerTick":4},"inboundBudget":{"framesPerSecond":80,"frameBurst":40,"bytesPerSecond":1048576,"byteBurst":2097152},"inputGate":{"perTick":1,"slack":3,"floodRejects":20,"epsilon":1e-9},"streamBudget":{"radius":6,"chunksPerSecond":24,"maxBurst":12}}
```

400 `ChunkData` frames over 40 ticks is exactly 10 per tick, not 11.

**Bounded per-client sent state** — 300 primed `next()` calls, then 20,000
alternating recenters, then a 200-step walk out and back:

```
{"scenario":"S1-streamer-sent-state","columnsEmitted":24418,"heapAfterWindowMiB":9.2,"heapAfter20kRecentersMiB":9.3,"heapAfterLongWalkMiB":9.3,"heapDeltaMiB":0.1,"batchWithLimit3":3,"streamWindowColumns":169}
```

24,418 columns emitted for 0.1 MiB of heap growth, and a `limit: 3` batch returns
exactly 3. `forgetOutOfRange` on recenter does what M-4 claimed.

**Player cap:** `{"scenario":"E4-player-cap","maxPlayers":8,"welcomed":8,"firstRejectedIndex":8,"rejectedKickReason":"server_full","playerCount":8}`.

**Lockfile and workspace wiring:** gate 1 (`--frozen-lockfile`) exits 0 with
`Lockfile is up to date`; `apps/game` depends on `"@voxelcraft/net":
"workspace:*"` as a normal workspace dependency, with no `paths` entry in any
tsconfig and no alias in the Vite config.

**Release hygiene:**

```
$ git ls-files | grep -Ei '[.](png|jpe?g|gif|webp|wav|mp3|ogg|flac|mp4|ttf|otf|woff2?|bin|ico|so|dll|exe|zip)$' || echo NO_TRACKED_BINARY_ASSETS
NO_TRACKED_BINARY_ASSETS
$ git check-ignore -v dist
.gitignore:2:dist/	dist
$ ls -l LICENSE; head -3 LICENSE
-rw-r--r-- 1 runner runner 1080 Sep 16 07:50 LICENSE
MIT License

Copyright (c) 2026 VoxelCraft contributors
```

No third-party binaries are committed; every tracked file under
`packages/assets-gen` is TypeScript or JSON, and `pnpm build` regenerates
`atlas.png` (34,673 B, 27 tiles) plus 22 `.wav` files into an ignored `dist/`.
The shipped tree is 27 files: two JS bundles
(`index-DhfjUo7S.js`, `mesher.worker-CaCQdkwD.js`), `index.html`, `atlas.png`,
`atlas.json`, `sounds.json` and the sound set; `TOTAL raw=1040207 gzip=452273`.
MIT `LICENSE` present.

## Method

- Synced to the reviewed sha only after `git merge-base --is-ancestor
  c6d3ce964e9d963b5e2ba930302d5b756f91587f origin/integration/mc-20260916`
  succeeded, then `git reset --hard origin/integration/mc-20260916`.
- No source, test or config file was modified. `tests/bench/results/bench.json`
  was restored with `git checkout --` after the bench comparison, and
  `git status --porcelain` was empty before this report was written. The only
  file this review adds is `docs/reviews/rev6.md`.
- Adversarial drivers live outside the worktree and import the repository by
  absolute path, so they cannot influence the build: `adv1.ts` (input flooding,
  6 scenarios), `adv2.ts` (edit flooding and store bounds, 3), `adv3.ts`
  (streamer state, 10 validation probes, work budget, chat flood), `adv4.ts`
  (store pinning, 5), `adv5b.ts` (token buckets, player cap, half frame, 4).
- Every pass/fail statement in this report corresponds to an exit code or a
  printed measurement I observed directly; nothing is inferred from the
  repository's own test suite.
