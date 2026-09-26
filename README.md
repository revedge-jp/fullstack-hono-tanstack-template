# fullstack-hono-tanstack-template

モノレポ（Turborepo）構成の SaaS テンプレート。

- **フロント**: TanStack Start + React 19（`apps/client`）
- **API**: Hono（`apps/api-service`）+ Result 指向（ROP、neverthrow）設計
- **DB**: Drizzle ORM + PostgreSQL（`packages/database`）
- **デプロイ**: Cloudflare Workers（client と api-service を単一 Worker にバンドル）

## クイックスタート

```sh
# 0) テンプレートの初期化（最初に一度だけ）
#    APP_NAME プレースホルダーをアプリ名に一括置換する。
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
- `packages/typescript-config`, `packages/tailwind-config`: 共有設定

詳細は [開発ガイド - パッケージ](docs/dev/development.md#パッケージ) を参照してください。

## ドキュメント

### 開発者向け

- [開発ガイド](docs/dev/development.md) - Client/Server/DB/パッケージ/コマンドの説明
- [環境変数ガイド](docs/dev/environment-variables.md) - 環境変数一覧と追加フロー
- [開発コマンド詳細](docs/dev/dev-commands.md) - よく使うコマンドの詳細説明
- [システムアーキテクチャ](docs/architecture/architecture.md) - システム全体の構成とデプロイフロー
- [既知の制約と見送り](docs/architecture/known-limitations.md) - テンプレートとして直す基準と、対応を見送っている項目の一覧
- [api-service README](apps/api-service/README.md) - 単体での起動・エンドポイント一覧と、規約の正典への案内

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
bun run test          # 全パッケージのテスト（api-service は統合/契約含む。TEST_DATABASE_URL の DB が必要）
bun run test:unit     # DB 不要のユニットテスト
bun run check-all     # まとめて検証（lint/type/test/arch）
```

### DB 操作

```sh
bun run db:up         # Postgres を起動
bun run db:down       # Postgres を停止（データは残る）
bun run db:reset      # Postgres をデータごと削除（確認あり）
bun run db:up:test    # テスト用DBのみ起動
bun run db:down:test  # テスト用DBのみ停止/削除（テスト DB は volume を持たない）
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
- **公開 3 日以内の版は入らない**（`bunfig.toml` の `minimumReleaseAge`）。`minimum release age` で弾かれたら版指定を外して 1 つ前を入れる。
- **lock**: `bun.lock` を信頼し、手動調整はしない。

## 環境変数

ルートの `.env` を利用（`dotenv -e .env`）。まず `cp .env.example .env` でひな形を用意する。
`.env.example` はダミー値で埋めてあり、コピーしただけで dev サーバーは起動する（`apps/api-service/src/config.ts`
が起動時に Zod で検証する）。実際の Google サインインを使うときだけ `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
に本物の値を設定する。

全変数の一覧・既定値・**新しい環境変数を追加する際の手順**は [環境変数ガイド](docs/dev/environment-variables.md) を参照。

## 要件

- Node >= 22
- Bun（`packageManager: bun@1.4.0`）

依存の追加/更新は必ず Bun 経由で行い、ロックファイルを尊重すること。

## メンテナンス方針

- 本テンプレートは Revedge の実プロダクト開発の土台として実運用しており、そこで得た学びを随時還元しています
- 個人メンテのため対応の SLA はありません。Issue / PR は歓迎しますが、取り込みは品質ゲートとの整合を優先して判断します
- 破壊的変更はバージョンタグと CHANGELOG ではなく、コミット履歴と ADR（`docs/architecture/`）で追跡しています
