# rev3 review — core-types (+ v2), net, apps/server, world, sim

Reviewer: rev3 (independent). Reviewed commit: `9573084` (`integration/mc-20260916` head at review time;
the launch sha `dae1617` was already stale — `9573084` is a merge of `1cf64b1` + `dae1617`).
All gates and probes below were run on the shared runner `linux-8jp3kpf1` from the `review/rev3` worktree.

## Verdict

**Request changes.**

Every gate is green and the contract work looks clean, but the authoritative server does not actually hold
two of the properties it claims. Both are reachable by any connected client, both are reproduced below with
exact commands and output:

1. the movement speed limit is enforced per *message*, not per *tick* (25x speed hack in one line of client code),
2. a client can force unbounded chunk generation and hold the memory forever (~195 KiB per message, no eviction, no kick).

Neither is a contract violation and neither needs a contract change; both are in `apps/server`. The rest of the
scope (frame/opcode codecs, ws transport, session registry, heartbeat, tick loop, v2 contract, nether/village/portal
world work, H-05 light seeding) held up under review.

## Blockers

### B-1 Movement clamping is per Input message, so the speed limit does not exist

`GameServer.onInput` (`apps/server/src/gameServer.ts:313-333`) applies every Input frame the moment it arrives.
The only ordering guard is `if (input.tick < player.lastTick) return` (line 317), so *equal* ticks are accepted
and there is no cap on how many Input messages one tick may carry. `clampMovement`
(`apps/server/src/world/validate.ts:83-107`) caps `maxSpeedBlocksPerTick` (1.5) per *call*, i.e. per message.

`NET.inputBufferTicks` (3) exists in the frozen contract for exactly this and is only ever read by
`validateBlockEdit` (`validate.ts:49`); nothing buffers or rate-limits input.

Measured: 200 Input frames all carrying `tick = 0` moved the player 43.17 blocks across 8 server ticks.
The intended walk budget is `4.317 / 20 = 0.21585` blocks/tick, i.e. ~1.7 blocks for that window — a 25x bypass,
and it scales linearly with packet rate up to 1.5 blocks per message.

Suggested fix: accept at most one Input per `(session, tick)`, reject `input.tick <= player.lastTick` (or clamp the
per-tick displacement budget rather than the per-apply one), and bound how far `input.tick` may run ahead of the
server tick. Applying queued input from `step()` instead of from the socket callback would fix B-1 and M-2 together.

### B-2 A client can force unbounded chunk generation and pin the memory

`validateBlockEdit` bounds `y` only (`validate.ts:50-52`); `x`/`z` are unbounded. On the *rejected* path
`GameServer.onBlockEdit` reads the authoritative block back to the client (`gameServer.ts:342-344`), and
`ServerWorld.block` generates the whole column on first touch and caches it forever —
`createServerWorld` keeps a plain `Map` with no eviction and no cap (`apps/server/src/world/worldStore.ts:34-46`).
A column is `Uint16Array(65536) + Uint8Array(65536)` ≈ 192 KiB.

Measured: 300 out-of-reach BlockEdit frames at `x = 100000 + 16*i, y = 64, z = 0` took `loadedChunks` from 3 to 303
and RSS from 93.6 MiB to 150.7 MiB (~195 KiB per message). The client was not kicked and no gate notices.
The same lever exists through movement (`recenter` -> `chunkDataFrame` -> `world.chunk`), just more slowly.

Suggested fix: check reach *before* touching the world (or answer the revert from already-resident columns only),
add a world border on `x`/`z`, and evict columns that are outside every tracked player's stream radius.

## Majors

### M-1 The frame header version byte is decoded and never validated; the guard for it is dead code

`decodeFrame`/`FrameSplitter.push` carry `version` into every `NetFrame` (`packages/net/src/frame.ts:46,92`), but
nothing reads it: the only non-source reference in the repo is `frame.test.ts:26`. `assertCompatibleProtocol`
(`packages/net/src/protocol.ts:66`) has no caller outside `protocol.test.ts`. Version compatibility is checked
exactly once, on the Hello *payload* (`gameServer.ts:271`), so after a valid handshake a peer may stamp any version
byte on every subsequent frame and the server will decode it as protocol 1. Either enforce the header version on
receive (server and `ClientConnection.route`) or drop the field from `NetFrame` — right now it is computed state
with a guard function that ships unused.

