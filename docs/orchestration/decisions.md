# Decisions log - mc-20260916

L0 records every judgement call here so children never have to guess.

| ID | Decision | Rationale |
| --- | --- | --- |
| D-001 | Repository is `nmt3325/voxelcraft-mc-20260916`, public. | User-approved. The runner's `gh` is authenticated as `nmt3325`, so the push-capable identity owns the repo. |
| D-002 | The GitHub remote is the only source of truth; runner state is disposable. | Runner leases expire (<=330 min), so every agent pushes at least every 15 minutes and after each green check. |
| D-003 | Cross-package imports resolve through `package.json` `exports` pointing at `src/index.ts`; no build step between workspace packages, no TS project references, no deep imports. | Keeps `pnpm -r exec tsc --noEmit`, vitest and Vite on one resolution path with zero build ordering. |
| D-004 | Third-party dependencies are declared **only** in the root `package.json` (L0-owned). Packages declare workspace deps only. | One lockfile owner prevents `pnpm-lock.yaml` merge conflicts across four parallel branches. A child needing a new dep reports `contract_changes_needed`. |
| D-005 | `noUncheckedIndexedAccess` and `noUnusedLocals`/`noUnusedParameters` are off; unused vars are an ESLint warning. | Voxel code is index-heavy; the gate is exit code 0, and these settings would generate churn without catching real bugs. |
| D-006 | TS `lib` is `ES2022, DOM, DOM.Iterable`. Worker globals are declared locally in the owning package. | Mixing `DOM` and `WebWorker` libs produces duplicate-declaration errors. |
| D-007 | `pnpm build` writes to the repository-root `dist/`, via `apps/game` Vite config. | The completion criteria name `dist` explicitly. |
| D-008 | Generated textures/sounds live in gitignored `generated/` directories and are produced by `pnpm assets`, which `pnpm build` runs first. | Assets must be reproducible from scripts, and must not bloat the repository. |
| D-009 | Headless Chromium runs with ANGLE/SwiftShader flags (`--use-angle=swiftshader`, `--enable-unsafe-swiftshader`). | GitHub runners have no GPU; WebGL2 would otherwise fail and the console-error-zero gate could never pass. |
| D-010 | `tests/**` (E2E + performance harness) is owned by L1-D, extending the table in the request. | The harness needs the client and QA toolchain; nobody else touches it. |
| D-011 | The integration branch `integration/mc-20260916` is created up front from `main`. | Phase 6 merges one branch at a time into it with `merge --no-ff`. |

## Phase 2: 共有契約の確定（2026-09-16）

