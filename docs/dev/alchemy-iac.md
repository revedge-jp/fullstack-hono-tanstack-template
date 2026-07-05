# Alchemy による Infrastructure as TypeScript（検証中）

**ステータス**: PoC（既存の wrangler.jsonc / deploy.yml は置き換えていない）

[Alchemy](https://alchemy.run) は TypeScript ネイティブの IaC ライブラリ。`alchemy.run.ts`（リポジトリルート）で Cloudflare リソース（Hyperdrive + Worker）を宣言し、作成・更新・削除を行う。

## 何を解決するか

従来フロー（wrangler.jsonc + deploy.yml）の手作業を排除する：

| 従来 | Alchemy |
|---|---|
| `wrangler hyperdrive create` を手動実行して id を wrangler.jsonc の `TODO` に貼る | `Hyperdrive()` リソースが作成〜バインドまで自動 |
| ADR-002 の「Session Mode (5432) 必須」はドキュメント頼み | `alchemy.run.ts` が port を検証し 6543 なら即エラー |
| `{{APP_NAME}}` プレースホルダーを sed で置換 | `.env` の `APP_NAME` を参照 |
| secrets は `wrangler secret put` / GitHub secrets で個別管理 | `alchemy.secret()` で暗号化して state 管理 |

## セットアップ

1. **Cloudflare 認証**（どちらか）
   - `bunx wrangler login`（OAuth。ローカル向け）
   - `.env` に `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`（CI 向け）
2. **`.env` に設定**（`.env.example` の Infra セクション参照）
   - `APP_NAME` — Worker / Hyperdrive の命名ベース
   - `ALCHEMY_PASSWORD` — state 内 secrets の暗号化パスワード
   - `HYPERDRIVE_ORIGIN_URL` — Supabase **Session Mode（port 5432）** の接続文字列
   - `APP_ORIGIN` または `WORKERS_SUBDOMAIN` — `BETTER_AUTH_URL` / `CORS_ORIGIN` 用
   - `BETTER_AUTH_SECRET` / `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`（既存）

## コマンド

```bash
bun run infra:deploy:staging      # client をビルドして staging をデプロイ
bun run infra:deploy:production   # production をデプロイ
bun run infra:destroy:staging     # staging のリソースを削除
```

命名は wrangler.jsonc の env 規則と同一（staging: `{APP_NAME}-staging`、production: `{APP_NAME}`）。既存 Worker があれば `adopt: true` で引き継ぐ。

## 仕組み

- ビルドは既存の `vite build`（`@cloudflare/vite-plugin`）をそのまま使用。Alchemy は
  `apps/client/dist/server/index.js` を `noBundle: true` で（チャンクごと）アップロードし、
  `dist/client` を Assets としてバインドする。ビルドパイプラインには一切手を入れていない
- state は `.alchemy/`（gitignore 済み）。secrets は `ALCHEMY_PASSWORD` で暗号化される
- stage は Alchemy の `--stage` フラグで分離され、state も stage ごとに独立

## 既知の制約 / 検証で確認すること

- [ ] staging の実デプロイが成功するか（Hyperdrive 作成 → Worker 起動 → OAuth ログイン）
- [ ] `wrangler deploy` でデプロイした既存 Worker の adopt が問題なく動くか
- Alchemy は v0.x（pre-1.0）。Effect ベースの v2 リライトが進行中で API 変更の可能性あり
- Supabase プロジェクト自体の作成は対象外（Alchemy に Supabase プロバイダなし）
- 検証で問題なければ deploy.yml を `alchemy deploy` ベースに置き換え、wrangler.jsonc の
  env セクション（staging/production）を削除する（ローカル dev 用のトップレベル設定は残る）
