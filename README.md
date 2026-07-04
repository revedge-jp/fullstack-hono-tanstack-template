# fullstack-hono-tanstack-template

モノレポ（Turborepo）構成の SaaS テンプレート。

- **フロント**: TanStack Start + React 19（`apps/client`）
- **API**: Hono（`apps/api-service`）+ Result 指向（ROP、neverthrow）設計
- **DB**: Drizzle ORM + PostgreSQL（`packages/database`）
- **デプロイ**: Cloudflare Workers（client と api-service を単一 Worker にバンドル）

## クイックスタート

```sh
# 0) テンプレートの初期化（最初に一度だけ）
#    {{APP_NAME}} プレースホルダーをアプリ名に一括置換する。
#    これを飛ばすと wrangler.jsonc のバリデーションエラーで dev サーバーが起動しない
./scripts/init-template.sh my-app

# 1) 依存関係のインストール
bun install

# 2) 環境変数の設定
# .env ファイルを作成し、以下の環境変数を設定してください：
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app_db?schema=public
# TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/app_db?schema=public

# 3) データベースの起動
bun run db:up:all     # Postgres（本番/テスト）を起動

# 4) マイグレーションの適用
bun run db:migrate    # マイグレーション適用（drizzle-kit migrate）

# 5) 開発サーバーの起動
bun run dev           # 全体起動（依存の型生成も依存関係で実行）
```

起動後:
- Client: http://localhost:3000
- Server: http://localhost:8080

詳細は [開発ガイド](docs/dev/development.md) を参照してください。

### GitHub リポジトリのセットアップ（テンプレートから作った直後に一度だけ）

ブランチ保護 Ruleset・マージ挙動・セキュリティ設定を一括適用し、Renovate の導入状況を確認します:

```sh
gh auth login          # 未認証の場合
./scripts/setup-github.sh
```

- Ruleset と auto-merge は **public リポジトリまたは GitHub Pro 以上** が必要（対象外の場合はスクリプトが案内を出して他の設定は続行します）
- Renovate は GitHub App の承認が必要なため、スクリプトの案内に従って https://github.com/apps/renovate からインストールしてください
- 設定内容の詳細・チーム開発向けの変更は [GitHub Ruleset 設定ガイド](docs/deploy/github-ruleset.md) を参照

## リポジトリ構成

### アプリケーション

- `apps/client`: TanStack Start アプリ（React 19, Tailwind v4, shadcn/ui）
  - 詳細: [apps/client/README.md](apps/client/README.md)
- `apps/api-service`: Hono API（クリーンアーキ/ROP、テスト一式）
  - 詳細: [apps/api-service/README.md](apps/api-service/README.md)

### パッケージ

- `packages/database` (`@repo/db`): Drizzle スキーマ/クライアントのラッパ
- `packages/logging` (`@repo/logging`): pino ベースのロガー（Workers 対応）
- 型共有は Hono RPC（`AppType`）、Result 型は npm の `neverthrow` を使用
- `packages/ui`: 共有 UI コンポーネント（client/admin-client で共有）
- `packages/typescript-config`, `packages/tailwind-config`: 共有設定