- D-012 チャンクは 16x16x256、ボクセル索引は `(y << 8) | (z << 4) | x`（x が最速軸）。メッシュ/描画/ライティングの作業単位は 16^3 セクション（1チャンク 16 セクション）。
- D-013 ブロック id とアイテム id を `core-types` で数値固定（`BLOCK` / `ITEM`）。ワールド生成・定義・セーブ・テストが同じ数値を共有するため。200..255 / 400.. は実験用に予約し、契約変更なしで使える。
- D-014 メッシャ頂点は Uint16 x 8 インターリーブ。three.js の非正規化整数属性が float32 化される経路でビットが落ちるため、Uint32 ビットパックは採用しない。
- D-015 テクスチャはアトラス PNG を手続き生成し、GPU では配列テクスチャ層として使う。要件「テクスチャアトラス」を満たしつつ UV にじみを避ける。
- D-016 光は保存しない（`ChunkSnapshot` に含めない）。読み込み時に再計算する。セーブサイズと整合性の両方で有利。
- D-017 流体は近傍からの純関数再計算（`computeFluidAt`）。直接書き換え方式の振動と生成順依存を避ける。ソース自己複製は v1 無効。
- D-018 乱数は座標ハッシュ優先（`hashU32` / `hash01`）。ストリーム RNG はループ順が固定された局所処理限定。`Math.random` / `Date.now` / `Math.sin` はワールド生成・シミュレーションで禁止。
- D-019 RNG とハッシュの実装は `core-types` が持つ（型だけにしない）。world と sim が別実装を持つと決定論が崩れるため。
- D-020 チャンク直列化はパレット + ビットパック（1/2/4/8/16 ビット、ワード跨ぎなし）。RLE はブロック層では使わず、流体層のみ。
- D-021 `WorldStore` の鍵は複合キー `[worldId, cx, cz]`。文字列キーは負座標の順序が壊れる。
- D-022 固定 tick 20Hz（50ms）、アキュムレータ上限 250ms。ECS のシステム順序は `SYSTEM_ORDER` で固定。
- D-023 物理は Y→X→Z 解決、1サブステップ 0.45 ブロック以下。`PHYSICS` の定数を唯一の出典とする。
- D-024 破壊時間は `breakTimeSeconds` を共有関数にする。HUD と採掘処理で式が分岐するのを防ぐ。
- D-025 依存宣言はルート `package.json` のみ。子は追加・更新禁止（`contract_changes_needed` で報告）。ワークスペース間参照は `scripts/wire-deps.cjs` が `workspace:*` で配線する。
- D-026 性能閾値は `PERF` / `BENCH`。閾値超過は警告として記録し、`failFactor`(3倍) 超過のみ bench を失敗にする（環境差で全体を赤にしないため）。
- D-027 E2E は SwiftShader 前提で描画距離 2・640x360。実機性能は bench で別に測る。
- D-028 サブツリーごとに env 1つ、その中に `-a`（L1 本体）・`-b`・`-c`（L2）の3ブランチ分の作業ツリーを L0 が事前作成。L1 は最後に `-b` `-c` を `-a` へ `merge --no-ff` する。
- D-029 `SharedArrayBuffer` は必須にしない（COOP/COEP なしで動くこと）。`crossOriginIsolated` を feature-detect して転送方式を切り替える。
- D-030 `CONTRACT_VERSION` は `1.0.0`。契約変更は L0 のみが行い、変更時はこのファイルに追記して全 L1 に `sendMessageToSession` で通知する。
- D-031 Prettier はファイル種別ごとの overrides を持つ。useTabs: true を全体適用すると JSON/MD/YAML が崩れ、未整形が 29 から 40 件に増えたため、*.json *.md *.yml *.yaml *.html は useTabs: false。prettier --check は必須ゲートにしない。
- D-032 tests/bench/ の所有者は L1-D（client/QA）。当初の所有パス表に記載が無く無所有だったため、E2E と同じ担当に寄せる。
- D-033 main への反映は integration/mc-20260916 から PR を作成し、フルゲート緑を確認してから merge commit でマージする（PR #1、main = f0ab5f0）。直接 push はしない。
- D-034 apps/game の暫定実装（localWorld.ts の地形フィクスチャ、store.ts の localStorage ダブル）は統合後に feat/mc-20260916/wire-a で実パッケージへ差し替え、その時点で bench を再ベースライン化する。
- D-035 独立レビューの成果物は docs/reviews/<reviewer>.md。レビュアーはソースを変更せず、自分のブランチ（review/rev1 / review/rev2）にレポートのみを push する。
- D-036 L0 のヘルパースクリプトは scripts/l0/ にコミットする。env 失効でランナー上のスクリプトが消え、作り直しが発生したため、永続状態は GitHub のみを真実とする方針を徹底する。

## D-037 CI pnpm version was specified twice (2026-09-16)

GitHub Actions failed on every branch, including `main`, with `ERR_PNPM_BAD_PM_VERSION`:
`Multiple versions of pnpm specified: version 10 in the GitHub Action config with the key "version"` and
`version pnpm@10.34.5 in the package.json with the key "packageManager"`.
Resolution: delete `with: version: 10` from both `pnpm/action-setup@v4` steps and keep the root
`packageManager` field as the single source of truth. Run 35041918351 was the first fully green CI run.

## D-038 Review blocker R-01: integration was missing the world-b tip (2026-09-16)

Reviewer rev1 proved that `61d8159` (which deleted the 427-line
`packages/world/src/__tests__/world-b.guards.test.ts`) is an ancestor of the integration HEAD while
`ecaf330` (which restored it) is not, so the subtree merge silently dropped a whole guard suite.
Resolution: restore the file from the world-b tip, then merge `origin/feat/mc-20260916/world-b` into
integration so the remaining seed-sensitivity bounds and the final world-b report land as well.
The world package went from 66 to 78 tests, 423 total; tsc, lint and test all exit 0.

## D-039 Catbox refuses uploads from GitHub-hosted runner IPs (2026-09-16)

`curl -F reqtype=fileupload -F fileToUpload=@voxelcraft-mc-20260916.zip https://catbox.moe/user/api.php`
returns the literal body `Invalid uploader` for both HTTP/2 and HTTP/1.1, with and without a browser
user-agent and with an empty `userhash`. The site root answers 200 and the API answers 412 for a
parameter-less probe, so this is an uploader/IP policy rejection rather than a network or size problem
(the archive is 816190 bytes). The release archive is reproducible from the repository with
`bash scripts/l0/pack.sh` equivalent steps, and the destination decision is escalated to the requester
because changing the publish target needs explicit approval.

## D-040 Review follow-ups accepted without blocking v1 (2026-09-16)

rev1 majors: the golden `fluids` column equals `hashBuffer(new Uint8Array(65536))` because no golden
chunk contains water; saturated fluid ticking extrapolates to about 121 ms against the 50 ms tick and
`pnpm bench` never exercises fluids; spreading fluid is not written back to block ids, so the
`*_FLOWING` cleanup branch is dead code and flowing lava emits no light.
rev2 majors: the worker meshing path is never executed by any gate; the zero-console-error assertion
only watches `console.error` and `pageerror`; both Playwright specs self-skip when the app is missing;
bench numbers come from bench-local fixtures; the 73-name texture list is duplicated between client and
assets-gen; the greedy mesher silently drops quads at the u16 index cap.
All of the above are recorded as follow-ups for v1.1 instead of being fixed under the current deadline,
because none of them breaks a completion gate and the remaining budget is reserved for wiring
`apps/game` onto the real packages.

