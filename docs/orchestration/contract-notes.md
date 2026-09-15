# 契約の根拠メモ（explorer 4体の調査結果まとめ）

Phase 2 で並列起動した explorer の報告から、v1 で採用した方針だけを抜き出したもの。
実装者はここを読めば「なぜこの型なのか」が分かる。詳細な数値は `packages/core-types` のコメントが正。

## EX1 / EX3: 描画・ライティング

- three.js は WebGL2 + `WebGLRenderer`。マテリアルは3系統のみ: Opaque / Cutout(`alphaTest: 0.5`, `transparent: false`, `depthWrite: true`) / Translucent(水, `transparent: true`, `depthWrite: true`, `DoubleSide`)。水同士の面は生成しない。
- テクスチャは `assets-gen` が 16px タイル・16x16 のアトラス PNG を手続き生成し、クライアントはそれを層に切って `DataArrayTexture` として使う（アトラスの UV にじみを避けつつ「テクスチャアトラス」要件を満たす）。`NearestFilter` + mipmap、`generateMipmaps` は層単位。
- AO は `3 - (side1 + side2 + corner)`、`side1 && side2` なら 0。四隅の AO 和で quad の分割方向を反転（`a00 + a11 > a01 + a10`）。
- 光は頂点に焼き込む（`(sky << 4) | block`）。昼夜サイクルは sky 成分に掛ける係数をシェーダ uniform で渡す。水中演出は fog 密度と色の切り替え。
- 視錐台カリングはセクション単位。`position` 属性を持たないジオメトリは `computeBoundingSphere` が壊れるので、境界球を手動設定するか `frustumCulled = false` にする。
- 光伝播は BFS。設置時は「除去伝播 → 再伝播」の2段。空光は `skyPassThrough` の列を 15 で初期化し、`heightmap` で開始位置を決める。チャンク跨ぎは境界キューに積み、`stitchBoundaries(2)` で収束させる（斜め伝播のため2パス必要）。
- 流体は「状態を直接書き換えず、近傍から純関数で再計算する」方式（`computeFluidAt`）。これで振動と生成順依存を避ける。ソース自己複製は v1 では無効。

## EX2: greedy meshing / Worker

- 0fps 方式のスライス走査（6面 x マスク）。メッシュ単位は 16^3 セクション。入力は 1 ボクセル padding 付きの 18^3 コピー（`paddedIndex`）。面の所有者は「固体側のボクセル」。
- マージキーは 向き + テクスチャ層 + レイヤ + 4頂点AO + 光。v1 は面単位でフラットな光を使う（滑らかな光は `MeshFlags.smoothLight` で後から有効化できる形にしておく）。
- 頂点は **Uint16 x 8 レーンのインターリーブ**（`VERTEX_STRIDE_U16`）。Uint32 ビットパックは three.js が非正規化整数を float32 に変換する経路で 2^24 超のビットが落ちるため採用しない。
- 転送した `ArrayBuffer` はデタッチされる。結果は `revision` で照合し、古いものは破棄する。インデックスは Uint16 に収まる（1セクションの頂点数上限内）。
- Worker は `worker: { format: 'es' }` と `new Worker(new URL('./mesher.worker.ts', import.meta.url), { type: 'module' })` の静的記述。数は `clamp(hardwareConcurrency - 1, 2, 6)`、in-flight は worker 数 x 2。GPU アップロードは 1フレーム 2〜3 チャンクまで。

## EX4: 決定論 / 直列化 / ECS / A* / 物理

- 乱数は「座標ハッシュ優先」。`hashU32(seed, salt, x, y, z)` は純関数なので生成順・並列度に依存しない。ストリーム（`makeRng`）はループ順が固定された局所処理だけに使う。
- ノイズは改良 Perlin（quintic fade + 固定勾配表）。`Math.sin/cos` は使わない。fBm は lacunarity 1.98 / gain 0.51 + オクターブごとの回転、2段のドメインワープ。
- チャンク直列化はパレット + ビットパック（bits ∈ {1,2,4,8,16}、ワード跨ぎなし）。`paletteLen === 1` なら `bits = 0` でデータ省略。光は保存しない（読み込み時に再計算）。
- ECS はスパースセット。イテレーション中の構造変更はコマンドバッファに積み、tick 末尾の `flush()` で適用する。
- A* は octile ヒューリスティック、ノード上限とミリ秒上限の両方で打ち切り（`partial` を返す）。斜め移動は角抜け禁止。未ロードチャンクは「通行不可」ではなく高コスト。
- 物理は Y→X→Z の順で解決し、1サブステップ 0.45 ブロック以下に分割（トンネリング防止）。`stepHeight 0.6`、`epsilon 1e-3`、落下ダメージは 3 ブロック無償。
- IndexedDB は複合キー `[worldId, cx, cz]`（文字列キーは負座標の順序が壊れる）。書き込みは 32 チャンクまたは 1.5 秒でバッチ化し、1トランザクションにまとめる。`CompressionStream('deflate-raw')` は Node 21.2 以降が必要なので、Node 側は `zlib` にフォールバックする。
