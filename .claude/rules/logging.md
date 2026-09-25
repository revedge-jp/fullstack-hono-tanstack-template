---
paths:
  - "apps/**/*.ts"
  - "apps/**/*.tsx"
  - "packages/**/*.ts"
---

# ログ出力（api-service / client 共通）

`apps/client` と `apps/api-service` は**同一の Cloudflare Worker**にビルドされ、ログは同じ
Observability データセットに入る。そのためこの規約は両方に等しく効く。

- **生の `console.*` は使わない**。
  - api-service: `c.get("logger")` / DI された `logger`
  - client のサーバー経路: `shared/lib/server-logger.ts` の `serverLogger`
  - **UI コンポーネントも対象**。SSR 時はサーバーで描画されるため、描画時の `console` は
    そのまま Workers ログに出る（「ブラウザで動くから対象外」は成り立たない）
- **third-party のロガーも同じ経路に寄せる**。console 出力するライブラリを入れるときは、
  差し替えフックが無いか最初に確認すること。既存の対応:
  - Better Auth: `logger` オプションに pino を委譲（`integrations/external/auth.ts` の
    `toBetterAuthLoggerOption`）。未設定だと DB 障害時に SQL 文とバインド値が
    `$metadata.error` に丸ごと載る
  - Better Auth のルーター（better-call）: APIError 以外の例外は `logger` と無関係に
    `console.error("# SERVER_ERROR: ", …)` で出す。`onAPIError: { throw: true }` で Hono の
    `onError` へ再送出している（同ファイルの `createAuth`）。外すと上と同じ漏れ方をする
  - Hono の `onError` の `err` は `stringifyErrorSafe` を通すので、DrizzleQueryError のメッセージに
    埋め込まれたバインド値（`\nparams: …`）は切り落とされる。redact はキー単位で文字列の中身に届かない。
    DB 障害の種別は `readCauseCode` で cause の `code` だけを `causeCode` に添える（cause.message は入力値を含みうる）
  - `auth.api.getSession` を直接呼ぶ経路（`features/auth/infrastructure/session.ts`）: Better Auth は DB 障害を
    内蔵ロガー（上の委譲先）で記録してから APIError(500) に包み直して投げる。受け側は `readAuthApiError` で
    `statusCode` / `bodyCode` 等の識別子だけを足し、Error 本体は上と同じく `stringifyErrorSafe` を通す
  - postgres.js: `onnotice` に pino を委譲（`packages/database/src/index.ts`）。
    未設定だと DB の NOTICE が素の `console.log` に出る
- **`error` / `err` キーは「5xx・未捕捉例外」専用**。Cloudflare はこの2つのキーの値を
  `$metadata.error` に取り込み、ダッシュボードの既定フィルタ `exists($metadata.error)` が
  それを「Errors」として数える。warn 以下（業務上の拒否、fail-open の失敗）でこのキーを使うと
  本物の異常が埋もれる。4xx の理由は `errorCode`、その他は `reason` / `detail` 等でよい。
- 安全網として `@repo/logging` が warn 以下のログの `error` / `err` を `failure` へ退避する。
  **`failure` はその退避先の予約キー**なので別の意味に使わない。Error オブジェクトは `err` に
  載せてよい（pino の既定シリアライザがスタックを直列化するのはこのキーだけで、退避後も形は保たれる）。
  **ただし DB 由来になりうる Error（DB を叩く処理・それを包むライブラリの reject）は生で渡さない**。
  DrizzleQueryError は message・stack・own プロパティ `params` にバインド値を持ち、シリアライザは
  そのすべてを出す。`err: stringifyErrorSafe(e)` と `causeCode: readCauseCode(e)`（`@repo/logging`）にする。
- **`err` 以外の位置（ネストしたキー・配列の中）に置いた Error は `{}` になる**（message も stack も消える）。
  そこに載せるなら `name` / `message` / `stack` を持つ平たいオブジェクトに置き換える
  （例: `toBetterAuthLoggerOption` の `betterAuthArgs`）。

## なぜ生の console を禁止するか（実測メモ）

使い捨て Worker を本番アカウントへ一時デプロイし、3レベル×14形状で実測した結果、
Cloudflare の `$metadata.error` の立ち方は**2つの別系統**になる。

- **pino 経由**（数値 `level` を含むオブジェクト）: `error` / `err` キーがあるときだけ立つ。
  `console.log/warn/error` のどれで出したかは無関係。副作用として `$metadata.level` は常に null。
- **生の console**（数値 `level` なし）: `console.error` は**何を渡しても**立つ（生文字列・複数引数・
  JSON文字列・Error インスタンス・`msg` だけのオブジェクト、すべてメッセージ全文が入る）。
  `console.warn` は `error`/`err` があっても立たない。`console.log` は `error`/`err` のときだけ立つ。
  さらに、**文字列**の `level: "error"` を含めると `console.log/warn` でも error 扱いになる。

生の console を残すとこの2系統が混在し、規約を二重に書く羽目になる。出力経路を1本にすれば
規約は上記の1行（`error`/`err` は 5xx 専用）で済む。