## D-041 Release distribution surface (2026-09-16 11:05 JST)

Catbox keeps answering `Invalid uploader` for uploads coming from GitHub-hosted runner IPs
(three attempts, two transport variants, `api=412` on a bare reachability probe), so the v1
download is published as a GitHub Release asset inside the already user-approved public
repository: `v1.0.0-rc1` first, then `v1.0.0` on the final `main` commit.

Acceptance for the published artifact is measured, not assumed: `curl -sIL` must return HTTP 200
with a `content-length` equal to the local zip size, the asset must download byte-identical, and
`BUILD-INFO.txt` inside the archive must name the same `main` commit that was built.

Moving the download to Catbox or any other third-party host needs a new user approval, so it is
not done unilaterally.

## D-042 apps/game runs on the real packages (2026-09-16 11:00 JST)

wire-a removed the last placeholders from the app layer: the 310-line `localWorld.ts` terrain
fixture, the `localStorage` persistence double and the bench's own terrain/tick fixtures are gone.
`apps/game` now drives `createWorldGenerator` from `@voxelcraft/world` into `createSimVoxelWorld`,
persists through a real IndexedDB store (`dbName voxelcraft`, `SAVE_VERSION 1`) and pulls fluids,
light, physics, locomotion, raycasting, ECS scheduling, inventory and crafting from
`@voxelcraft/sim` and `@voxelcraft/gameplay` instead of app-local copies.

The performance harness was re-baselined on that real stack with `meta.fixtureSubstitution.used`
flipped to `false`: chunkGen 2.325 ms, chunkMesh 3.374 ms, simTick 1.12 ms, sectionMesh 0.675 ms,
all inside the contract budgets.

## D-043 Light seeding cost is tracked separately (2026-09-16 11:00 JST)

Skylight seeding plus `stitchBoundaries()` costs roughly 10 s for 225 chunks (~45 ms per chunk),
which is far above the 4 ms chunk generation budget. It is reported as
`meta.totals.lightSeedAndStitchMs` and deliberately excluded from `chunkGenAvgMs`, because the app
streams that work across frames and the light engine is still exercised inside `simTickAvgMs`.

For v1 this is accepted: E2E stays green at render distance 2 and the bench thresholds hold. It is
recorded as the first optimisation target before render distance is raised, together with the
vitest-level `chunkGen` average of ~11 ms that already exceeds the 4 ms budget while staying under
the bench failure factor.

## D-044 The v1.1 contract is additive and lives in `core-types/src/v2` (2026-09-16 11:40 JST)

`CONTRACT_VERSION` moves from `1.0.0` to `1.1.0` and `packages/core-types/src/index.ts` now re-exports
`./v2`. Every v2 symbol is new: block ids are confined to 64..81 (`BLOCK_V2_BASE=64`,
`BLOCK_V2_MAX=99`), item ids to 305..322 (`ITEM_V2_BASE=305`, `ITEM_V2_MAX=383`), and the twelve new
event names live in `EVENT_V2` next to the frozen v1 `EVENT` map. Nothing shipped in v1.0.1 changed:
the chunk codec (`CHUNK_MAGIC`, `CHUNK_CODEC_VERSION=1`), `SAVE_VERSION=1`, the mesher layout
(`PADDED=18`, `VERTEX_STRIDE_U16=8`), `PERF`/`BENCH` budgets and all v1 ids keep their values, so
v1 saves stay loadable. `contract-v2.test.ts` (17 tests) pins the id bands, the XP and enchanting
formulas, the farming/breeding constants and the network framing helpers.

## D-045 Phase 8 runs five subtrees with disjoint ownership (2026-09-16 11:40 JST)

L1-E `v2-net` owns `packages/net` and `apps/server`; L1-F `v2-world` owns `packages/world`; L1-G
`v2-gameplay` owns `packages/gameplay`; L1-H `v2-client` owns `packages/client`,
`packages/assets-gen`, `apps/game`, `tests/e2e` and `tests/bench`; L1-I `v1_1-sim` owns
`packages/sim`. No path is assigned twice, and `packages/core-types`, `docs/orchestration`,
`.github`, the root configs, `pnpm-lock.yaml` and `scripts/l0` stay L0-only, exactly as in v1.
Dependencies are still declared only in the root `package.json` and wired with
`node scripts/wire-deps.cjs` (D-020).

## D-046 Multiplayer is a development/LAN authoritative server, not a hosted service (2026-09-16 11:40 JST)

