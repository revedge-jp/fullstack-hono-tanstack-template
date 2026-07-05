# Cloudflare Workers デプロイガイド

## 構成概要

```
Browser
  └─ Cloudflare Workers ({{APP_NAME}}-staging / {{APP_NAME}})
       ├─ /api/*     → Hono (api-service)
       │                └─ Hyperdrive → PlanetScale (PostgreSQL)
       └─ /*         → TanStack Start SSR
            └─ Static Assets (dist/client)
```

デプロイは **Alchemy**（`alchemy.run.ts`）が担う。PlanetScale の DB / Role、Cloudflare の
Hyperdrive / Worker を IaC として作成・reconcile するため、**DB やHyperdrive をダッシュボードで
手動作成する工程はない**。仕組みの詳細は [Alchemy IaC ガイド](../dev/alchemy-iac.md)、
接続設定の背景は [ADR-002](../architecture/adr-002-hyperdrive-config.md) を参照。

`.github/workflows/deploy.yml` が main への push で staging、`v*.*.*` タグで production に
自動デプロイする。マイグレーション順序を守るため 2 段実行になっている:

```
① alchemy deploy（SKIP_WORKER=1）  # DB / Role / Hyperdrive を provision
② drizzle-kit migrate              # 新コードが動く前にスキーマを揃える
③ alchemy deploy                   # Worker をデプロイ
④ smoke check                      # 失敗したら wrangler rollback で自動巻き戻し
```

## 前提

- Cloudflare アカウント（Workers 編集権限の API トークン）
- PlanetScale 組織 + サービストークン（Organization settings → Service tokens で発行。DB 作成権限付き）
- Google Cloud Console での OAuth クライアント設定

---

## 初回セットアップ

### 1. Google OAuth の設定

Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client:
- Authorized JavaScript origins: `https://{{APP_NAME}}-staging.[account].workers.dev`
- Authorized redirect URIs: `https://{{APP_NAME}}-staging.[account].workers.dev/api/auth/callback/google`

### 2. GitHub Environments の設定

Settings > Environments で `staging` / `production` を作成し、それぞれに以下を設定する。

**Secrets**:

| Secret | 用途 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Hyperdrive / Worker の作成・デプロイ（Workers 編集権限が必要） |
| `CLOUDFLARE_ACCOUNT_ID` | 同上 |
| `PLANETSCALE_SERVICE_TOKEN_ID` | PlanetScale DB / Role の作成 |
| `PLANETSCALE_SERVICE_TOKEN` | 同上 |
| `ALCHEMY_PASSWORD` | Alchemy state 内 secrets の暗号化パスワード（任意の強い文字列） |
| `ALCHEMY_STATE_TOKEN` | Alchemy state store（CF 上の Durable Object）の認証トークン（任意の強い文字列。**全環境・ローカルで同一の値**にすること） |
| `BETTER_AUTH_SECRET` | Better Auth のセッション署名鍵（`openssl rand -base64 32`） |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |

**Variables**:

| Variable | 用途 |
|---|---|
| `APP_NAME` | Worker / Hyperdrive / DB の命名ベース（init-template.sh のアプリ名と同じ値） |
| `PLANETSCALE_ORGANIZATION` | PlanetScale の組織名 |
| `APP_ORIGIN` または `WORKERS_SUBDOMAIN` | 公開 URL（`BETTER_AUTH_URL` / `CORS_ORIGIN` に使用）。`WORKERS_SUBDOMAIN` 指定時は `https://{worker名}.{subdomain}.workers.dev` を自動組み立て |
| `SMOKE_BASE_URL` | デプロイ直後の smoke チェック先 URL。`/api/health`（Hyperdrive 経由の DB 疎通）と `/`（SSR）を検証し、失敗するとデプロイジョブが赤になる。**未設定の場合 smoke チェックは skip される**（notice が出るだけでジョブは成功扱い） |

```bash
# gh CLI で設定する場合（staging の例）
gh secret set CLOUDFLARE_API_TOKEN --env staging
gh secret set CLOUDFLARE_ACCOUNT_ID --env staging
gh secret set PLANETSCALE_SERVICE_TOKEN_ID --env staging
gh secret set PLANETSCALE_SERVICE_TOKEN --env staging
gh secret set ALCHEMY_PASSWORD --env staging
gh secret set ALCHEMY_STATE_TOKEN --env staging
gh secret set BETTER_AUTH_SECRET --env staging
gh secret set GOOGLE_CLIENT_ID --env staging
gh secret set GOOGLE_CLIENT_SECRET --env staging
gh variable set APP_NAME --env staging --body "<app-name>"
gh variable set PLANETSCALE_ORGANIZATION --env staging --body "<org>"
gh variable set WORKERS_SUBDOMAIN --env staging --body "<account-subdomain>"
gh variable set SMOKE_BASE_URL --env staging --body "https://<app>-staging.<account>.workers.dev"
```

