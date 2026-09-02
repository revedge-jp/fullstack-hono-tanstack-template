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

出典は `apps/api-service/src/config.ts`（Zod で起動時に検証）と `.env.example`。
`.env.example` はいずれもダミー値で埋めてあるため、`cp .env.example .env` で dev サーバーは起動する。

### 必須（`config.ts` が `min(1)` で要求。未設定だと起動失敗）

| 変数名 | 説明 | 例 |
|--------|------|-----|
| `DATABASE_URL` | 本番/開発用データベース接続 URL | `postgresql://postgres:postgres@localhost:5432/app_db` |
| `BETTER_AUTH_SECRET` | Better Auth のセッション署名鍵（本番はランダムな強い値） | `your-secret-here`（ダミー可） |
| `GOOGLE_CLIENT_ID` | Google OAuth クライアント ID | `your-google-client-id`（ダミー可） |
| `GOOGLE_CLIENT_SECRET` | Google OAuth クライアントシークレット | `your-google-client-secret`（ダミー可） |

> 認証系の 3 変数はダミー値でもバリデーションを通過し dev サーバーは起動する。開発時は
> 「Dev サインイン」ボタン（`/api/dev/login`、`import.meta.env.DEV` 時のみ表示）で Google を
> 介さずログインできる。実際の Google サインインを使うときのみ本物の OAuth 値を設定する。

`TEST_DATABASE_URL`（`postgresql://postgres:postgres@localhost:5433/app_db`）は `config.ts` の
必須スキーマ対象ではないが、テスト実行時に必要。

### Server（api-service）

| 変数名 | 説明 | 既定値 |
|--------|------|--------|
| `NODE_ENV` | 環境（development/test/production）。既定は production（fail-closed）。ローカル開発は `.env` で `NODE_ENV=development` を明示する | `production` |
| `API_PORT` | API サーバーのポート（`PORT` も後方互換で受理） | `8080` |
| `CORS_ORIGIN` | CORS 許可オリジン | 本番必須。開発/テスト時は未設定時 `http://localhost:3000` |
| `LOG_PRETTY` | ログ整形出力（`true` で有効化） | （未設定） |
| `LOG_LEVEL` | ログレベル（fatal/error/warn/info/debug/trace/silent） | 未設定時は環境別デフォルト（開発: debug、本番: info） |
| `BETTER_AUTH_URL` | Better Auth のベース URL | （未設定） |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Better Auth の信頼オリジン（カンマ区切り） | （空） |

### Client（apps/client）

| 変数名 | 説明 | 既定値 |
|--------|------|--------|
| `CLIENT_PORT` | client（Vite）のポート | `3000` |
| `API_BASE_URL` | API サーバーの URL（SSR は ADR-001 のインプロセス呼び出しを使うため主に worktree 用） | `http://localhost:8080` |

### Docker / インフラ

| 変数名 | 説明 | 既定値 |
|--------|------|--------|
| `POSTGRES_CONTAINER_NAME` | Postgres コンテナ名 | `app_postgres` |
| `POSTGRES_TEST_CONTAINER_NAME` | テスト用 Postgres コンテナ名 | `app_postgres_test` |
| `PGADMIN_CONTAINER_NAME` | pgAdmin コンテナ名 | `app_pgadmin` |
| `POSTGRES_VOLUME_NAME` | Postgres データボリューム名 | `app-postgres-data` |
| `PGADMIN_VOLUME_NAME` | pgAdmin データボリューム名 | `app-pgadmin-data` |
| `DATABASE_PORT` | Postgres ポート | `5432` |
| `TEST_DATABASE_PORT` | テスト用 Postgres ポート | `5433` |

> テスト用 Postgres（`postgres-test`）は使い捨てで named volume を持たないため、
> `POSTGRES_TEST_VOLUME_NAME` は使用しない。`SERVER_PUBLIC_URL` は `scripts/worktree.sh` が
> worktree 用 `.env` に書き込むだけで、アプリ本体（`config.ts`）は参照しない残置変数。

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
5. **本番環境**: `alchemy.run.ts` の Worker `bindings` に追加する（非機密は文字列、機密は `alchemy.secret(requireEnv("XXX"))`）。値は `.github/workflows/deploy.yml` が GitHub Environments の Secrets / Variables から渡す
6. **ドキュメント**: 本ファイルの一覧と `README.md` の環境変数セクションを更新する

### client に環境変数を追加する場合

client には独自の設定読み込みが無い。client と api-service は同一 Worker にビルドされ、SSR /
`createServerFn` の実行時は api-service の `loadConfig(env)` が読んだ値をそのまま使える。

1. **サーバー側で使う値**（SSR・serverFn・in-process API 呼び出し）: 上の「api-service に環境変数を追加する場合」の手順どおり `apps/api-service/src/config.ts` に足す。client 側で `process.env` を読まない
2. **ブラウザに出す値**: 実行環境ごとに変わる値は route の `loader`（サーバー側）から返す。build 時定数として焼き込んでよい非機密の値だけ `VITE_` 接頭辞で `.env.example` に追加し、`import.meta.env.VITE_XXX` で参照する（現状は `import.meta.env.DEV` のみ）。機密は絶対に含めない
3. **turbo.json**: `VITE_` 変数は client の build のキャッシュキーに影響するため `build` タスクの `env` に追加する
4. **CI**: E2E 等で必要なら `.github/workflows/ci.yml` の `e2e-tests` ジョブの `env` に追加する
5. **本番環境**: staging / production は `alchemy.run.ts` の Worker `bindings`（非機密は文字列、機密は `alchemy.secret(...)`）。`apps/client/wrangler.jsonc` の `vars` はローカル `wrangler dev` 用
6. **ドキュメント**: 本ファイルの一覧と `README.md` を更新する

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
| `alchemy.run.ts` | staging / production の Worker `bindings`（非機密の vars と `alchemy.secret` の機密）。デプロイ時の正典 |
| `apps/client/wrangler.jsonc` | ローカル `wrangler dev` 用の Worker 設定（`vars` もローカル専用。`env.*` セクションは持たない） |
| `apps/client/.dev.vars` | ローカル開発時に Workers ランタイムへ渡す変数（`.env` への symlink、`.gitignore` 済み） |

### turbo.json に env を追加する理由

Turborepo はタスクの実行結果をキャッシュする際、`env` で宣言した環境変数の値をキャッシュキーに含めます。環境変数が変わることでビルド結果が変わる場合（例: `DATABASE_URL` は本番では別の値）、該当タスクの `env` に追加する必要があります。

---

## 本番環境への反映

### 非機密の固定値（vars）

`alchemy.run.ts` の Worker `bindings` に追加します。ステージで値を変えるなら `stage` で分岐します。

```typescript
// alchemy.run.ts
bindings: {
  MY_VAR: stage === "production" ? "fixed-value" : "staging-value",
  MY_SECRET: alchemy.secret(requireEnv("MY_SECRET")), // 機密は secret で包む
},
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

詳細は `AGENTS.md` と `.claude/rules/api-service.md` を参照してください。

### 検証

- `bun run arch:guards` で features 内の `process.env` 直参照を検出できます。
- api-service の `config.ts` は起動時に Zod で検証し、失敗時は `process.exit(1)` します。

---

## 参照

- [開発ガイド - 環境変数](development.md#環境変数) - 開発環境の概要
- [README - 環境変数](../../README.md#環境変数) - クイックスタート向け
- [Cloudflare Workers デプロイガイド](../deploy/cloudflare-workers.md) - デプロイ時の環境変数