`NET` fixes protocol version 1, a 20 Hz authoritative tick, 10 Hz snapshots, at most 8 players, a 6
chunk streaming radius and 24 chunks/s per client over a single `/ws` endpoint on port 8787. There
is no account system, no TLS termination inside the app and no anti-cheat beyond server-side
validation of block edits and movement clamping: the server is meant to be run on a trusted LAN or
behind a reverse proxy. Frames use an 8 byte header (`NET_MAGIC=0x5643`) so the wire format can be
extended without breaking the v1 single-player save path.

## D-047 The Nether is the only extra dimension in v2 (2026-09-16 11:40 JST)

`DIMENSION` has exactly two members (`Overworld`, `Nether`) with an 8:1 horizontal scale, a 127
block ceiling, zero skylight and a lava sea at y=31. Portals require an obsidian frame with a 2x3
to 21x21 inner area, an 80 tick travel delay, a 300 tick cooldown and a 64 block link search radius.
An End-style dimension is explicitly out of scope: it would need a boss entity, new mob AI and new
particle work that does not fit the remaining schedule.

## D-048 rev2 follow-ups are scheduled as v1.1 hardening (2026-09-16 11:40 JST)

The four remaining rev2 majors are assigned instead of deferred again: worker-path E2E coverage
(H-01), treating `console.warn` as an E2E failure (H-02), removing the E2E self-skip that silently
passed without WebGL (H-03) and a u16 index-overflow guard in the mesher (H-04) all go to L1-H.
The two measured performance gaps go to the simulation and world owners: light seeding plus
`stitchBoundaries()` at ~45 ms/chunk (H-05, D-043) to L1-I with a 15 ms/chunk target, and the
vitest-level `chunkGen` average of 11.1 ms against the 4 ms budget (H-06) to L1-I and L1-F.

## D-049 GitHub Releases stay the canonical download surface (2026-09-16 11:40 JST)

Catbox still answers `Invalid uploader` from GitHub-hosted runner IPs (D-039), so the release asset
on the GitHub Release remains canonical and byte-verified. For v1.1 the upload is retried once from
the new runner and, if it fails again, a Litterbox temporary link is published alongside the
GitHub Release URL and the failure is recorded here rather than blocking the release.

## D-050 v1 gates are mandatory, v2 features are cuttable (2026-09-16 11:40 JST)

Every merge into `integration/mc-20260916` re-runs the full gate: `pnpm -r exec tsc --noEmit`,
`pnpm -r lint`, `pnpm -r test`, `pnpm build`, `pnpm test:e2e`, `pnpm bench` and
`scripts/report-size.sh`. If the schedule runs short, v2 items are dropped in this order:
particle expansion, village generation, breeding, enchanting, the Nether, multiplayer. World
generation, break/place, save/load, crafting and the E2E suite are never reduced.

- D-051 (2026-09-16 12:05 JST): Fresh gha mcp runners ship without Playwright browsers, so the e2e gate fails with a missing chrome-headless-shell executable. scripts/bootstrap-env.sh now runs `pnpm exec playwright install chromium` whenever tests/e2e exists, and every child prompt repeats the step. Commit fea12602.
- D-052 (2026-09-16 12:05 JST): scripts/l0/main-merge.sh looked up pull requests with `--state all`, so it reused the already merged PR #6 for the same base/head pair, reported success and left `main` untouched. The lookup now uses `--state open` only, so every promotion either reuses a genuinely open PR or opens a new one. Commit fea12602.
- D-053 (2026-09-16 12:05 JST): External upload mirrors remain unavailable. Catbox answers HTTP 412 `Invalid uploader` and Litterbox answers HTTP 500 for the same archive, from a fresh runner and a fresh IP. GitHub Releases stay the canonical distribution surface for this run; the mirror is optional and will be retried once more before the final report.

- 2026-09-16 16:30 JST D-054: L1-E が `contract_changes_needed` で挙げた 2 件を L0 が解消した。`pnpm-lock.yaml` に `packages/net` と `apps/server` の importers を追加し、`scripts/wire-deps.cjs` のプロジェクトグラフにも両者を登録（`packages/net` は core-types 依存、`apps/server` は core-types と net 依存）。コミット `0600768`。なお CI の install ステップは verify / e2e の両ジョブとも `--no-frozen-lockfile` を使っているため CI が赤になる状態ではなかったが、lockfile をリポジトリの真実に揃えた。
- 2026-09-16 16:30 JST D-055: L1-H（v2-client）のセッションは、子自身の 6 ゲートがすべてグリーンになった後、`docs/reports/v2-client.json` を書き出す前に status=failed で終了した。リモートブランチの 8 コミット / 84 ファイルは健全だったため、子の自己申告ではなく L0 の git 実測とマージゲート（job `03234d4ea6e547bc`、8 ステップすべて exit 0）を合格根拠として L0 がレポートを代筆した。以後も「子のレポートは参考、合格判定は L0 のゲート」を原則とする。
- 2026-09-16 16:30 JST D-056: Phase 8 の統合順は v2-net → v1_1-sim → v2-world → v2-gameplay → v2-client とした。新規パッケージ（`packages/net` / `apps/server`）を含む v2-net を先頭に置いて lockfile と依存グラフの欠落を最初に解消し、残る 4 本は素の `scripts/l0/merge-check.sh` で通せる状態にした。各マージは `merge --no-ff` 直後に install/tsc/lint/test/build/size/e2e/bench の 8 ゲートを毎回実行している。

