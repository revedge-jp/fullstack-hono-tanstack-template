# ADR-001: CF Workers + Static Assets でのセッション検証方法

**ステータス**: 採用済み
**日付**: 2026-03-14

---

## 背景

meetform は TanStack Start (SSR) + Cloudflare Workers + Cloudflare Static Assets で動作する。

認証ガード (`/_authenticated` レイアウトルート) の `loader` は `getSessionServerFn()` というサーバー関数を呼び出し、セッションが有効かどうかを確認する。

セッション検証には Better Auth の `auth.api.getSession()` が必要で、これは DB（Hyperdrive 経由 Supabase）にアクセスする。

---

## 問題

**CF Workers + Static Assets 環境では、Worker 内から同一 origin への `fetch()` が Worker の fetch ハンドラーを通らない。**

```
getSessionServerFn
  └─ fetch("https://same-origin/api/me")   // ← 期待動作
       ↓
  CF の Asset ハンドラーに吸われる         // ← 実際の動作（/api/me は静的ファイルでない → 404）
```

`createServerFn` (TanStack Start) はサーバー関数にプラットフォーム固有の binding（CF の `env`）を一切露出しないため、`auth` インスタンスをサーバー関数内で直接生成することもできない。

---

## 検討した選択肢

### A. HTTP ループバック（採用しなかった）

```typescript
const res = await fetch(`${origin}/api/me`, { headers: { cookie } });
```

- ❌ CF Workers + Static Assets では `/api/me` が Asset ハンドラーに吸われて 404 になる
- ✅ ローカル開発では動作する（TanStack Start dev server が `/api/$` 経由でルーティング）

### B. Cloudflare Service Binding (self-referencing)

Worker 自身への Service Binding を設定し、内部 RPC として呼び出す。

- ✅ 正攻法
- ❌ wrangler.jsonc に自己参照 binding の設定が必要でデプロイが複雑になる
- ❌ ローカル開発での動作確認が難しい

### C. `AsyncLocalStorage` で CheckSessionFn をスレッドする（採用）

`server.ts` の fetch ハンドラーで初期化した `auth` インスタンスを使って session checker 関数を作り、`AsyncLocalStorage` 経由で TanStack Start のハンドラー全体に伝播させる。

```
server.ts (fetch handler)
  ├─ initHonoApp(env) → { app, end, auth }
  ├─ checkSession = (headers) => auth.api.getSession({ headers })
  └─ runWithSessionChecker(checkSession, () => handler(request, ctx))
       └─ getSessionServerFn()
            └─ getSessionChecker()(request.headers)  // ← DB アクセスなし、auth 直呼び
```

- ✅ HTTP ラウンドトリップなし
- ✅ `auth` インスタンスは `server.ts` で作られたものをそのまま使うため、Hyperdrive 接続も共有
- ✅ `AsyncLocalStorage` は CF Workers (`nodejs_compat_v2`) で正式サポート
- ✅ ローカル開発では checker が undefined → HTTP ループバックにフォールバック
- ✅ Next.js・Nuxt 等が同じパターンを内部実装で使用しており実績がある

---

## 採用した設計

### データフロー（CF Workers 本番）

```
Browser → CF Worker (server.ts)
  initHonoApp(env)                     # per-request: auth + DB 接続を初期化
  checkSession = (headers) =>
    auth.api.getSession({ headers })   # Better Auth が auth_sessions を SELECT
  runWithSessionChecker(checkSession,
    () => handler(request))            # AsyncLocalStorage にスレッド
      → /_authenticated loader
          → getSessionServerFn()
              → getSessionChecker()   # AsyncLocalStorage から取得
              → checkSession(headers) # 直接呼び出し（HTTP なし）
```

### データフロー（ローカル開発）

```
Browser → TanStack Start dev server
  getSessionServerFn()
    → getSessionChecker() === undefined  # AsyncLocalStorage 未設定
    → fetch(`${origin}/api/me`, { cookie })  # HTTP ループバック
        → /api/$ ルート → getHonoApp().fetch()
```

### ファイル構成

```
apps/client/
  app/server.ts                      # checkSession を構築・スレッド
  shared/lib/app-context.ts          # AsyncLocalStorage + 型定義
  features/auth/queries/get-session.ts  # checker 呼び出し / HTTP フォールバック
apps/api-service/src/app.ts          # createApp が auth を return に含む
```

---

## トレードオフ・注意点

- `nodejs_compat_v2` フラグが必要（`async_hooks` のため）。これは Hyperdrive 使用にも必要なので追加コストはない。
- `server.ts` と `getSessionServerFn` が `app-context.ts` の契約（`CheckSessionFn` 型）を通じて結合する。インターフェースは意図的に最小化している。
- Hyperdrive 接続（`auth` が使う DB クライアント）は outer request のものを共有する。`/api/*` ルートの Hono リクエストとは別接続になる（それぞれ `initHonoApp` が呼ばれる）が、これは正しい動作。

---

## 関連

- [Cloudflare Workers Static Assets ルーティング](https://developers.cloudflare.com/workers/static-assets/)
- [ADR-002: Hyperdrive 接続設定](./adr-002-hyperdrive-config.md)
