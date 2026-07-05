# ADR-001: CF Workers + Static Assets での SSR からの api-service 呼び出し

**ステータス**: 採用済み
**日付**: 2026-03-14（2026-07-05 改訂: checker/container 直呼びから in-process RPC クライアント注入に変更）

---

## 背景

このアプリは TanStack Start (SSR) + Cloudflare Workers + Cloudflare Static Assets で動作する。

SSR の `loader` / `createServerFn` は api-service の機能を必要とする。代表例:

- 認証ガード (`/_authenticated` レイアウトルート) の `loader` が `getSessionServerFn()` でセッションを検証する（Better Auth が DB にアクセス）
- `getTasksServerFn()` が初回表示用のタスク一覧を取得する

---

## 問題

**CF Workers + Static Assets 環境では、Worker 内から同一 origin への `fetch()` が Worker の fetch ハンドラーを通らない。**

```
getSessionServerFn
  └─ fetch("https://same-origin/api/me")   // ← 期待動作
       ↓
  CF の Asset ハンドラーに吸われる         // ← 実際の動作（/api/me は静的ファイルでない → 404）
```

`createServerFn` (TanStack Start) はサーバー関数にプラットフォーム固有の binding（CF の `env`）を一切露出しないため、`auth` インスタンスや DB クライアントをサーバー関数内で直接生成することもできない。

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

### C. `AsyncLocalStorage` で container / session checker を直接スレッドする（旧採用案）

`server.ts` で初期化した `auth` の checker 関数と api-service の `container` を
`AsyncLocalStorage` で serverFn に渡し、アプリケーション層を直接呼ぶ。

- ✅ HTTP ラウンドトリップなし・オーバーヘッド最小
- ❌ **アプリケーション層への入口が2本になる**: presentation 層（認証ミドルウェア・
  zValidator・アクセスログ）をバイパスするため、serverFn 側で認可チェック等を
  手書きで再現する義務が feature ごとに発生する
- ❌ client が api-service の container 型に結合する

### D. `AsyncLocalStorage` で in-process Hono RPC クライアントをスレッドする（採用）

`server.ts` の fetch ハンドラーで構築した Hono アプリの `app.request`（インプロセスの
関数呼び出し。ネットワークに出ないため Static Assets の制約に触れない）を fetch として
束ねた `hc<AppType>` クライアントを `AsyncLocalStorage` で serverFn に注入する。

```
server.ts (fetch handler)
  ├─ initHonoApp(env) → { app, end }
  └─ runWithApiClient(createInProcessApiClient(app), () => handler(request))
       └─ getTasksServerFn()
            └─ getApiClient(request).api.tasks.$get(...)  // ← HTTP 境界を通るが、ネットワークには出ない
```

- ✅ HTTP ラウンドトリップなし（`app.request` は同一 isolate 内の関数呼び出し）
- ✅ **SSR 経路もブラウザ経路と同じ presentation 層を通る**: 認証ミドルウェア・
  バリデータ・アクセスログが一元化され、入口が1本になる
- ✅ Hono RPC の型（`AppType`）がそのまま効く。client と api-service の結合は
  RPC 契約のみ
- ✅ テストヘルパー（`createFakeApp` + `hc` with `app.request`）と同じ確立された
  パターン
- ✅ `AsyncLocalStorage` は CF Workers (`nodejs_compat_v2`) で正式サポート
- ✅ ALS 未設定の環境（素の vite / node 実行）では同一オリジン HTTP ループバックに
  フォールバック（`getApiClient` が吸収し、serverFn のコードは1経路のまま）
- ⚠️ Request/Response の生成と JSON シリアライズのコストが乗るが、SSR read 1回あたり
  マイクロ秒〜ミリ秒オーダーで実害なし

---

## 採用した設計

### データフロー（CF Workers 本番）

```
Browser → CF Worker (server.ts)
  initHonoApp(env)                        # per-request: Hono アプリ + DB 接続を初期化
  runWithApiClient(
    createInProcessApiClient(app),        # hc<AppType> + app.request を ALS にスレッド
    () => handler(request))
      → /_authenticated loader
          → getSessionServerFn()
              → getApiClient(request)     # AsyncLocalStorage から取得
              → .api.me.$get({ cookie })  # app.request 直呼び（ネットワークなし）
                  → requestLogger / requireAuth 等の middleware を通過
                  → auth feature の usecase
```

### データフロー（フォールバック: server.ts を経由しない実行環境）

```
Browser → TanStack Start dev server
  getSessionServerFn()
    → getApiClient(request)              # ALS 未設定 → hc<AppType>(origin) を生成
    → .api.me.$get({ cookie })           # HTTP ループバック
        → /api/$ ルート → getHonoApp().fetch()
```

### ファイル構成

```
apps/client/
  app/server.ts                      # in-process クライアントを構築・スレッド
  shared/lib/api-client.ts           # AsyncLocalStorage + hc クライアント生成
  features/auth/queries/get-session.ts   # getApiClient() 経由で /api/me
  features/tasks/queries/get-tasks.ts    # getApiClient() 経由で /api/tasks
apps/api-service/src/app.ts          # createApp が AppType（RPC 契約）を export
```

---

## トレードオフ・注意点

- `nodejs_compat_v2` フラグが必要（`async_hooks` のため）。これは Hyperdrive 使用にも必要なので追加コストはない。
- SSR からの呼び出しも api-service のアクセスログに記録される（method/path/status）。
  1画面の SSR で複数 serverFn が走るとログ行数はその分増える。
- mutation は従来どおりブラウザから同一オリジンの API を直接呼ぶ（cookie 自動同送・
  1ホップ・SSR 先読み不要のため）。この ADR は SSR read 経路のみを対象とする。
- Hyperdrive 接続は outer request の `initHonoApp` が作ったものを serverFn も共有する。
  `/api/*` 直アクセスのリクエストとは別接続になる（それぞれ `initHonoApp` が呼ばれる）が、
  これは正しい動作。

---

## 関連

- [Cloudflare Workers Static Assets ルーティング](https://developers.cloudflare.com/workers/static-assets/)
- [ADR-002: Hyperdrive 接続設定](./adr-002-hyperdrive-config.md)