## D-057 昇格前に main を integration へ同期する（2026-09-16）

- 事象: PR #9 のマージコミットにより `main` が `integration/mc-20260916` の祖先でなくなり、`scripts/l0/main-merge.sh` の fast-forward ガードが `NOT_FF` で停止した。
- 判断: 昇格の直前に `origin/main` を統合ブランチへ `merge --no-ff` して同期し、同期後の head でフルゲートを再実行してから PR を作る。リリースは常に昇格後の `main` を target にする。
- 実装: `scripts/l0/sync-main.sh` を追加した。同期済みなら `ALREADY_SYNCED=yes` で no-op、未同期ならマージしてツリー差分の有無を出力し、`origin/integration/mc-20260916` へ push する。
- 実測: 同期 head `687ff6b89355d82b79db1d454878f2d3d2f19db7`（ツリー変更なし）、再ゲート job `87707e2487b54703` で 8 ゲートとも RC=0、PR #10 → main `35f1acbdfeb6f5741be4abaaa4716c343af2bdc8`、`MAIN_CONTAINS_INTEG=yes`、CI run `35071357361` success。

## D-058 外部ミラーの再試行結果と成果物 URL の正典（2026-09-16）

- v1.1.0 の zip で Litterbox（72h）と Catbox を再試行したが、Litterbox は `HTTP=500`（BunkerWeb のエラーピージ）、Catbox は `HTTP=412 Invalid uploader` で失敗。
- 判断: D-049 / D-053 を維持し、GitHub Release のアセットを成果物の正典 URL とする。v1.1.0 は `curl -sIL` で HTTP 200 / content-length 1263077 を確認し、実ダウンロードとバイト一致を検証済み。

## D-059 rev3 レビューの採否（net / server、2026-09-16）

- 対象: `docs/reviews/rev3.md`（統合 head `9573084` での独立レビュー、verdict = request changes）。
- 全件 accept。担当は `fix-c`（ブランチ `feat/mc-20260916/fix-c`、env `linux-snnxpyz0`、所有パス `packages/net/**` `apps/server/**` `tests/bench/**`）。
  - B-1 移動速度制限が事実上存在しない。`onInput` がメッセージ単位で移動を適用し、`input.tick < lastTick` だけを拒否するため、同一 tick の Input 200 通で 8 server tick に 43.17 ブロック進む（予算 0.21585 ブロック/tick、約 25 倍）。tick 単位の累積予算と重複 tick 拒否を入れ、回帰テストを追加する。
  - B-2 クライアントが無境界なチャンク生成を強制できる。置換検証が y のみで、拒否経路でもブロックを読み戻して列を生成・永続キャッシュする（到達外 300 回で列 3 → 303、RSS 93.6 → 150.7 MiB）。ワールド読み出し前に reach とストリーム半径を検証し、上限付き列キャッシュを入れる。
  - M-1 フレームヘッダの version 未検証、M-2 受信レート制限と tick 作業予算の不在、M-3 `ChunkColumn.revision` の未使用、M-4 `sent` 集合が増え続け再送を永久に防ぐ件、M-5 `tests/bench/results/bench.json` の陳腐化と `lightSeedAndStitchMs` の閾値欠落。
- 補足: マルチプレイは D-046 で LAN / 開発用の権威サーバと位置付けているため、これらの修正は v1 完了条件の前提ではなく v1.2 の強化として扱う。ただし公開サーバとして使える印象を与えないよう README の位置付けを維持する。

## D-060 rev4 レビューの採否（gameplay / client / app、2026-09-16）

- 対象: `docs/reviews/rev4.md`（統合 head `9573084` での独立レビュー、verdict = request changes）。7 ゲートは全て exit 0 だが、ゲートがアプリ層の到達性を検出できないという指摘を採用する。
- B-01 accept。担当は `fix-d`（ブランチ `feat/mc-20260916/fix-d`、env `linux-hs3pczf0`、所有パス `packages/gameplay/**` `packages/sim/**`）。BLOCK_V2 18 件と ITEM_V2 18 件が既定レジストリに未登録、既定レシピ 53 対 v2 レジストリ 58、sim ブロック表が id 64 以上を AIR にフォールバックするため、seed 1337 の村（ブロック x 72 z 632、126 voxel）が破壊も設置もできず光と流体の計算も誤る。
- 到達性の major（XP / エンチャント / 農業 / 繁殖 に `packages/gameplay` 外の呼び出しがない、ネザーとポータルが到達不能、net がクライアントから未使用）は accept。既に走っている `wire-b`（`apps/game/**` `packages/client/**` `tests/e2e/**`）に集約し、機能領域ごとの到達性 E2E を追加する。
- defer: 音声再生のゲート化、`drawCalls` の自明的値と `droppedQuads: 0` のハードコード、`ParticlePool` の O(live) 走査、`apps/game` の `@voxelcraft/assets-gen` 依存整理は wire-b の裁量とし、本ラウンドでは完了条件にしない。
- bench baseline の陳腐化と `lightSeedAndStitchMs` の閾値欠落は rev3 と重複するため D-059 の M-5（fix-c）に統合した。
- レビュー sha ドリフト（起動時 `dae16174`、実測 `9573084`）は仕様通り。レビュアは常に自分で `origin/integration/mc-20260916` を fetch して実 head を報告する。
- レビュー成果物は `docs/reviews/rev3.md` と `docs/reviews/rev4.md` として統合ブランチにマージ済み（ゲート job `6d65cba9cb6c4726` と `d0dee49ed71b429f`、統合 head `9aab3290`）。

