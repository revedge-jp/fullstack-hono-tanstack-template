## 開発効率化コマンド集

日々の開発でよく使う効率化コマンドのガイドです。目的・挙動・主要オプションと、よくある使い方の例をまとめています。

### bun run check-all（scripts/check/check-all.sh）

push 前の統合チェックを一括実行します。

- 実行内容（Lint/Type/Test/Architecture を常時実行。Lint/Type/Test は turbo filter により差分限定）
  - Lint（Biome）: `turbo run lint`
  - Typecheck（TypeScript）: `turbo run typecheck`
  - Tests: DB に対して `bun run db:migrate`（drizzle-kit migrate）を行った上で `turbo run test` を実行
  - Architecture: 依存/設計ガードの検査（常時実行）
- 既定の変更影響フィルタ: `...[origin/main]`（turbo filter）

使い方:

```bash
bun run check-all
```

主要な環境変数:

- CI=true または CI_MODE=1: 簡素出力（機械可読寄り）
- NO_COLOR: カラー出力を無効化
- TURBO_FILTER: 変更影響フィルタを上書き（例: `'...[HEAD^]'`）
- TURBO_BASE_REF: 変更差分のベース参照（既定: `origin/main`）

例:

```bash
# CI 風の簡素出力
CI_MODE=1 bun run check-all

# 特定の差分に限定
TURBO_FILTER='...[origin/main]^' bun run check-all
```

### bun run lint:fix（各パッケージの Biome 修正）

コード整形と一部自動修正を行います。ルートでは `turbo run lint:fix` を呼び出し、ワークスペースごとに以下を実行します。

- 各パッケージの定義: `biome check . --write --unsafe`
- `turbo.json` で `lint:fix` はキャッシュ無効（毎回実行）

使い方:

```bash
# モノレポ全体（推奨）
bun run lint:fix

# パッケージ単体で実行したい場合
cd apps/api-service && bun run lint:fix
```

注意:

- `--unsafe` により一部の修正は破壊的になる可能性があります。実行後は差分を確認してください。

### bun run sync-main（scripts/sync-main.sh）

現在のブランチを `origin/main` に追従させ、依存やDB、型チェックまで整えます。

- `main` 上: fast-forward pull のみ
- その他のブランチ: 既定で rebase。`SYNC_STRATEGY=merge` を指定すると no-ff マージ
- 実行前に未コミット変更がないことを要求
- 追従後に以下を自動実行
  - `bun install`（LEFTHOOK=0 で lefthook フック抑止）
  - DB セットアップ（存在する場合）: `bun run db:generate` / `bun run db:migrate`
  - 型チェック: `bun run typecheck`

使い方:

```bash
# 既定（rebase で追従）
bun run sync-main

# merge 戦略を使う
SYNC_STRATEGY=merge bun run sync-main
```

トラブルシュート:

- rebase/merge でコンフリクト: 解決後、`git rebase --continue` または `git rebase --abort` の上で再実行
- DB 未起動: `bun run db:up` を先に実行してから再実行

### 推奨ワークフローの例

```bash
# 1) 作業開始時やレビュー前に最新化
bun run sync-main

# 2) 修正を自動フォーマット
bun run lint:fix

# 3) まとめて品質検証（変更影響に限定）
bun run check-all
```


