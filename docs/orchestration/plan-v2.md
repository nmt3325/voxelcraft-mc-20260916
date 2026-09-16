# VoxelCraft Phase 8 計画 (v1.1 hardening + v2 任意スコープ)

- RUN_LABEL: `mc-20260916`
- 契約: `CONTRACT_VERSION = '1.1.0'`（`packages/core-types/src/index.ts`）／`CONTRACT_V2_VERSION = '1.1.0'`（`packages/core-types/src/v2/index.ts`）
- 起点: `main` = `d063f915201df9d15732220aba0c1bce3dafcf65`（リリース `v1.0.1`）
- 統合ブランチ: `integration/mc-20260916`
- 期限: 2026-09-17 19:00 JST
- L0 のみが `packages/core-types/**`, `docs/orchestration/**`, `.github/**`, ルート設定, `pnpm-lock.yaml`, `README.md`, `LICENSE`, `scripts/l0/**`, `docs/reviews/**` を編集する。

## 0. 原則（v1 から継続）

1. コード生成・編集・ビルド・テスト・ネットワークは gha mcp のランナーのみ。
2. 永続状態は GitHub リモートのみが真実。ランナーは使い捨て。復旧は `scripts/bootstrap-env.sh <branch>`。
3. 契約は追加のみ（additive）。v1 の id・定数・イベント名・直列化フォーマットは変更しない。変更が必要な子は実装を止めて `status: blocked` + `contract_changes_needed` で報告する。
4. 自己申告を合格にしない。すべて exit code とログで裏取りする。
5. 15 分ごと＋グリーン時に push。env 消滅に備える。

## 1. スコープ

### v2 任意スコープ（元プロンプト §1 v2）

| # | 項目 | 担当 |
|---|---|---|
| 1 | マルチプレイ（WebSocket 権威サーバ＋チャンクストリーミング） | L1-E |
| 2 | 別次元（ネザー＋ポータル） | L1-F |
| 3 | 村生成 | L1-F |
| 4 | エンチャント（＋XP） | L1-G |
| 5 | 農業と繁殖 | L1-G |
| 6 | パーティクル拡充 | L1-H |
| 7 | モバイル操作 | L1-H |

### v1.1 hardening（rev2 レビュー指摘 + 既知の性能課題）

| id | 内容 | 担当 |
|---|---|---|
| H-01 | E2E がワーカー経路を踏んでいない（メイン経路のみ）→ ワーカー有効の E2E を追加 | L1-H |
| H-02 | `console.warn` が E2E のエラーゲートから漏れている → warn も失敗扱いに | L1-H |
| H-03 | E2E の自己 skip（WebGL 不在時に silently pass）を明示失敗に | L1-H |
| H-04 | メッシャの u16 インデックス上限チェック（頂点 65535 超で分割） | L1-H |
| H-05 | 光シード＋境界縫合が 225 チャンクで約 10 s（約 45 ms/chunk, D-043） | L1-I |
| H-06 | vitest の `chunkGen` 平均 11.1 ms（予算 4 ms, bench 上限 6 ms） | L1-I / L1-F |

## 2. サブツリーと所有パス（重複なし）

| 層 | taskid | ブランチ | 所有パス |
|---|---|---|---|
| L1-E | `v2-net` | `feat/mc-20260916/v2-net` | `packages/net/`, `apps/server/` |
| L1-F | `v2-world` | `feat/mc-20260916/v2-world` | `packages/world/` |
| L1-G | `v2-gameplay` | `feat/mc-20260916/v2-gameplay` | `packages/gameplay/` |
| L1-H | `v2-client` | `feat/mc-20260916/v2-client` | `packages/client/`, `packages/assets-gen/`, `apps/game/`, `tests/e2e/`, `tests/bench/` |
| L1-I | `v1_1-sim` | `feat/mc-20260916/v1_1-sim` | `packages/sim/` |

- 依存は root `package.json` にのみ宣言し、`node scripts/wire-deps.cjs` で `workspace:*` を配線する（D-020 継続）。
- 新規パッケージ `@voxelcraft/net`（ライブラリ）と `apps/server`（Node エントリ）の雛形は L1-E が作る。ルート `package.json` への依存追加が必要な場合は L0 に `contract_changes_needed` で要求する。
- 各 L1 は自分で最低 1 件のコア実装をコミットする（連絡役は不合格）。L2 を 2〜4 体、最大深さ L3。

## 3. 契約追加物（`packages/core-types/src/v2/`）