### M-2 No inbound rate limiting or per-tick work budget anywhere on the server

`receive` -> `handle` (`gameServer.ts:229-263`) runs all of the work for every frame synchronously in the socket
callback. There is no per-session message budget, so one client controls how much work the process does between
ticks: Input drives simulation (B-1), BlockEdit drives generation (B-2) and a broadcast per accepted edit, and Chat
is broadcast to every active session after only a 256-char trim (`gameServer.ts:353-363`) — 8x fan-out amplification
with no cooldown. `NET.maxMessageBytes` caps a single message but nothing caps the rate. This is the common root of
B-1/B-2 and should be fixed structurally, not per handler.

### M-3 `ChunkColumn.revision` is written, documented as load-bearing, and never read

`worldStore.ts:4` states "the streamer holds on to it and compares `revision` to notice that a payload it already
sent is stale", and `setBlock` bumps it (`worldStore.ts:66`). No such reader exists: outside `worldStore.test.ts`
and a fixture in `movement.test.ts`, nothing in `apps/server` or `packages/net` reads `revision`. The streamer only
remembers which keys it sent (`apps/server/src/stream/chunkStream.ts:39,151`). Edits happen to be covered by the
BlockChange broadcast, so this is not a live bug — but the documented mechanism does not exist, which is exactly the
kind of comment a later change will trust.

### M-4 Per-client `sent` set grows for the whole session, and a column that leaves the radius is never re-sent

`ClientQueue.sent` (`chunkStream.ts:39`) gains one key per shipped column (`:151`) and is never pruned, so a walking
player's bookkeeping grows with the explored area for the session lifetime. The second half matters more: `pending`
(`:90-98`) filters against `sent`, so a column that left the radius and came back is never re-queued. A client that
dropped it locally (or reconnected onto the same `playerId`) has no way to get it again — there is no
re-request opcode in the frozen protocol.

## Minors

- **m-1** `validateBlockEdit` ignores its `world` argument (`void world`, `validate.ts:48`), so there are no
  occupancy, face or support rules: a client may place a block inside water or another solid, or replace `y = 0`
  bedrock. Deliberate per the comment, but it is a live authority gap, not just a stub.
- **m-2** `out_of_world` is y-only; there is no world border. This is what makes B-2 cheap.
- **m-3** `packages/net/src/codec/chunkPayload.ts` re-implements the frozen save codec
  (`bitsForPaletteLength`, `entriesPerWord`, `sectionMaskOf`, header = 12 bytes) that already exists in
  `packages/gameplay/src/persistence/chunkCodec.ts:40,41,48,62,71,204`. The header comment claims it is
  "byte-for-byte the frozen save codec", but no test compares the two encoders' bytes across packages, and the net
  encoder always writes a block-entity count of 0 (`chunkPayload.ts:194`), so chunks with block entities already do
  not round-trip through the net path. Add a cross-package byte-equality test or have one package own the codec.
- **m-4** `FrameSplitter.push` assigns `this.pending` and then checks the overflow guard
  (`frame.ts:98-101`), after `concat` has already copied the merged buffer, so a peer can make the server allocate
  ~2x `maxMessageBytes` transiently per socket before the throw. Bounded, but the guard reads as if it prevents the
  allocation.
- **m-5** `drop()` closes a peer-initiated disconnect with `NET_KICK_REASON.Shutdown` (`gameServer.ts:478-482`).
  The frozen reason set has no "client left", so ordinary hangups are indistinguishable from a server shutdown in
  logs and in `EntityRemove` bookkeeping.
- **m-6** Angle normalisation is duplicated with different implementations: `clampYawPitch`
  (`packages/net/src/codec/input.ts:43`) has no non-test caller, while `apps/server` re-implements `wrapYaw`/pitch
  clamping (`validate.ts:73-76,105`). Same for `setInput`, `inputBitsFrom`, `describeInput` (no non-test callers)
  and `Heartbeat.snapshot`/`msUntilTimeout`. The "client and server cannot drift about which bit means what"
  rationale is not yet realised — the server only uses `hasInput`.
