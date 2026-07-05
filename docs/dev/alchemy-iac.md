# Alchemy による Infrastructure as TypeScript

**ステータス**: 採用済み — `.github/workflows/deploy.yml` のデプロイ本体（実デプロイでの動作検証は進行中）

[Alchemy](https://alchemy.run) は TypeScript ネイティブの IaC ライブラリ。`alchemy.run.ts`（リポジトリルート）で PlanetScale リソース（Database + Role）と Cloudflare リソース（Hyperdrive + Worker）を宣言し、作成・更新・削除を行う。

## 何を解決するか

旧フロー（手動 DB 作成 + wrangler.jsonc の env + `wrangler secret put`）の手作業を排除する：

| 旧 | Alchemy |
|---|---|
| PlanetScale ダッシュボードで DB / ロールを手動作成し接続文字列をコピー | `Database()` + `Role()` が作成し、接続情報はコード内で Hyperdrive へ直結 |
| `wrangler hyperdrive create` を手動実行して id を wrangler.jsonc の `TODO` に貼る | `Hyperdrive()` リソースが作成〜バインドまで自動 |
| マイグレーション用 `DATABASE_URL` を GitHub secret に手動登録 | provision フェーズが GITHUB_ENV へ export（ログはマスク） |
| ADR-002 の「直接続 (5432) 必須」はドキュメント頼み | Role の直接続エンドポイントを構造的に使用（人が port を選ぶ余地がない） |
| secrets は `wrangler secret put` で個別管理 | `alchemy.secret()` で Worker bindings へ注入 |

## CI での実行（deploy.yml）

マイグレーション順序（旧コードが動いているうちにスキーマを揃え、そのあと新コードを出す）を
守るため 2 段実行になっている：

```
① bunx alchemy deploy --stage <target>   # SKIP_WORKER=1: DB / Role / Hyperdrive まで
   └─ DATABASE_URL を GITHUB_ENV へ export（::add-mask:: 済み）
② bun run db:migrate                     # ①が export した URL を使用
③ bunx alchemy deploy --stage <target>   # Worker デプロイ（全リソース reconcile）
```

必要な GitHub Environment Secrets / Variables は
[デプロイガイド](../deploy/cloudflare-workers.md#2-github-environments-の設定)を参照。

## ローカルからの実行

1. **Cloudflare 認証** — `.env` に `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`
   - API トークンの権限: **Workers Scripts: Edit** + **Hyperdrive: Edit**（Account スコープ）
   - CI（GitHub secrets）と同じトークンを使い回せる。`wrangler login` の OAuth は Alchemy からは参照されない
     （対話式の `alchemy configure` + `alchemy login` でも可だがトークン方式を推奨）
2. **PlanetScale サービストークン**
   - ダッシュボード → Organization settings → Service tokens で発行（DB 作成権限付き）
3. **`.env` に設定**（`.env.example` の Infra セクション参照）
   - `APP_NAME` — Worker / Hyperdrive / DB の命名ベース
   - `ALCHEMY_PASSWORD` — state 内 secrets の暗号化パスワード
   - `ALCHEMY_STATE_TOKEN` — state store の認証トークン（**CI と同一の値**）
   - `PLANETSCALE_ORGANIZATION` / `PLANETSCALE_SERVICE_TOKEN_ID` / `PLANETSCALE_SERVICE_TOKEN`
   - `APP_ORIGIN` または `WORKERS_SUBDOMAIN` — `BETTER_AUTH_URL` / `CORS_ORIGIN` 用
   - `BETTER_AUTH_SECRET` / `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`（既存）

```bash
bun run infra:deploy:staging      # client をビルドして staging をデプロイ（DB がなければ作成）
bun run infra:deploy:production   # production をデプロイ
bun run infra:destroy:staging     # staging のリソースを削除

# ローカルでマイグレーションを流したい時: 接続 URL の取り出し口
SHOW_DATABASE_URL=1 bun run infra:deploy:staging
```

命名は staging: `{APP_NAME}-staging`、production: `{APP_NAME}`。DB も同じ命名で stage ごとに
1 つ作成される。同名の既存リソースがあれば `adopt: true` で引き継ぐ（ダッシュボードで手動作成済みの
DB / Hyperdrive からもそのまま移行できる）。

### pr-* stage（PR プレビュー環境）

`--stage pr-<番号>` は PR プレビュー用の特殊 stage（通常は `preview.yml` が管理し、手で叩くことはない）。
staging / production との違い:

- DB は `Database` を新規作成せず、**staging DB（`{APP_NAME}-staging`）の `Branch`** を作る
  （PS-DEV インスタンス、存在時間分の按分課金、スキーマ・データは複製されない）
- Branch の `delete` はデフォルト **true**: `alchemy destroy --stage pr-N` で DB ブランチごと消える
  （staging / production の DB が destroy で消えないのとは逆。使い捨て前提のため）
- `APP_ORIGIN` は無視され、URL は常に `{APP_NAME}-pr-N.{WORKERS_SUBDOMAIN}.workers.dev`

## 仕組み

- PlanetScale: `Database`（Postgres / PS_5 / Tokyo / arm / `replicas: 0` = シングルノード $5/月）→
  `Role`（`postgres` 継承、TTL なし）の順に作成し、Role の直接続情報（port 5432）を `Hyperdrive` の origin に渡す。
  **`replicas` は必ず明示する** — 未指定だと PlanetScale デフォルトの HA（3ノード = 3倍額）で作られる
- ビルドは既存の `vite build`（`@cloudflare/vite-plugin`）をそのまま使用。Alchemy は
  `apps/client/dist/server/index.js` を `noBundle: true` で（チャンクごと）アップロードし、
  `dist/client` を Assets としてバインドする
- **state は `CloudflareStateStore`**（自アカウントの CF 上に立つ Durable Object）に置き、
  ローカルと CI で共有する。state service（Worker 名 `alchemy-state-service`）は
  **CF アカウントに1つを全プロジェクトで共用**し、内部では app 名 × stage で名前空間分離される。
  したがって `ALCHEMY_STATE_TOKEN` は**アカウント共通のシークレット**（組織で一元管理して
  全プロジェクトに同じ値を配る）、`ALCHEMY_PASSWORD` は **プロジェクト個別**（state 内 secrets の
  暗号化鍵。プロジェクトごとに変えることで相互に復号できない分離を保つ）
- stage は Alchemy の `--stage` フラグで分離され、state も stage ごとに独立
- **`infra:destroy` は DB を削除しない**: PlanetScale の `Database` / `Role` は `delete: false`
  （デフォルト）のため、destroy 時は state から外れるだけで実体は残る（誤削除防止）。
  本当に消す場合は PlanetScale ダッシュボードから削除する

## 検証状況 / 既知の制約

- [x] staging の実デプロイ（PlanetScale DB 作成 → Role → Hyperdrive → Worker → migrate → smoke 通過。2026-07-05 検証済み）
- [x] cluster size（`PS_5` + arm → `PS_5_AWS_ARM`）と region slug（`ap-northeast`）は実 API に受理される
- [ ] OAuth ログインの一気通貫（検証時は Google クレデンシャルがプレースホルダーだったため未確認）
- [ ] `wrangler deploy` でデプロイした既存 Worker / 手動作成済み DB の adopt が問題なく動くか
- PlanetScale のサービストークンは一覧系 API（databases list / regions）の権限がなくても動く
  （Alchemy は名前指定の create/get しか呼ばない）。必要な付与は org の `create_databases` +
  全 DB への read/write/delete
- named assets binding（`ASSETS`）は任意のプロパティ名の `in` に true を返す RPC プロキシとして
  env に入るため、Hyperdrive 検出は `connectionString` の string 型チェックまで行う
  （`apps/client/shared/lib/hono-app.ts` — Alchemy デプロイで顕在化した実障害）
- Alchemy は v0.x（pre-1.0）。Effect ベースの v2 リライトが進行中で API 変更の可能性あり