詳細は [開発ガイド - パッケージ](docs/dev/development.md#パッケージ) を参照してください。

## ドキュメント

### 開発者向け

- [開発ガイド](docs/dev/development.md) - Client/Server/DB/パッケージ/コマンドの説明
- [環境変数ガイド](docs/dev/environment-variables.md) - 環境変数一覧と追加フロー
- [開発コマンド詳細](docs/dev/dev-commands.md) - よく使うコマンドの詳細説明
- [システムアーキテクチャ](docs/architecture/architecture.md) - システム全体の構成とデプロイフロー
- [サーバー設計ガイド](apps/api-service/README.md) - ROP/Result、ユースケース/ステップ、DI、テスト方針

### デプロイ向け

- [Cloudflare Workers デプロイガイド](docs/deploy/cloudflare-workers.md) - デプロイの概要とセットアップ
- [GitHub ルールセット設定](docs/deploy/github-ruleset.md) - ブランチ保護の設定

## よく使うコマンド

### 開発

```sh
bun run dev           # モノレポ全体の dev（必要な型生成を依存で実行）
bun run build         # 変更対象の build（Turbo 依存）
bun run lint          # Biome
bun run lint:fix      # Biome （--write --unsafe）
bun run typecheck     # TypeScript
bun run test          # サーバーのテスト（統合/契約含む）
bun run test:unit     # サーバーのユニットテスト
bun run check-all     # まとめて検証（lint/type/test/arch）
```

### DB 操作

```sh
bun run db:up         # Postgres を起動
bun run db:down       # Postgres を停止/削除
bun run db:up:test    # テスト用DBのみ起動
bun run db:down:test  # テスト用DBのみ停止/削除
bun run db:studio     # Drizzle Studio
bun run db:generate   # マイグレーションファイル生成（drizzle-kit generate）
bun run db:migrate    # マイグレーション適用（drizzle-kit migrate）
```

### アーキテクチャ/依存チェック

```sh
bun run arch:check    # アーキ規約（依存・FSD・knip）一式
bun run arch:guards   # 構文/配置ガード（scripts/check/arch-guards.sh）
bun run arch:dc       # dependency-cruiser
bun run dep:cycles    # 循環依存（client/api-service）
bun run dep:orphans   # 孤立ファイル/依存
bun run dep:graph     # 依存グラフ画像生成（client/api-service）
```

#### トラブルシューティング

FSD チェック実行時に `EMFILE: too many open files` エラーが発生する場合、Cursor を使用している場合は以下の設定で解決できます。

1. Cursor の設定を開く
2. `Cursor Settings` > `Auto Run Mode` で `Unsandboxed` を選択

※ その他の AI ツールを使用している場合の解決方法は未確認です。

詳細は [開発コマンド詳細](docs/dev/dev-commands.md) を参照してください。

## 推奨ワークフロー（開発）

```sh
# 1) ブランチを最新化
bun run sync-main

# 2) 変更
# ...編集...

# 3) 自動整形
bun run lint:fix

# 4) まとめて検証（差分限定）
bun run check-all

# 5) PR
git push -u origin <branch>
```

## パッケージ管理（Bun）方針

- **追加**: `bun add <pkg>`（開発依存は `bun add -d <pkg>`）。手動で `package.json` を編集しない。
- **削除**: `bun remove <pkg>`。
- **実行場所**: 対象パッケージディレクトリで実行（例: `apps/api-service`）。
- **バージョン指定**: 原則不要（必要時のみ `@<version>`）。
- **lock**: `bun.lock` を信頼し、手動調整はしない。

## 環境変数

ルートの `.env` を利用（`dotenv -e .env`）。

### 必須環境変数

- `DATABASE_URL`: 本番/開発用データベース URL
  - Docker Compose 使用時: `postgresql://postgres:postgres@localhost:5432/app_db?schema=public`
  - 本番環境: `postgresql://appuser:password@<private-ip>:5432/app?schema=public`
- `TEST_DATABASE_URL`: テスト用データベース URL
  - Docker Compose 使用時: `postgresql://postgres:postgres@localhost:5433/app_db?schema=public`

### 開発環境用（オプション）

#### Server (`apps/api-service`)

- `PORT`: サーバーポート（既定: 8080）
- `NODE_ENV`: 環境（`development` / `test` / `production`、既定: `development`）
- `CORS_ORIGIN`: CORS 許可オリジン（本番では必須。開発/テスト時は未設定時 `http://localhost:3000`）
- `LOG_PRETTY`: ログの整形出力（`true` で有効化）
#### Client (`apps/client`)

- `API_BASE_URL`: API サーバーのベース URL（既定: `http://localhost:8080`）
  - 本番（CF Workers）では client と api-service が同一 Worker のため HTTP ループバックは使わず、
    SSR からは AsyncLocalStorage 経由で container を直接呼び出す（ADR-001）

### 設定例

`.env` ファイルの例:

```bash
# データベース
# Docker Compose で起動した場合のデフォルト設定:
# - ユーザー名: postgres
# - パスワード: postgres
# - データベース名: app_db
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app_db?schema=public
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/app_db?schema=public

# Server
PORT=8080
NODE_ENV=development
LOG_PRETTY=true
CORS_ORIGIN=http://localhost:3000

# Client
API_BASE_URL=http://localhost:8080
```

**注意**: Docker Compose で起動する場合、デフォルトではユーザー名 `postgres`、パスワード `postgres`、データベース名 `app_db` になります。本番環境では `appuser` ユーザーを使用しますが、開発環境では `postgres` ユーザーを使用します。

詳細は [開発ガイド - 環境変数](docs/dev/development.md#環境変数) を参照してください。**新しい環境変数を追加する際の手順**は [環境変数ガイド](docs/dev/environment-variables.md) を参照してください。

## 要件

- Node >= 18
- Bun（`packageManager: bun@1.3.1`）

依存の追加/更新は必ず Bun 経由で行い、ロックファイルを尊重すること。
