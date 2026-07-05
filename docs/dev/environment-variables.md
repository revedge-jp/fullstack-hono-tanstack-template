# 環境変数ガイド

このドキュメントでは、環境変数の一覧と、**新しい環境変数を追加する際の手順**を説明します。

## 目次

- [既存の環境変数一覧](#既存の環境変数一覧)
- [環境変数追加フロー](#環境変数追加フロー)
- [各ファイルの役割](#各ファイルの役割)
- [本番環境への反映](#本番環境への反映)
- [CI/CD への反映](#cicd-への反映)
- [設計原則](#設計原則)

## 既存の環境変数一覧

### 必須（開発環境）

| 変数名 | 説明 | 例 |
|--------|------|-----|
| `DATABASE_URL` | 本番/開発用データベース接続 URL | `postgresql://postgres:postgres@localhost:5432/app_db?schema=public` |
| `TEST_DATABASE_URL` | テスト用データベース接続 URL | `postgresql://postgres:postgres@localhost:5433/app_db` |

### Server（api-service）

| 変数名 | 説明 | 既定値 |
|--------|------|--------|
| `NODE_ENV` | 環境 | `development` |
| `PORT` | サーバーポート | `8080` |
| `CORS_ORIGIN` | CORS 許可オリジン | 本番必須。開発/テスト時は未設定時 `http://localhost:3000` |
| `LOG_PRETTY` | ログ整形出力 | （未設定） |
| `LOG_LEVEL` | ログレベル（fatal/error/warn/info/debug/trace/silent） | 未設定時は環境別デフォルト（開発: debug、本番: info） |
| `GOOGLE_CLOUD_PROJECT` | GCP プロジェクト ID | `kikagaku` |
| `PREFIX` | リソース名プレフィックス | `local` |

### Client

| 変数名 | 説明 | 既定値 |
|--------|------|--------|

### Docker / インフラ

| 変数名 | 説明 | 既定値 |
|--------|------|--------|
| `SERVER_PUBLIC_URL` | サーバー公開 URL | `http://localhost:8080` |
| `POSTGRES_VOLUME_NAME` | Postgres データボリューム名 | `postgres-data` |
| `POSTGRES_TEST_VOLUME_NAME` | テスト用 Postgres ボリューム名 | `postgres-test-data` |
| `POSTGRES_CONTAINER_NAME` | Postgres コンテナ名 | `ax_saas_postgres` |
| `POSTGRES_TEST_CONTAINER_NAME` | テスト用 Postgres コンテナ名 | `ax_saas_postgres_test` |
| `DATABASE_PORT` | Postgres ポート | `5432` |
| `TEST_DATABASE_PORT` | テスト用 Postgres ポート | `5433` |

---

## 環境変数追加フロー

新しい環境変数を追加する際は、以下の手順に従ってください。

### api-service に環境変数を追加する場合

1. **`.env.example`** にサンプル値を追加する
2. **`apps/api-service/src/config.ts`** を更新する:
   - `ConfigSchema` に Zod スキーマを追加
   - `AppConfig` 型にプロパティを追加
   - `loadConfig()` の戻り値オブジェクトにマッピングを追加
3. **`turbo.json`** の該当タスクの `env` 配列に追加する（build/dev/test 等で使用する場合）
4. **CI**: `.github/workflows/ci.yml` の該当ジョブの `env` に追加する（テストやビルドで必要な場合）
5. **本番環境**: `apps/client/wrangler.jsonc` の `vars`（非機密）または `wrangler secret put`（機密）で渡す
6. **ドキュメント**: 本ファイルの一覧と `README.md` の環境変数セクションを更新する

### client に環境変数を追加する場合

1. **`.env.example`** にサンプル値を追加する
2. **参照箇所**を実装する（例: `apps/client/shared/lib/api.ts`）。現状バリデーションはないが、フォールバックを適切に設定する
3. **`VITE_` prefix**: クライアント（ブラウザ）に露出する変数は Vite の慣例に従い `VITE_` を付与する。機密情報は絶対に含めない
4. **turbo.json**: client の build で使用する場合は `env` に追加する
5. **CI**: E2E 等で必要なら `.github/workflows/ci.yml` の `e2e-tests` ジョブの `env` に追加する
6. **本番環境**: `apps/client/wrangler.jsonc` の `vars` に追加する（環境別は `env.staging` / `env.production` 配下）
7. **ドキュメント**: 本ファイルの一覧と `README.md` を更新する

### Docker / インフラのみの環境変数の場合

1. **`docker-compose.yml`**: コンテナ名・ポート・ボリューム名等を `${VAR:-default}` 形式で上書き可能にする
2. **`.env.example`** に該当変数を追加する
3. **ドキュメント**: 本ファイルの一覧を更新する

---

## 各ファイルの役割

| ファイル | 役割 |
|----------|------|
| `.env` | 実際の環境変数（ローカル開発用）。`.gitignore` で除外 |
| `.env.example` | サンプル値の定義。新規開発者向けのテンプレート |
| `apps/api-service/src/config.ts` | api-service の環境変数バリデーション（Zod）と型定義の中心。`loadConfig()` で起動時に検証 |
| `turbo.json` | Turborepo のタスクごとに `env` を宣言。**キャッシュキーに影響**するため、build 結果に影響する変数はここに追加する |
| `docker-compose.yml` | Postgres 等のコンテナ起動時の環境変数。`${VAR:-default}` で上書き可能 |
| `apps/client/wrangler.jsonc` | 本番 Cloudflare Workers の環境変数（`vars`）。環境別は `env.staging` / `env.production` |
| `apps/client/.dev.vars` | ローカル開発時に Workers ランタイムへ渡す変数（`.env` への symlink、`.gitignore` 済み） |

### turbo.json に env を追加する理由

Turborepo はタスクの実行結果をキャッシュする際、`env` で宣言した環境変数の値をキャッシュキーに含めます。環境変数が変わることでビルド結果が変わる場合（例: `DATABASE_URL` は本番では別の値）、該当タスクの `env` に追加する必要があります。

---

## 本番環境への反映

### 非機密の固定値（vars）

`apps/client/wrangler.jsonc` の `vars` に追加します（環境別は `env.staging` / `env.production` 配下）。

```jsonc
{
  "env": {
    "production": {
      "vars": { "MY_VAR": "fixed-value" }
    }
  }
}
```

### 機密情報（Workers Secrets）

パスワードや API キーなどの Worker への受け渡しは Alchemy（`alchemy.run.ts` の
`alchemy.secret()`）が担います。値は GitHub Environment Secrets → deploy.yml →
alchemy.run.ts の経路で渡り、`wrangler secret put` の手動実行は不要です。

ローカル開発では `.dev.vars`（`.env` への symlink）から同じ変数が Workers ランタイムに渡ります。

---

## CI/CD への反映

### CI（`.github/workflows/ci.yml`）

各ジョブの `env` で環境変数を設定します。主なジョブ:

- **ci**: `DATABASE_URL`（ダミー値）、`CI`
- **e2e-tests**: `DATABASE_URL`, `TEST_DATABASE_URL`, `CI`
- **api-service-integration-tests**: `DATABASE_URL`, `CI`

新しい環境変数がテストやビルドに必要なら、該当ジョブの `env` に追加してください。

### デプロイ（`.github/workflows/deploy.yml`）

デプロイは Alchemy（`alchemy.run.ts`）で行い、Cloudflare / PlanetScale / Alchemy / アプリの各シークレットを GitHub Environment Secrets から渡します（一覧は [デプロイガイド](../deploy/cloudflare-workers.md) 参照）。マイグレーション用の `DATABASE_URL` は provision フェーズの Alchemy が生成して後続 step に渡すため、手動設定は不要です。アプリの環境変数・シークレットは `alchemy.run.ts` の `bindings` が担います。

---

## 設計原則

### process.env 直参照の禁止

- **features 配下**: `process.env` の直参照は禁止。`config.ts` 経由で `loadConfig()` の戻り値を受け取る。
- **integrations 層**: 外部 SDK のラッパーは `process.env` を参照せず、呼び出し元からパラメータで受け取る。

詳細は `.cursor/rules/clean-architecture.mdc` を参照してください。

### 検証

- `bun run arch:guards` で features 内の `process.env` 直参照を検出できます。
- api-service の `config.ts` は起動時に Zod で検証し、失敗時は `process.exit(1)` します。

---

## 参照

- [開発ガイド - 環境変数](development.md#環境変数) - 開発環境の概要
- [README - 環境変数](../../README.md#環境変数) - クイックスタート向け
- [Cloudflare Workers デプロイガイド](../deploy/cloudflare-workers.md) - デプロイ時の環境変数