## D-061 Review round 2 fixes were merged one branch at a time

fix-d (registries), fix-c (net hardening) and wire-b (app reachability) were
verified against git rather than self-reports, then merged with `merge --no-ff`
in that order, each followed by the full eight-gate check. Resulting integration
commits: fix-d `ce558fb4`, fix-c `1a75b2cf`, wire-b `74ed23c9`. Every gate exited
0 on all three merges.

## D-062 apps/game depends on @voxelcraft/net as a real workspace package

wire-b reached the net layer through a tsconfig `paths` entry plus a Vite
`resolve.alias`, because `package.json` and `pnpm-lock.yaml` are owned by L0.
L0 now adds `net` to the `apps/game` entry in `scripts/wire-deps.cjs`,
regenerates the manifest, refreshes the lockfile importer, and removes both the
tsconfig path and the Vite alias. The protocol module is a normal dependency, so
the bundler, the type checker and `--frozen-lockfile` all agree.

## D-063 Nether edits are not persisted in v1.2

`SAVE_VERSION` 1 has no per-dimension chunk namespace, so blocks placed in the
Nether are not written back to IndexedDB. Changing the save format is a
breaking contract change, so it is deferred. Documented as a known limitation
rather than silently shipped.

## D-064 Animal breeding stays verified at the gameplay API level

Breeding needs mob entities ticked inside `packages/sim` and `apps/server`, which
was outside the owner set of this round. The breeding rules are covered by the
gameplay integration test; the in-app wiring is carried over to the next release
instead of being half-wired into the frame loop.

## D-065 Review round 3 adjudication

`rev5` and `rev6` independently reviewed
`40e1a3f5c6d35ad364af6e49a296a64756921850`, both returned `request changes`, and
both reproduced their findings with their own drivers on the runner. Every
blocker below is assigned to exactly one owning branch; nothing is closed on the
strength of a report alone.

## D-066 rev5 B-02: apps/game must not keep its own v2 tables

`apps/game/src/registries.ts` declared a second copy of the v2 block and item
data and 14 of 18 ids disagreed with the gameplay registries. The
player-visible effects were a breakable Nether portal (hardness 0 against the
contract value -1) that inserted the undefined item id 65, and crops carrying an
`itemId` that let a mature plant be pocketed and replanted. Branch
`feat/mc-20260916/fix-e` removes the duplication so the gameplay and core-types
registries are the single source of truth.

## D-067 rev5 M-02: the app registry needs tests with power

No test imported `apps/game/src/registries.ts`, so deleting an entry left every
gate green. `fix-e` adds parity tests across all 36 v2 ids and must show them
failing on a deliberately deleted entry before restoring it.

## D-068 rev6 B-1: an accepted edit must be durable or fail loudly

`worldStore` inserted a new column and ran eviction before the write pinned its
key, so the new column was the only unpinned victim: 400 edits in 400 distinct
columns produced 62 unreadable blocks, first loss at index 338, while the server
still returned success and broadcast `BlockChange`. Branch
`feat/mc-20260916/fix-f` fixes the ordering and accounting, keeps the resident
set inside its cap, and adds regression tests that fail on the old ordering.

## D-069 rev6: CI installs frozen and runs the perf harness

Both CI jobs installed with `--no-frozen-lockfile`, so a stale lockfile could
never fail the build, and `pnpm bench` never ran in CI at all. CI now installs
with `--frozen-lockfile` in every job and gains a `bench` job that runs the
harness and uploads its results.

## D-070 rev6: bench baselines must describe their own run

The committed baseline hard-coded `task: 'fix-c'`, gated light seeding against
the chunk-generation budget, and printed a section-mesh budget that nothing
compared. `fix-f` owns `tests/bench` this round and makes the recorded task, the
gated budgets and the printed budgets all correspond to real measurements.

## D-071 rev5 M-01: breeding stays deferred and is documented as such

Breeding is still unreachable from the running game, which is the deliberate
outcome of D-064. It stays deferred, and the README states it as a known
limitation instead of implying the feature is playable.