secrets / vars が未設定のうちは deploy job は notice を出して skip する（テンプレート原本や
セットアップ途中のリポジトリが赤くならないため）。

### 3. 初回デプロイ

main に push するだけでよい（DB がなければ Alchemy が作る）。手動でやる場合:

```bash
# .env に Infra セクション（.env.example 参照）を設定した上で
bun run infra:deploy:staging
```

### 4. preview ラベルの作成（PR プレビュー環境を使う場合）

```bash
gh label create preview --color 1D76DB --description "この PR に使い捨てプレビュー環境を立てる"
```

---

## PR プレビュー環境（opt-in）

`.github/workflows/preview.yml` が、**`preview` ラベルを付けた PR にだけ**使い捨ての
プレビュー環境を立てる:

| 操作 | 動作 |
|---|---|
| `preview` ラベルを付ける | Worker（`{APP_NAME}-pr-N.workers.dev`）+ DB（staging DB のブランチ、空の状態から migration 適用）を作成し、PR に URL をコメント |
| ラベル付きのまま push | 再デプロイ（DB ブランチは使い回し、migration は差分適用） |
| ラベルを外す / PR クローズ・マージ | 環境を丸ごと削除（DB ブランチも消える） |
| 7日間更新なしで放置 | `preview-cleanup.yml` が自動削除しラベルを外す（毎日 06:00 JST） |

**コスト**: DB ブランチ（PS-DEV）は存在している時間の按分課金（$5/月相当）。オートスリープは
ないため「ラベルを付けている間だけ課金」と理解すること。レビューが数日で終わる PR なら数十円。

**注意**:
- DB は**空**（本番・staging のデータは複製されない）。デモデータが必要なら seed を流すこと
- fork からの PR では動かない（GitHub の仕様で secrets が渡らない）。同一リポジトリのブランチ専用
- ビルドは PR のコードを secrets が見える環境で実行するため、**信頼できる PR にだけラベルを付ける**こと
- staging DB が存在していることが前提（プレビューの DB はそのブランチとして作られる）

---

## アーキテクチャ上の注意点

### CF Workers + Static Assets でのサブリクエスト制約

Worker 内から同一 origin への `fetch()` は、Worker の fetch ハンドラーを経由せず Asset ハンドラーに吸われる。
そのため、SSR 中のセッション検証で HTTP ループバックは使えない。

この問題と解決策の詳細は [ADR-001](../architecture/adr-001-cf-workers-session-check.md) を参照。

### per-request DB クライアント

Hyperdrive の要件により、postgres.js クライアントはリクエストごとに生成し、レスポンス送信後に `ctx.waitUntil(end())` でドレインする。

### Better Auth のバックグラウンドタスク

OAuth コールバック後に Better Auth が未 await のバックグラウンドタスク（verification token 削除等）を実行することがある。これらは `cleanup()` でキャンセルされ unhandled rejection として記録されるが、セッション作成自体はレスポンス前に完了するため認証フローに影響しない。

---

## トラブルシュート

### ログインができない（session check で 401）

→ PlanetScale ダッシュボード（Console タブ）で `auth_sessions` テーブルにレコードが作成されているか確認。
ある場合は Hyperdrive のキャッシュが原因の可能性。Cloudflare ダッシュボードで Hyperdrive のキャッシュを一時的に無効化して確認。

### `Timed out while waiting for a message from another Hyperdrive node`

→ Hyperdrive の origin がプーラー（PlanetScale の pooled 接続 port 6432 等）になっている。直接続 (port 5432) に変更すること（ADR-002）。
Alchemy 管理下では構造的に直接続になるため、手動で Hyperdrive を触った場合のみ起こりうる。

### `/api/*` が 404

→ ビルドが古い可能性。`bun run build` を再実行してデプロイ。

### `BETTER_AUTH_SECRET` の生成

```bash
openssl rand -base64 32
```

---

## 運用（ロールバック・マイグレーション規律・通知・レート制限）

デプロイ後の運用ルールは [運用ガイド](./operations.md) を参照。
