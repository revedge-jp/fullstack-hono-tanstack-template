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
| `API_BASE_URL` | API サーバーのベース URL | `http://localhost:8080` |

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
5. **本番環境**: `infra/terraform` の `server_env` 経由で渡す。Secret が必要な場合は Secret Manager を利用
6. **ドキュメント**: 本ファイルの一覧と `README.md` の環境変数セクションを更新する

### client に環境変数を追加する場合

1. **`.env.example`** にサンプル値を追加する
2. **参照箇所**を実装する（例: `apps/client/shared/lib/api.ts`）。現状バリデーションはないが、フォールバックを適切に設定する
3. **`NEXT_PUBLIC_` prefix**: クライアント（ブラウザ）に露出する変数は `NEXT_PUBLIC_` を付与する。機密情報は絶対に含めない
4. **turbo.json**: client の build で使用する場合は `env` に追加する
5. **CI**: E2E 等で必要なら `.github/workflows/ci.yml` の `e2e-tests` ジョブの `env` に追加する
6. **本番環境**: `client_env` 経由で Terraform に渡す。または `cloud-run.tf` に固定の `env` ブロックを追加する
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
| `infra/terraform/cloud-run.tf` | 本番 Cloud Run の環境変数。固定値は `env` ブロック、動的値は `server_env` / `client_env` |
| `infra/terraform/variables.tf` | `server_env` / `client_env` の変数定義。デプロイ時に `-var` で渡す |

### turbo.json に env を追加する理由

Turborepo はタスクの実行結果をキャッシュする際、`env` で宣言した環境変数の値をキャッシュキーに含めます。環境変数が変わることでビルド結果が変わる場合（例: `DATABASE_URL` は Prisma のスキーマ生成に影響しないが、本番では別の値）、該当タスクの `env` に追加する必要があります。

---

## 本番環境への反映

### 固定値

`infra/terraform/cloud-run.tf` の `env` ブロックに直接追加します。

```hcl
env {
  name  = "MY_VAR"
  value = "fixed-value"
}
```

### 動的値・オーバーライド（server_env / client_env）

`variables.tf` の `server_env` / `client_env` は map 型で、デプロイ時に `-var` で渡します。

- **Server**: `server_env` に `KEY=value` 形式で追加
- **Client**: `client_env` に `KEY=value` 形式で追加

デプロイスクリプト（`scripts/ci-cd/deploy-steps.sh`）や `.github/workflows/_deploy.yml` では、次の形式で渡します:

```bash
-var="server_env={MY_KEY=\"my-value\",BUILD_SHA=\"${COMMIT_SHA}\"}"
```

### 機密情報（Secret Manager）

パスワードや API キーなどは Secret Manager に登録し、`cloud-run.tf` の `value_source` で参照します。

```hcl
env {
  name = "SECRET_VAR"
  value_source {
    secret_key_ref {
      secret  = google_secret_manager_secret.my_secret.name
      version = "latest"
    }
  }
}
```

---

## CI/CD への反映

### CI（`.github/workflows/ci.yml`）

各ジョブの `env` で環境変数を設定します。主なジョブ:

- **ci**: `DATABASE_URL`（Prisma 生成用ダミー）、`CI`
- **e2e-tests**: `DATABASE_URL`, `TEST_DATABASE_URL`, `CI`
- **api-service-integration-tests**: `DATABASE_URL`, `CI`

新しい環境変数がテストやビルドに必要なら、該当ジョブの `env` に追加してください。

### デプロイ（`.github/workflows/_deploy.yml`）

`server_env` / `client_env` は Terraform の `-var` で渡されます。デプロイワークフローで新しい変数を渡す場合は、`scripts/ci-cd/deploy-steps.sh` や `.github/workflows/_deploy.yml` の該当箇所を更新します。

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
- [README - 環境変数](../README.md#環境変数) - クイックスタート向け
- [認証ガイド](authentication.md) - Firebase 等の認証関連環境変数
- [デプロイガイド](../deploy/deployment.md) - デプロイ時の環境変数（`PROJECT_ID`, `REGION` 等）
