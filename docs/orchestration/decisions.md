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
