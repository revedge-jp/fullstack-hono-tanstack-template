# REVIEW.md

コードレビュー（Claude Code Review・`/code-review`・Codex）の判定基準。手順そのものは
`.claude/commands/codex-review.md` にあり、ここは「何を指摘し、何を指摘しないか」だけを書く。

## 指摘してよいもの（証拠が必須）

- **失敗するコードパスを 1 本追跡できる**欠陥。入力・状態・タイミングを具体的に書き、変更前が
  それを防いでいたなら（リグレッション）その根拠も書く
- 期待動作（正常系 / 異常系: 404・409・403・400 の網羅）と実装の乖離で、テストがそのケースを
  持たないもの
- 認証・認可の欠落や削除、`process.env` の直参照、feature 間の直接 import、domain 層への
  Zod / Drizzle / HTTP 混入（依存方向 `presentation → application → domain ← infrastructure`）
- ROP のエラー型が usecase → presentation で潰れている・HTTP ステータス分岐が網羅されていない
- 検証器（`scripts/check/**`・`dependency-cruiser.config.cjs`・`.oxlintrc.json`・`lefthook.yml`・
  CI）の弱体化。閾値の引き下げ、除外の追加、ガードの削除は理由の記載が無ければ指摘する
- 同じ役割のコードの再実装。既存ヘルパ（`createFakeApp`・`api-mock.ts`・`toHttp`・
  `zValidator` ラッパ等）を名指しで示す
- 方針転換後に残った旧方針の記述（コメント・ドキュメント・写経元テンプレ）

## 指摘しないもの

- スタイル・命名の好み（oxlint / oxfmt / `check:kebab` が機械的に決める）
- 「〜かもしれない」で止まる推測。トリガーを特定できないなら PLAUSIBLE と明記し、確認方法を書く
- `apps/client/components/ui/**` などの生成コード
- テストファイル内の `as` キャスト、`*.test.ts` 限定の緩和ルール
- 既存の欠陥で今回の差分が触れていないもの（ただし触れた関数内の欠陥は対象）

## 出力

重大度順に並べ、各指摘に「ファイル:行」「失敗シナリオ」「修正案」を付ける。指摘が無いなら
「レビューOK」と一言。レビュー往復の回数と主な指摘は PR 本文に残す（`ship.md`）。