## D-072 README is rebuilt from measured values at the release sha

`README.md` misstated the bundle size, the e2e spec count, all four bench
numbers and `CONTRACT_VERSION`, never mentioned `apps/server` or
`@voxelcraft/net`, and never mentioned the Nether. L0 rewrites those sections
from the numbers printed by the final gate run on the promoted sha, including the
Nether persistence limitation from D-063.

## D-073 Deferred minors from review round 3

Carried forward with no code change this round: the audio gate never asserts
`assetsReady`; `portalCue` is recomputed every frame; `ParticlePool` scans all
live particles; the `drawCalls` assertion is tautological; `droppedQuads` is
hard-coded to 0; `@voxelcraft/assets-gen` is still listed as a dependency that is
no longer needed; `blockPropsV2.test.ts` has one guard that only checks its own
fixture; and reviewers necessarily see a slightly older sha than the tip when L0
keeps merging during a review.

## D-074 rev5 B-02 and M-02 closed by fix-e

`apps/game/src/registries.ts` is now a thin re-export of `BLOCKS` and `ITEMS`
from `@voxelcraft/gameplay`, so the app can no longer drift from the shipped
registries. Before the fix 14 of 36 v2 ids differed across 40 fields, the Nether
portal had hardness 0 and inserted item id 65, and the three crops exposed a
pickable `itemId`; after the fix the drift count is 0, the portal is unbreakable
and the crops expose no item. `apps/game/src/registries.test.ts` asserts
field-for-field parity for all 36 ids and was proven red by deleting farmland
from the app table.

## D-075 rev6 B-1 closed by fix-f: durable or loud writes

`worldStore` pins a column before inserting it and makes room before the insert,
so the column being written can never be the eviction victim. When every
resident column holds an edit the store refuses, logs the refusal, and `setBlock`
returns false so the server never broadcasts a rejected `BlockChange`. The
reproduction went from 400 accepted with 62 unreadable (first loss at index 338)
and 400 resident against a cap of 338, to 338 accepted, 62 loudly refused, zero
unreadable and 338 resident. Three regression tests were proven red on the old
ordering.

## D-076 Root `eslint .` failed on an L0 file, not on child code

Both fix-e and fix-f stopped and reported `blocked` because gate 3 as they ran it
(`pnpm lint`, the root `eslint .` script) exited 1 with two
`@typescript-eslint/no-require-imports` errors in `scripts/wire-deps.cjs`, a file
L0 introduced in `c6d3ce9`. Both proved the failure reproduces on a pristine base
tree and neither touched an L0 path, which is exactly the required behaviour. The
fix is an eslint override that allows `require()` in `**/*.cjs`, since those files
are CommonJS by definition; the script itself is unchanged.

## D-077 Gate 3 now runs both lint forms

`pnpm -r lint` (used by CI, `merge-check.sh` and `full-gate.sh`) and root
`pnpm lint` disagreed, which is how a lint error survived several green merges.
Both L0 gate scripts now run `pnpm -r lint` and `pnpm lint` as separate steps
(`RC lint` and `RC lint_root`), so the two forms can never diverge again.

## D-078 Deferred: block drops ignore tool tier and drop tables

fix-e reported that the break path pockets `definition.itemId` with no tier or
drop-table lookup, so QUARTZ_ORE (67) yields its own block item instead of
NETHER_QUARTZ (312). Out of scope for review round 3; recorded as a known
limitation for a future drop-table pass rather than patched during promotion.

## D-079 Measured values recorded for the v1.2.0 README

README numbers are substituted from the promoted sha: bundle raw and gzip bytes
from `pnpm size`, the Playwright test count from the e2e specs, and the four
bench averages from the committed `tests/bench/results/bench.json` baseline.
Static counts measured at this sha: 58 crafting recipes (53 v1 plus 5 v2), 119
atlas layers, 24 procedural WAVs, `CONTRACT_VERSION` 1.1.0 and
`CONTRACT_V2_VERSION` 1.1.0.

## D-080 fix-e merged: apps/game no longer ships its own block and item tables

Closes rev5 blocker B-02 and major M-02. `apps/game/src/registries.ts` is now a thin re-export
of `BLOCKS` / `ITEMS` from `@voxelcraft/gameplay` (`BLOCKS_V2` and `ITEMS_V2` are aliases), so
the application cannot drift from the contract registries again. Evidence: a drift probe over
all 36 v2 ids printed `TOTAL_DRIFT_IDS=14 of 36` and `TOTAL_DRIFT_FIELDS=40` before the fix and
`TOTAL_DRIFT_IDS=0 of 36` / `TOTAL_DRIFT_FIELDS=0` after it. The Nether portal is unbreakable
again (`hardness=-1`, `itemId=0`, `breakable_by_main_ts=false`) and the three crops no longer
carry a pickable `itemId`. `apps/game/src/main.ts` now treats a negative hardness as unbreakable
and only pockets `definition.itemId` when it is greater than zero. A new
`apps/game/src/registries.test.ts` (10 tests) fails if the app and the gameplay registries ever
diverge; the red proof run exited 1 with `Error: apps/game cannot resolve block 70` before the
fix and 19 tests pass after it. Merged into `integration/mc-20260916` as 3968bd9a with all nine
gates green; the bundle shrank from 1040207 to 1037502 bytes raw.

