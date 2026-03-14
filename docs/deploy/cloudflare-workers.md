# Cloudflare Workers デプロイガイド

## 構成概要

```
Browser
  └─ Cloudflare Workers (meetform-staging / meetform-prod)
       ├─ /api/*     → Hono (api-service)
       │                └─ Hyperdrive → Supabase (PostgreSQL)
       └─ /*         → TanStack Start SSR
            └─ Static Assets (dist/client)
```

## 前提

- Cloudflare アカウント・ダッシュボードへのアクセス権
- Supabase プロジェクト（PostgreSQL）
- Google Cloud Console でのOAuth クライアント設定

---

## 初回セットアップ

### 1. Supabase の準備

1. Supabase ダッシュボードでプロジェクトを作成
2. **Session Pooler の接続文字列を使用する**（Transaction Pooler は使わない）
   - `Project Settings → Database → Connection pooling`
   - Mode: **Session** / Port: **5432**
   - `postgresql://postgres.[ref]:[password]@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres`
3. DB マイグレーションを実行:
   ```bash
   DATABASE_URL="<supabase-session-pooler-url>" bun run db:migrate
   ```

> **重要**: Transaction Pooler (port 6543) を Hyperdrive と組み合わせると、Hyperdrive 内部ノード間の調整エラーが発生する。必ず Session Pooler (port 5432) を使用すること。
> 詳細は [ADR-002](../architecture/adr-002-hyperdrive-config.md) を参照。

### 2. Cloudflare Hyperdrive の設定

1. Cloudflare ダッシュボード → **Workers & Pages → Hyperdrive → Create**
2. 接続設定:
   - Host: `aws-1-ap-northeast-1.pooler.supabase.com`
   - Port: `5432`（Session Mode）
   - Database: `postgres`
   - User: `postgres.[your-ref]`
   - Password: Supabase のパスワード
3. 作成後、`wrangler.jsonc` の `hyperdrive.id` に Hyperdrive の ID を設定

### 3. Google OAuth の設定

Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client:
- Authorized JavaScript origins: `https://meetform-staging.[account].workers.dev`
- Authorized redirect URIs: `https://meetform-staging.[account].workers.dev/api/auth/callback/google`

### 4. Cloudflare Workers Secrets の設定

```bash
cd apps/client

# 必須シークレット
bunx wrangler secret put BETTER_AUTH_SECRET --env staging  # ランダムな文字列
bunx wrangler secret put GOOGLE_CLIENT_ID --env staging
bunx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
bunx wrangler secret put DATABASE_URL --env staging        # Hyperdrive binding がない場合のフォールバック用
```

### 5. `wrangler.jsonc` の設定

```jsonc
{
  "name": "meetform",
  "compatibility_date": "2025-01-01",
  "compatibility_flags": ["nodejs_compat_v2"],
  "main": "dist/server/server.js",
  "assets": {
    "directory": "dist/client"
  },
  "env": {
    "staging": {
      "name": "meetform-staging",
      "vars": {
        "NODE_ENV": "production",
        "CORS_ORIGIN": "https://meetform-staging.[account].workers.dev",
        "BETTER_AUTH_URL": "https://meetform-staging.[account].workers.dev"
      },
      "hyperdrive": [
        {
          "binding": "HYPERDRIVE",
          "id": "<hyperdrive-id>"
        }
      ]
    }
  }
}
```

---

## デプロイ手順

```bash
# 1. ビルド
bun run build

# 2. staging デプロイ
cd apps/client
bunx wrangler deploy --env staging

# 3. 動作確認
# ブラウザで https://meetform-staging.[account].workers.dev にアクセス
```

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

→ Supabase ダッシュボードで `auth_sessions` テーブルにレコードが作成されているか確認。
ある場合は Hyperdrive のキャッシュが原因の可能性。Cloudflare ダッシュボードで Hyperdrive のキャッシュを一時的に無効化して確認。

### `Timed out while waiting for a message from another Hyperdrive node`

→ Hyperdrive が Transaction Mode (port 6543) に接続している。Session Mode (port 5432) に変更すること。

### `/api/*` が 404

→ ビルドが古い可能性。`bun run build` を再実行してデプロイ。

### `BETTER_AUTH_SECRET` の生成

```bash
openssl rand -base64 32
```
