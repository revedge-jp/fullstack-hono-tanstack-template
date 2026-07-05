# git worktree 運用ガイド

このドキュメントでは、git worktree を使った並行開発のワークフローについて説明します。

## 概要

git worktree を使用すると、同じリポジトリの複数のブランチを**別々のディレクトリで同時に作業**できます。

### メリット

- **コンテキストスイッチの削減**: ブランチ切り替え不要で複数タスクを並行作業
- **ビルド状態の維持**: 各 worktree で独立したビルドキャッシュを保持
- **レビュー作業の効率化**: メイン作業を中断せずに PR レビュー可能
- **緊急対応**: 長時間タスク中でも hotfix ブランチに即座に切り替え可能

### ディレクトリ構造

```
~/dev/
├── fullstack-hono-tanstack-template/               # メインの worktree（main ブランチ）
├── fullstack-hono-tanstack-template-feat-xxx/      # feature/xxx ブランチ用 worktree
├── fullstack-hono-tanstack-template-fix-yyy/       # fix/yyy ブランチ用 worktree
└── ...
```

## 使い方

### ヘルパースクリプト

プロジェクトには worktree 管理用のヘルパースクリプトが用意されています。

```bash
# 一覧表示
bun run worktree list

# worktree 追加（新規ブランチ作成 + セットアップ）
bun run worktree add feat/new-feature

# worktree 追加（セットアップなし）
bun run worktree add feat/new-feature --no-setup

# worktree 削除
bun run worktree remove feat/new-feature

# 既存 worktree のセットアップ
bun run worktree setup feat/new-feature

# ヘルプ
bun run worktree help
```

### 手動操作

```bash
# worktree 追加（新規ブランチ）
git worktree add -b feat/xxx ../fullstack-hono-tanstack-template-feat-xxx

# worktree 追加（既存ブランチ）
git worktree add ../fullstack-hono-tanstack-template-feat-xxx feat/xxx

# worktree 削除
git worktree remove ../fullstack-hono-tanstack-template-feat-xxx

# 一覧表示
git worktree list

# 古い参照のクリーンアップ
git worktree prune
```

## セットアップ

新しい worktree を作成した後、以下のセットアップが必要です。
ヘルパースクリプトはこれらを自動実行します。

### 1. 環境変数の設定

```bash
# メインの .env をコピー（自動実行される）
cp ../fullstack-hono-tanstack-template/.env .env

# ポート設定は自動追加される（CLIENT_PORT, API_PORT, DATABASE_URL 等）
```

### 2. 依存関係のインストール

```bash
bun install
```

### 3. マイグレーションファイル生成（スキーマ変更時のみ）

```bash
bun run db:generate
```

## ポート設定

worktree ごとに異なるポートが自動設定されます。これにより、複数の worktree で同時に `bun run dev` と `bun run db:up` を実行できます。

### ポート割り当て

| スロット | ブランチ例 | Client | API | DB | TestDB |
|----------|------------|--------|-----|-----|--------|
| 0 | main | 3000 | 8080 | 5432 | 5433 |
| 1 | dev-1 | 3001 | 8082 | 5434 | 5435 |
| 2 | dev-2 | 3002 | 8084 | 5436 | 5437 |
| 3 | dev-3 | 3003 | 8086 | 5438 | 5439 |

### 自動設定される環境変数

`bun run worktree add dev-1` を実行すると、`.env` に以下が自動追加されます:

```bash
# Worktree ポート設定 (スロット: 1)
CLIENT_PORT=3001
API_PORT=8082
API_BASE_URL="http://localhost:8082"
SERVER_PUBLIC_URL="http://localhost:8082"

# Worktree DB設定 (スロット: 1)
DATABASE_PORT=5434
TEST_DATABASE_PORT=5435
DATABASE_URL="postgresql://postgres:postgres@localhost:5434/app_db?schema=public"
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5435/app_db?schema=public"
POSTGRES_CONTAINER_NAME="app_postgres_slot1"
POSTGRES_TEST_CONTAINER_NAME="app_postgres_test_slot1"
POSTGRES_VOLUME_NAME="postgres-data_slot1"
POSTGRES_TEST_VOLUME_NAME="postgres-test-data_slot1"
```

### 手動でポートを変更する場合

`.env` の値を直接編集してください。

## ベストプラクティス

### 1. AI エージェント並列開発

複数の Cursor ウィンドウで同時に機能開発を行う場合:

```bash
# 開発スロットを作成
bun run worktree add dev-1
bun run worktree add dev-2

# 各ウィンドウで別々の worktree を開く
# Cursor ウィンドウ1: ~/dev/fullstack-hono-tanstack-template-dev-1
# Cursor ウィンドウ2: ~/dev/fullstack-hono-tanstack-template-dev-2
```

### 2. worktree の用途を明確にする

| 用途 | 推奨 worktree 数 |
|------|------------------|
| 機能開発（並列） | 2〜3 |
| main（マージ確認） | 1（既存） |
| hotfix 用 | 必要時に作成・削除 |

### 3. データベースの扱い

worktree ごとに独立した DB コンテナが自動設定されます。

```bash
# 各 worktree で独自の DB を起動
bun run db:up

# マイグレーション実行
bun run db:migrate
```

| worktree | 開発 DB ポート | テスト DB ポート | コンテナ名 |
|----------|----------------|------------------|------------|
| main | 5432 | 5433 | app_postgres |
| dev-1 | 5434 | 5435 | app_postgres_slot1 |
| dev-2 | 5436 | 5437 | app_postgres_slot2 |

**メリット**:
- マイグレーションの競合なし
- テストの並列実行が安全
- 各 worktree で独立した実験が可能

### 4. ビルド成果物

以下のディレクトリは worktree ごとに独立しているため、競合しません:

- `node_modules/`
- `.next/`
- `dist/`
- `.turbo/`

### 5. Git 操作

```bash
# どの worktree からでも全ブランチを操作可能
git fetch origin
git log origin/main

# ただし、別の worktree でチェックアウト中のブランチは
# 現在の worktree ではチェックアウトできない
```

### 6. IDE の設定

**VS Code / Cursor**:
- 各 worktree を別ウィンドウで開く
- ワークスペース設定は worktree ごとに独立

**推奨**: メイン worktree に戻る際は、同じウィンドウで「フォルダを開く」

## トラブルシューティング

### Q: worktree が削除できない

```bash
# 強制削除
git worktree remove --force ../fullstack-hono-tanstack-template-feat-xxx

# それでも失敗する場合
rm -rf ../fullstack-hono-tanstack-template-feat-xxx
git worktree prune
```

### Q: 「already checked out」エラー

同じブランチを複数の worktree でチェックアウトすることはできません。

```bash
# 対処: 別のブランチ名を使用するか、既存の worktree を削除
```

### Q: bun install が遅い

worktree ごとに完全な `node_modules` が必要なため、初回は時間がかかります。
Bun のグローバルキャッシュにより、2回目以降は高速化されます。

### Q: Drizzle のスキーマ変更が反映されない

```bash
# 各 worktree で再生成が必要
bun run db:generate
```

## 関連コマンド

| コマンド | 説明 |
|----------|------|
| `bun run worktree add <branch>` | worktree 追加 |
| `bun run worktree remove <branch>` | worktree 削除 |
| `bun run worktree list` | 一覧表示 |
| `bun run worktree setup [branch]` | セットアップ実行 |
| `bun run sync-main` | main ブランチへの追従（既存） |

## 参照

- [Git公式ドキュメント: git-worktree](https://git-scm.com/docs/git-worktree)
- [開発ガイド](development.md)