- **m-7** The committed bench baseline is stale and light seeding is unguarded by the bench gate:
  `tests/bench/results/bench.json` still says `"task": "wire-a"` with `meta.totals.lightSeedAndStitchMs = 8169.878`,
  while a fresh `pnpm bench` at this head reports `light seed+stitch 1015.84 ms` (8.0x lower). That number lives in
  `meta.totals` with no `threshold`/`failThreshold`, so a light-seeding regression can never fail `pnpm bench`;
  the only guard is `packages/sim/src/light/lightSeedPerf.test.ts:178` (15 ms/chunk x `failFactor` 3). The
  `17.3x` A/B figure in `docs/reports/v1_1-sim.json` is only reproducible from that job's log, not from anything
  committed. Re-baseline `bench.json` at the integration head, or drop the stale file.
- **m-8** Weak assertions: `expect(...).toBeDefined()` is the whole check at
  `packages/core-types/src/__tests__/contract-v2.test.ts:95,154,174` (dimension params, `ENCHANT_APPLIES_TO`, food
  table) — it only proves the key exists. No `.skip`/`.todo`/self-disabling tests exist anywhere in scope, and test
  volume is healthy (core-types 46 `it`, net 119, world 120, sim 148, server 79).
- **m-9** `TickLoop.advanceTo` hands the same `nowMs` to every catch-up tick (`apps/server/src/tick.ts:65-79`), so
  after a stall up to 5 ticks share a timestamp and `chunkStream.refill` returns early on `elapsedMs <= 0`
  (`chunkStream.ts:106-108`): catch-up ticks stream nothing and ping nothing. Harmless today, surprising later.
- **m-10** Snapshots are broadcast unfiltered — every player's record to every client (`gameServer.ts:417-443`) —
  while chunks are radius-filtered. Fine at `maxPlayers` 8 / 10 Hz, noted only because the two paths disagree.

## What held up

- v2 contract (`packages/core-types/src/v2/*`) is additive and internally consistent: block ids 64..81 inside
  `BLOCK_V2_BASE..MAX`, items 305..322, `NET_OPCODE` client 1..5 / server 64..72, `NET_MAGIC 0x5643`,
  `NET_HEADER_BYTES 8`. `INPUT_BIT.Attack = 1 << 8` needs 9 bits and the Input codec writes `u16` — correct.
- Every opcode codec encodes and decodes in the same field order, and each fixed-size message's capacity matches its
  writes (Welcome 26 B, entity record 28 B, Snapshot header 11 B, BlockEdit 18 B).
- The hand-rolled RFC 6455 layer is right where it is easy to be wrong: big-endian 16/64-bit lengths, masked
  client->server frames, fragment accumulation capped by `maxMessageBytes`, control frames allowed mid-fragmentation,
  unmasking done on a copy. The upgrade check validates method, path, `Upgrade`, `Connection`, version 13 and a
  16-byte key.
- `SessionRegistry` keeps handshaking and active stages apart, so half-open sockets cannot consume player slots, and
  `close` is idempotent.
- `PORTAL.*` and `DIMENSION_PARAMS.*` are genuinely consumed (`portalTravel.ts:315,368`, `dimensionState.ts:64`,
  `world/src/portal/link.ts:104,180-184`) — contrary to the `v2-world` report note, `lightLevel`,
  `travelDelayTicks` and `cooldownTicks` all have real readers in sim now.
- H-05 is genuinely fixed, not renamed: `lightSeedChunkLocal` replaces the per-voxel object allocation with a typed
  optics table, a y-major top-down top scan, one `fill` for the band above the highest top, and a frontier rule that
  only queues voxels that can spread. The perf test asserts correctness invariants first and uses wall clock only as
  a guard.

## Gate table

All from the `review/rev3` worktree at `9573084`. Wrapper exit codes were ignored; each number below comes from the
`EXIT:`/`=== EXIT ... -> N ===` marker in the log.

