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
cp .env.example .env
# .env の既定値のままで dev サーバーは起動する（config.ts のバリデーションを通過する
# ダミーの認証値が入っている）。ローカルのサインインは開発時のみ表示される
# 「Dev サインイン」ボタンで Google を介さず可能。
# 実際の Google サインインを試す場合のみ、GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET に
# 本物の OAuth クレデンシャルを設定する。詳細は docs/dev/environment-variables.md 参照。

# 3) データベースの起動
bun run db:up:all     # Postgres（本番/テスト）を起動

# 4) マイグレーションの適用
bun run db:migrate    # マイグレーション適用（drizzle-kit migrate）

# 5) 開発サーバーの起動
bun run dev           # 全体起動（依存の型生成も依存関係で実行）
```

起動後（`bun run dev` は client と api-service の2プロセスを起動する）:
- **アプリ本体**: http://localhost:3000 — client（Vite）。`/api/*` も同一オリジンでこの
  Worker がインプロセスに処理する（本番の単一 Worker 構成と同じ。ADR-001）。ブラウザでの
  動作確認・サインインはここにアクセスする。
- **API 単体サーバー**: http://localhost:8080 — api-service を Bun で単独起動したもの
  （`curl` 等での直接叩き・API 単体の動作確認用）。上記アプリ本体はこの 8080 を経由せず、
  自身のインプロセス Hono を使う点に注意。

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
- Codex AI レビューを使う場合は **2つとも**設定する: Secrets に `CODEX_REVIEW_API_KEY`、Variables に `ENABLE_CODEX_REVIEW=true`（変数を設定しないとワークフローは一度も起動しない — 派生プロダクトで未設定のまま24回 skip し続けた実例あり。詳細は `.github/workflows/codex-review.yml` 冒頭）

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

- [Cloudflare Workers デプロイガイド](docs/deploy/cloudflare-workers.md) - デプロイの概要とセットアップ（PR プレビュー環境 = `preview` ラベル opt-in もここ）
- [Alchemy IaC ガイド](docs/dev/alchemy-iac.md) - Infrastructure as TypeScript（PlanetScale DB + Hyperdrive + Worker。カスタムドメイン / エッジレート制限 / Logpush の opt-in もここ。deploy.yml のデプロイ本体）
- [GitHub ルールセット設定](docs/deploy/github-ruleset.md) - ブランチ保護の設定

## よく使うコマンド

### 開発

```sh
bun run dev           # モノレポ全体の dev（必要な型生成を依存で実行）
bun run build         # 変更対象の build（Turbo 依存）
bun run lint          # oxlint + oxfmt --check
bun run lint:fix      # oxlint --fix + oxfmt
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

### インフラ（Alchemy）

```sh
bun run infra:deploy:staging      # client をビルドして staging をデプロイ（PlanetScale DB + Hyperdrive + Worker）
bun run infra:deploy:production   # production をデプロイ
bun run infra:destroy:staging     # staging のリソースを削除
```

事前準備（Cloudflare 認証・環境変数）は [Alchemy IaC ガイド](docs/dev/alchemy-iac.md) を参照してください。

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

FSD チェック実行時に `EMFILE: too many open files` エラーが発生する場合、エディタや AI ツールのサンドボックス内で実行している可能性があります。通常のターミナルから実行するか、ツール側のサンドボックス設定を無効化してください。

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

ルートの `.env` を利用（`dotenv -e .env`）。まず `cp .env.example .env` でひな形を用意する。
全変数の一覧・追加フローは [環境変数ガイド](docs/dev/environment-variables.md) を参照。

### 必須環境変数

`apps/api-service/src/config.ts` が起動時に Zod で検証する。未設定だと dev サーバーが
起動しない（`.env.example` はいずれもダミー値で埋めてあるため、コピーすれば起動する）。

- `DATABASE_URL`: 本番/開発用データベース URL
  - Docker Compose 使用時: `postgresql://postgres:postgres@localhost:5432/app_db`
  - 本番環境: `postgresql://appuser:password@<private-ip>:5432/app`
- `BETTER_AUTH_SECRET`: Better Auth のセッション署名鍵（本番はランダムな強い値にする）
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: Google OAuth クレデンシャル
  - ダミー値のままでも起動し、開発時は「Dev サインイン」ボタンで Google を介さず
    ログインできる。実際の Google サインインを使う場合のみ本物の値を設定する
- `TEST_DATABASE_URL`: テスト用データベース URL（テスト実行時に必要）
  - Docker Compose 使用時: `postgresql://postgres:postgres@localhost:5433/app_db`

### 開発環境用（オプション）

#### Server (`apps/api-service`)

- `API_PORT`: API サーバーのポート（既定: 8080。`PORT` も後方互換で受理される）
- `NODE_ENV`: 環境（`development` / `test` / `production`、既定: `production` — fail-closed。ローカル開発は `.env` で `NODE_ENV=development` を明示する）
- `CORS_ORIGIN`: CORS 許可オリジン（本番では必須。開発/テスト時は未設定時 `http://localhost:3000`）
- `LOG_PRETTY`: ログの整形出力（`true` で有効化）
- `BETTER_AUTH_URL` / `BETTER_AUTH_TRUSTED_ORIGINS`: Better Auth のベース URL / 信頼オリジン

#### Client (`apps/client`)

- `CLIENT_PORT`: client（Vite）のポート（既定: 3000）
- `API_BASE_URL`: API サーバーの URL（既定: `http://localhost:8080`）
  - client と api-service は本番では同一 Worker のため、SSR からの API 呼び出しは
    `shared/lib/api-client.ts` が AsyncLocalStorage 経由で注入するインプロセス
    Hono RPC クライアントで行う（ADR-001）

### 設定例

`.env` の例（`cp .env.example .env` の中身に相当）:

```bash
# データベース
# Docker Compose で起動した場合のデフォルト設定:
# - ユーザー名: postgres / パスワード: postgres / データベース名: app_db
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app_db
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/app_db

# Auth（ダミー値のままで起動可。実際の Google サインイン時のみ本物の値に差し替え）
BETTER_AUTH_SECRET=your-secret-here
BETTER_AUTH_URL=http://localhost:8080
BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3000
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Server
NODE_ENV=development
LOG_PRETTY=false
# API_PORT=8080
# CORS_ORIGIN=http://localhost:3000
```

**注意**: Docker Compose で起動する場合、デフォルトではユーザー名 `postgres`、パスワード `postgres`、データベース名 `app_db` になります。本番環境では `appuser` ユーザーを使用しますが、開発環境では `postgres` ユーザーを使用します。

詳細は [開発ガイド - 環境変数](docs/dev/development.md#環境変数) を参照してください。**新しい環境変数を追加する際の手順**は [環境変数ガイド](docs/dev/environment-variables.md) を参照してください。

## 要件

- Node >= 18
- Bun（`packageManager: bun@1.3.1`）

依存の追加/更新は必ず Bun 経由で行い、ロックファイルを尊重すること。

## メンテナンス方針

- 本テンプレートは Revedge の実プロダクト開発の土台として実運用しており、そこで得た学びを随時還元しています
- 個人メンテのため対応の SLA はありません。Issue / PR は歓迎しますが、取り込みは品質ゲートとの整合を優先して判断します
- 破壊的変更はバージョンタグと CHANGELOG ではなく、コミット履歴と ADR（`docs/architecture/`）で追跡しています
