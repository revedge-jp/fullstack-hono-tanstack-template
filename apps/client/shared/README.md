フロントの共有レイヤ。feature に依存しない横断関心を `lib/` に置く（`shared` から `features` は import しない）。
UI 部品は `shared/` ではなく `apps/client/components/` に置く。

## lib/

- API クライアント（使い分けは `apps/client/AGENTS.md` の「Hono RPC」）
  - `browser-api-client.ts`: ブラウザから同一オリジン `/api/*` を呼ぶ共有インスタンス `browserApiClient`
  - `api-client.ts`: SSR（`createServerFn`）用。`getApiClient()` が AsyncLocalStorage で注入されたインプロセス
    Hono RPC クライアントを返す
  - `hono-app.ts`: Worker の env から api-service のアプリを組み立てる（`app/server.ts` が使う）
- `ssr-auth.ts`: SSR で 401/403 を「未認証・判定不能」として扱う述語 `isSsrAuthIndeterminate`
- `action-error.ts`: actions の結果を `toActionResult` で画面向けの文言に変換する
- `auth-client.ts`: Better Auth のクライアント
- `server-logger.ts`: SSR 経路用のロガー（pino を引き込むのでブラウザから import しない）
- `report-client-error.ts` / `app-version.ts`: ブラウザのエラー通報・デプロイ後の古いタブ検知
- `utils.ts`: `cn()`（クラス名の合成）