- `world2.ts`: `DIMENSION`, `DIMENSION_PARAMS`, `NETHER_GEN`, `PORTAL`, `BLOCK_V2`(64..81), `ITEM_V2`(305..322), `STRUCTURE`, `VILLAGE`, `StructurePiece`, `VillagePlan`, `CropDrop`
- `gameplay2.ts`: `XP`, `xpForLevel`, `levelFromXp`, `ENCHANTMENT`, `ENCHANT_MAX_LEVEL`, `ENCHANT_APPLIES_TO`, `ENCHANT_CONFLICTS`, `ENCHANTING`, `enchantLevelCost`, `CROP`, `CROP_STAGES`, `FARMING`, `BREEDING`, `BREED_FOOD`, `MOB_DROPS_V2`, `PARTICLE`, `PARTICLE_BUDGET`
- `net.ts`: `NET`, `NET_OPCODE`, `NET_KICK_REASON`, `NET_MAGIC`, `NET_HEADER_BYTES`, `encodeFrameHeader`, `decodeFrameHeader`, `isCompatibleProtocol`, メッセージ型, `INPUT_BIT`, `TOUCH`
- `index.ts`: 上記の再エクスポート＋`EVENT_V2`(12 件)＋`EventV2Payloads`＋`AnyEventName`／`AnyEventPayloads`／`EventBusV2`
- テスト: `src/__tests__/contract-v2.test.ts`（17 件。id 帯の非重複、次元/構造物、XP とエンチャント式、農業/繁殖、ネットのフレーミング）

ブロック id は 64..81（`BLOCK_V2_BASE=64`, `BLOCK_V2_MAX=99`）、アイテム id は 305..322（`ITEM_V2_BASE=305`, `ITEM_V2_MAX=383`）に限定する。v1 の 0..63 / 256..304 と `BLOCK_EXPERIMENTAL_BASE=200` を侵さない。

## 4. 受け入れゲート（毎マージで全部再実行）

| # | コマンド | 合格 |
|---|---|---|
| 1 | `pnpm -r exec tsc --noEmit` | exit 0 |
| 2 | `pnpm -r lint` | exit 0 |
| 3 | `pnpm -r test` | exit 0 |
| 4 | `pnpm build` | exit 0＋`dist` 生成 |
| 5 | `pnpm test:e2e` | exit 0／console error・warn ゼロ |
| 6 | `pnpm bench` | `failures=0`／予算超過は要因記録 |
| 7 | `bash scripts/report-size.sh` | raw/gzip を報告 |

追加ゲート（v1.1）:

- `packages/net`: フレーム encode/decode ラウンドトリップ、プロトコル互換判定、スナップショット直列化の単体テスト
- `apps/server`: ヘッドレス統合テスト（2 クライアント接続 → ブロック編集の伝播 → チャンクストリーミング）
- `packages/client`: タッチ入力（ジョイスティック／ボタン／長押し）とパーティクル予算の単体テスト
- `packages/world`: ネザー生成と村レイアウトの決定論ゴールデン
- `packages/gameplay`: エンチャント抽選の決定論、作物成長、繁殖クールダウン

## 5. 予算

- v1 の `PERF` / `BENCH` を据え置き。新規は `PARTICLE_BUDGET`（同時 2048、tick あたり生成 256）と `NET`（20 Hz tick、10 Hz スナップショット、8 人、6 チャンク半径、24 chunks/s/client）。
- H-05 の目標: 光シード＋縫合を 45 ms/chunk から 15 ms/chunk 以下へ。達成できない場合は原因と計測値を `docs/orchestration/decisions.md` に記録して受容する。

## 6. ブランチと報告

- 作業ブランチ `feat/mc-20260916/<taskid>`、統合は L0 が `integration/mc-20260916` へ 1 本ずつ `git merge --no-ff`、毎回フルゲート。
- 報告は `docs/reports/<taskid>.json`（v1 と同じスキーマ: `task`,`branch`,`status`,`base_sha`,`head_sha`,`commits[]`,`files_changed[]`,`checks[]`,`contract_changes_needed[]`,`notes`）。
- レビューは新規 2 体（`review/rev3`, `review/rev4`）が `docs/reviews/rev3.md` / `rev4.md` に記録。
- `main` への昇格は L0 のみ（ユーザー承認済み）。リリースは `v1.1.0`。

## 7. 停止条件

- 30 分以上詰まったら `blocked` で報告。
- 時間不足なら v2 を項目単位で切る。切る順序: パーティクル拡充 → 村生成 → 繁殖 → エンチャント → 別次元 → マルチプレイ。v1 の機能と全ゲートは絶対に削らない。
- 契約変更が必要になったら実装を止めて L0 に報告する。
