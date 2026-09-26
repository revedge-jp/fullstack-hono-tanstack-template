## 開発効率化コマンド集

日々の開発でよく使う効率化コマンドのガイドです。目的・挙動・主要オプションと、よくある使い方の例をまとめています。

### bun run check-all（scripts/check/check-all.sh）

push 前の統合チェックを一括実行します。

- 実行内容（Lint/Type/Test/Architecture を常時実行。Lint/Type/Test は turbo filter により差分限定）
  - Lint（oxlint + oxfmt --check）: `turbo run lint`
  - Typecheck（TypeScript）: `turbo run typecheck`、`alchemy.run.ts` は `bun run typecheck:infra`
  - Tests: `TEST_DATABASE_URL` の DB に drizzle-kit migrate を当てた上で `turbo run test` を実行（api-service は
    integration も実行されるので DB が必要）
  - Architecture: FSD（steiger）・循環/孤立（madge）・dependency-cruiser・arch-guards・knip（`SKIP_KNIP=1` で省略。
    pre-push は省略している）
  - その他: 文書の表現（`bun run lint:prose`）・ファイル名（kebab-case）・migration journal の順序・api-service の `process.env` 直参照・`scripts/` のテスト・
    非推奨コードの検索（警告のみ）
- 既定の変更影響フィルタ: `...[origin/main]`（turbo filter）
- どのゲートが pre-push / CI のどちらで実行されるかは [品質ゲート ガイド](quality-gates.md) を参照

使い方:

```bash
bun run check-all
```

主要な環境変数:

- CI=true または CI_MODE=1: 簡素出力（機械可読寄り）
- NO_COLOR: カラー出力を無効化
- TURBO_FILTER: 変更影響フィルタを上書き（例: `'...[HEAD^]'`）
- SKIP_LINT / SKIP_TYPECHECK / SKIP_TEST / SKIP_ARCH 等: 各ステップを省略（`scripts/check/check-all.sh` の各ステップが見る `SKIP_*`）

例:

```bash
# CI 風の簡素出力
CI_MODE=1 bun run check-all

# 直前のコミットからの差分に限定
TURBO_FILTER='...[HEAD^]' bun run check-all
```

### bun run lint:fix（各パッケージの oxlint/oxfmt 修正）

コード整形と一部自動修正を行います。ルートでは `turbo run lint:fix` を呼び出し、ワークスペースごとに以下を実行します。

- 各パッケージの定義: `oxlint --fix . && oxfmt .`
- `turbo.json` で `lint:fix` はキャッシュ無効（毎回実行）

使い方:

```bash
# モノレポ全体（推奨）
bun run lint:fix

# パッケージ単体で実行したい場合
cd apps/api-service && bun run lint:fix
```

注意:

- `oxlint --fix` は安全な自動修正だけを適用する（`--fix-suggestions` / `--fix-dangerously` は付けていない）。それでも実行後は差分を確認してください。

### bun run sync-main（scripts/sync-main.sh）

現在のブランチを `origin/main` に追従させ、依存やDB、型チェックまで整えます。

- `main` 上: fast-forward pull のみ
- その他のブランチ: デフォルトで rebase。`SYNC_STRATEGY=merge` を指定すると no-ff マージ
- 実行前に未コミット変更がないことを要求
- 追従後に以下を自動実行
  - `bun install`（LEFTHOOK=0 で lefthook フック抑止）
  - DB セットアップ（存在する場合）: `.env` の存在確認 → `bun run db:migrate`。**どちらかが失敗すれば
    そこで終了する**（以前は drizzle-kit の終了コードを見ず、DB 停止中でも「✅ 同期完了」と出ていた）
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
- DB 未起動: `bun run db:up` を先に実行してから再実行（スクリプトが `.env` の host:port へ疎通確認し、
  つながらなければその旨を出す）
- `.env` が無い: `cp .env.example .env`（`.claude/worktrees/` 配下なら `bash scripts/agent-worktree-setup.sh`）

### 推奨ワークフローの例

```bash
# 1) 作業開始時やレビュー前に最新化
bun run sync-main

# 2) 修正を自動フォーマット
bun run lint:fix

# 3) まとめて品質検証（変更影響に限定）
bun run check-all
```


