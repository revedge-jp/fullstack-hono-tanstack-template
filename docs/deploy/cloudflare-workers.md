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
④ smoke check                      # 失敗したらデプロイ前に動いていた版を再ビルドして戻す（SMOKE_BASE_URL 設定時）
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
- `CUSTOM_DOMAIN` を使う stage は、そのドメインの origin と `/api/auth/callback/google` も足す（デプロイより前に）

### 2. GitHub Environments の設定

対話式スクリプトで設定する（推奨）:

```bash
bash scripts/setup-deploy-env.sh staging
bash scripts/setup-deploy-env.sh production
```

各項目の説明を表示しながら 1 つずつ入力を求め、そのまま GitHub に登録する。
**値はローカルのファイルに保存されない**（1Password 等の秘密管理ツールからその場で
ペーストする運用。デプロイ資格情報を開発マシンに永続させないこと）。
空 Enter でスキップでき、後から `gh secret set <NAME> --env <stage>` で追加できる。

設定される項目の一覧（スクリプトが扱うのと同じもの）:

**Secrets**:

| Secret | 用途 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Hyperdrive / Worker の作成・デプロイ（Workers 編集権限が必要）。オプション機能を使う場合は追加権限が必要: `CUSTOM_DOMAIN` → 対象 zone の Zone:Read + DNS:Edit、`EDGE_RATE_LIMIT_RPM` → Zone WAF:Edit、`LOGPUSH_DESTINATION` → Logs:Edit。発行時のトークン名は `<APP_NAME>-deploy` 推奨（同じ CF アカウントの staging / production で共有するトークンのため。production を別アカウントに置くならそのアカウント用に発行する。**preview には共有せず**専用に発行する: preview は PR のコードをこの資格情報で実行する） |
| `CLOUDFLARE_ACCOUNT_ID` | 同上 |
| `PLANETSCALE_SERVICE_TOKEN_ID` | PlanetScale DB / Role の作成。**Environment ごとに別に発行**し、production 用は production にだけ置く。staging / preview のトークンが production の DB に届かないよう、production は別の PlanetScale org に置くのが確実（[Alchemy IaC ガイド](../dev/alchemy-iac.md#state-と資格情報の権限境界preview-を使う前に読む)）。発行時のトークン名は `<APP_NAME>-<stage>` 推奨 |
| `PLANETSCALE_SERVICE_TOKEN` | 同上 |
| `ALCHEMY_PASSWORD` | Alchemy state 内 secrets の暗号化パスワード（`openssl rand -base64 32` で生成。プロジェクトごとに固有の値を推奨）。既に deploy した stage の値は変えない（復号できずデプロイが止まる） |
| `ALCHEMY_STATE_TOKEN` | Alchemy state store（CF 上の Durable Object）の認証トークン（任意の強い文字列。**同じ Cloudflare アカウント内の全環境・ローカルで同一の値**、別アカウントには別の値）。同じアカウントの全プロジェクト・全 stage の state を読み書きできるので、preview を使うアカウントにはどのプロジェクトの production も置かない（[Alchemy IaC ガイド](../dev/alchemy-iac.md#state-と資格情報の権限境界preview-を使う前に読む)） |
| `BETTER_AUTH_SECRET` | Better Auth のセッション署名鍵（`openssl rand -base64 32`） |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth。作成時のクライアント名は `<APP_NAME>-<stage>` 推奨（staging / production で別クライアントにするため） |
| `LOGPUSH_DESTINATION` | （オプション）Worker trace ログの Logpush 宛先 URI。**Workers Paid プラン必須**。宛先資格情報を含むため secret 扱い。未設定なら Logpush は無効 |

**Variables**:

| Variable | 用途 |
|---|---|
| `APP_NAME` | Worker / Hyperdrive / DB の命名ベース（init-template.sh のアプリ名と同じ値） |
| `PLANETSCALE_ORGANIZATION` | PlanetScale の組織名（preview は staging と同じ組織。production は別の組織を推奨） |
| `CUSTOM_DOMAIN` / `APP_ORIGIN` / `WORKERS_SUBDOMAIN` | 公開 URL（`BETTER_AUTH_URL` / `CORS_ORIGIN` に使用）。この優先順で解決される。`CUSTOM_DOMAIN`（推奨、例: `app.example.com`）は Alchemy がドメイン割り当て・DNS・TLS まで自動設定する。`APP_ORIGIN` は手動割り当てした URL の明示指定（後方互換）。`WORKERS_SUBDOMAIN` 指定時は `https://{worker名}.{subdomain}.workers.dev` を自動組み立て |
| `EDGE_RATE_LIMIT_RPM` | （オプション）エッジ（WAF）での `/api/*` レート制限。IP ごとの分間リクエスト数（例: `300`）。`CUSTOM_DOMAIN` 必須。**対象 zone の http_ratelimit フェーズを専有する**ため、zone を他アプリ・手動ルールと共有している場合や staging/production が同一 zone の場合は 1 stage のみで設定すること（管理外の既存ルールを検知した場合、deploy は上書きせず中断する） |
| `SMOKE_BASE_URL` | デプロイ直後の smoke チェック先 URL。`/api/health`（Hyperdrive 経由の DB 疎通）と `/`（SSR）を検証し、失敗するとデプロイジョブが赤になる。**未設定の場合 smoke チェックは skip される**（notice が出るだけでジョブは成功扱い）。`CUSTOM_DOMAIN` を使うときはそのドメインにする（ドメインが付いた次のデプロイで workers.dev の URL は閉じる。ドメインを足すデプロイでは稼働中の版を読めないので、そのデプロイが失敗しても自動ロールバックしない） |

secrets / vars が未設定のうちは deploy job は notice を出して skip する（テンプレート原本や
セットアップ途中のリポジトリが赤くならないため）。個別に追加・修正する場合は
`gh secret set <NAME> --env <stage>` / `gh variable set <NAME> --env <stage> --body "<値>"`。

### 3. 初回デプロイ

main に push するだけでよい（DB がなければ Alchemy が作り、CI がマイグレーションしてから Worker を出す）。
手動でやる場合は、`infra:deploy:*` がマイグレーションを流さないので、CI と同じ 3 段を手で踏む。
`infra:deploy:*` だけだと空の DB の上で Worker が動き、テーブルを使う処理（サインインを含む）が 500 になる:

```bash
# .env に Infra セクション（.env.example 参照）を設定した上で
# 1) DB / Hyperdrive だけを作り、接続 URL を表示する（CI では表示しない。ログに残さないこと）
SKIP_WORKER=1 SHOW_DATABASE_URL=1 bun run infra:deploy:staging
# 2) 表示された DATABASE_URL でマイグレーションする
(cd packages/database && DATABASE_URL='<表示された URL>' bunx drizzle-kit migrate)
# 3) Worker をデプロイする（初回は稼働中の版が無いので、ローカルデプロイの照合を飛ばす。docs/dev/alchemy-iac.md）
ALLOW_UNVERIFIED_LOCAL_DEPLOY=1 bun run infra:deploy:staging
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
| 削除に失敗して DB ブランチが残った | `preview-cleanup.yml` が staging DB の `pr-N` ブランチを見て、対応する PR が「ラベル付きの open」でなく、最終更新から 2 時間以上たっていれば削除する（PR 側の削除が実行中・待機中の可能性があるため。削除の直前に PR の状態を読み直す） |

削除のたびに `scripts/deploy/verify-preview-destroyed.sh` が DB ブランチ・Worker・Hyperdrive が
実際に消えたかを API で確かめ、残っていればジョブを失敗させる（`alchemy destroy` は削除に失敗しても
成功扱いで終わるため）。PR の状態を読めない `pr-N` は消さずにジョブを失敗させる。N が PR ではない
（手で `--stage pr-N` をデプロイした等）と分かっているなら、その DB ブランチを PlanetScale で手で削除する。

**コスト**: DB ブランチ（PS-DEV）は存在している時間の按分課金（$5/月相当）。オートスリープは
ないため「ラベルを付けている間だけ課金」と理解すること。レビューが数日で終わる PR なら数十円。

**注意**:
- DB は**空**（本番・staging のデータは複製されない）。デモデータが必要なら seed を流すこと
- fork からの PR では動かない（GitHub の仕様で secrets が渡らない）。同一リポジトリのブランチ専用
- ビルドは PR のコードを secrets が見える環境で実行するため、**信頼できる PR にだけラベルを付ける**こと
- staging DB が存在していることが前提（プレビューの DB はそのブランチとして作られる）
- **サインインが要る画面は確認できない**。preview も `NODE_ENV=production` なので開発用サインイン（`/api/dev/login`）は
  無効で、Google のサインインは PR ごとに変わる URL（`{APP_NAME}-pr-N.<subdomain>.workers.dev`）が OAuth
  クライアントの承認済みリダイレクト URI に無いため失敗する（ワイルドカードは登録できない）。確かめたい PR だけ
  `https://…-pr-N…/api/auth/callback/google` を一時的に足す

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