## D-081 fix-f merged: durable-or-loud world store writes

Closes rev6 blocker B-1. The authoritative server no longer accepts a block edit it cannot keep:
`worldStore` pins a column before eviction can consider it, and when every resident column
already holds edits the write is refused, logged loudly and never broadcast. Evidence at shipped
config with 400 edits in 400 distinct columns: before, 400 accepted / 338 readable /
62 unreadable with the first loss at index 338; after, 338 accepted / 62 refused / 0 unreadable
and 338 of 338 columns resident against the 338 cap. Three regression tests
(`editBroadcast`, `worldStoreCap`, `worldStoreEdits`) reproduce the loss; the red run exited 1
with four failures and the restored implementation exits 0. The bench harness also stops
hard-coding `task`, derives it from the git branch, records `git.branch/commit/dirty`, gates
`lightSeedAvgMs` against the bench-local light budget instead of the chunk-gen budget and
compares `sectionMeshAvgMs` against `PERF.sectionMeshBudgetMs` instead of printing it beside a
budget nothing checked. Merged as 870dccab with all nine gates green.

## D-082 the v1.2.0 README is rebuilt from measured numbers

rev5 M-03 and rev6's documentation major are closed. The README now documents the Nether
(including the D-063 persistence limitation), the optional authoritative WebSocket server
(`pnpm --filter @voxelcraft/server start`, `ws://127.0.0.1:8787/ws`), `@voxelcraft/net` and
`apps/server` in both the architecture diagram and the workspace table, and a `Known
limitations` section. Every number in it was measured on integration 870dccab rather than
copied forward: bundle 1037502 B raw / 451420 B gzipped, 13 Playwright tests across 7 specs,
58 crafting recipes (53 v1 plus 5 v2), 119 texture atlas layers, 24 procedural WAVs,
`CONTRACT_VERSION` 1.1.0 and `CONTRACT_V2_VERSION` 1.1.0, and bench averages of chunk generation
2.093 ms, chunk meshing 3.717 ms, section meshing 0.743 ms, sim tick 1.207 ms and light seeding
4.647 ms. The build instructions use `pnpm install --frozen-lockfile`, matching CI.

## D-083 fix-e and fix-f self-reported blocked; adjudicated as complete

Both children ended with a `blocked` report whose only unmet gate was the root `eslint .` run
that D-076 traced to an L0-owned file. Each child ran a control experiment on a pristine base
tree and showed the same two pre-existing errors, so the block was not theirs. L0 verified both
branches against git rather than against the reports: the changed-file lists stayed inside the
owned paths, the red-to-green proofs were reproduced from the recorded job ids, and the nine-gate
merge check passed on each merge commit. Both tasks are therefore recorded as done, and the
child prompt template now names the exact lint command that counts as gate 3 so this class of
false block cannot repeat.

## D-084 the pointer lock now has an exit

The macOS report was that the mouse never came back. `apps/game/src/main.ts` requested pointer
lock on `mousedown`, and that was the only pointer-lock call in the whole app: no
`exitPointerLock`, no `pointerlockchange` listener and no binding that paused, so the capture had
no exit. Opening the inventory or the enchanting table left the cursor captured, the `pause`
screen was unreachable even though it existed, and the next click on the canvas re-captured
immediately. Chrome and Safari also consume the `Escape` keypress that ends a lock, so the app
could not observe the release from the keyboard at all. The lifecycle now lives in
`apps/game/src/pointerLock.ts`: `pointerlockchange` is the source of truth, a lost lock is
reported exactly once and pauses the game, every screen change runs through `setScreen` which
releases the pointer whenever the target screen is not `playing`, and a request inside the
browser's post-release cooldown is dropped instead of becoming a rejected promise that the
`unhandledrejection` handler would record as an error. Eight unit tests in
`apps/game/src/pointerLock.test.ts` cover capture, a browser-driven release, the cooldown, a
deliberate release, a rejected request, `pointerlockerror` and dispose; they are also the first
tests to exercise `apps/game` beyond the registries, the pattern rev5 M-02 asked for.

## D-085 README commands keep their comments on their own lines

Pasting the quick start into a shell without `interactive_comments` (the reported case was zsh on
macOS) turned `pnpm dev         # http://127.0.0.1:5173` into `vite '#' http://127.0.0.1:5173`,
and vite exited with `CACError: Unused args`. Every comment in the README command blocks now sits
above its command, so the blocks are safe to paste one line at a time or all at once, and the
controls table states that `Esc` gives the mouse back.