| # | command | exit | evidence |
| - | ------- | ---- | -------- |
| 1 | `pnpm -r exec tsc --noEmit` | 0 | job `9e8a1f3b619d4134`, `/tmp/rev3/tsc.log` ends `EXIT:0` |
| 2 | `pnpm -r lint` | 0 | job `1fcc9ce292264876`, `/tmp/rev3/lint.log` ends `EXIT:0`, every project `Done` |
| 3 | `pnpm -r test` | 0 | job `769dfe3c850a4815`, `/tmp/rev3/gates.log:320` |
| 4 | `pnpm build` | 0 | `gates.log:350` |
| 5 | `pnpm size` | 0 | `gates.log:388` |
| 6 | `pnpm test:e2e` | 0 | `gates.log:447`, 10 Playwright specs passed in 17.4 s |
| 7 | `pnpm bench` | 0 | `gates.log:466`; `chunkGenAvgMs 2.09/6`, `chunkMeshAvgMs 3.568/12`, `simTickAvgMs 1.15/8`, `light seed+stitch 1015.84 ms` |

`pnpm bench` rewrites `tests/bench/results/bench.json`; it was restored with `git checkout --` so this branch carries
only this review file.

## Evidence

### B-1 and B-2 probe

One throwaway script (not committed) run with `pnpm exec tsx` from `apps/server`: it boots the real server through
`startGameServer({ port: 0, seed: 4242 })` with a no-op streamer, connects one real `WebSocket` client, completes
Hello/Welcome, answers Pings, then

1. sends 200 `NET_OPCODE.Input` frames that all carry `tick = welcome.tick`, `bits = INPUT_BIT.Forward`, and reads
   the authoritative position back from `server.players()[0]`,
2. sends 300 `NET_OPCODE.BlockEdit` frames at `x = 100000 + i * 16, y = 64, z = 0` (all out of reach, all rejected)
   and reads `server.world.loadedChunks` plus `process.memoryUsage().rss`.

```
PROBE-1 input-spam {"inputsSentWithIdenticalTick":200,"clientTick":0,"serverTicksElapsed":8,
  "before":{"x":0.5,"z":0.5},"after":{"x":0.5,"z":43.67000000000013},
  "blocksTravelled":43.17000000000013,"walkBudgetPerTick":0.21585000000000001,"clampCapPerApply":1.5}
PROBE-2 chunk-flood {"rejectedEditsSent":300,"loadedChunksBefore":3,"loadedChunksAfter":303,
  "rssBeforeMiB":93.6,"rssAfterMiB":150.7,"playerStillConnected":1}
PROBE_EXIT:0
```

43.17 blocks in 8 ticks against a 0.21585 blocks/tick budget is B-1. 300 rejected messages turning into 300 resident
columns (+57 MiB RSS) with the client still connected is B-2.

### M-1 dead version guard

```
$ grep -rn --include='*.ts' '\\.version' packages/net/src apps/server/src
packages/net/src/frame.test.ts:26:   expect(frame.version).toBe(NET.protocolVersion)
packages/net/src/frame.ts:46:        version: header.version,
packages/net/src/frame.ts:92:        version: header.version,
$ grep -rn --include='*.ts' 'assertCompatibleProtocol' packages apps
packages/net/src/protocol.ts:66:export function assertCompatibleProtocol(version: number): void {
packages/net/src/protocol.test.ts:9,59,66
```

### M-3 unread revision

```
$ grep -rn --include='*.ts' 'revision' apps/server packages/net
apps/server/src/world/worldStore.ts:4   (comment claiming the streamer compares it)
apps/server/src/world/worldStore.ts:43,66  (written)
apps/server/src/world/worldStore.test.ts:144-153, src/movement.test.ts:32, src/types.ts:20
```

No production reader.

### m-7 stale bench baseline

```
$ grep -n 'task\\|lightSeedAndStitchMs' tests/bench/results/bench.json
  "task": "wire-a",
  "lightSeedAndStitchMs": 8169.878,
$ grep 'light seed' /tmp/rev3/gates.log
[bench] terrain 559.185 ms, decorate 44.891 ms, light seed+stitch 1015.84 ms
```

## Notes for the integrator

- B-1 and B-2 are both fixable inside `apps/server` with no contract change; a single "apply client input from the
  tick, with a per-session message budget" change addresses B-1, M-2 and most of B-2's rate.
- M-3 and M-4 are cheap to close and both touch `chunkStream`, so they are worth doing together.
- Nothing in this review asks for a change to `packages/core-types/src` or `src/v2`.
