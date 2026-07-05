# トラブルシューティング

本テンプレートでよくある問題と解決方法をまとめています。

## 目次

- [開発環境](#開発環境)
  - [DB接続エラー](#db接続エラー)
  - [型エラー](#型エラー)
  - [ポート競合](#ポート競合)
  - [マイグレーション関連](#マイグレーション関連)
  - [Bun/依存関係](#bun依存関係)
- [Cloudflare Workers 特有の問題](#cloudflare-workers-特有の問題)
- [認証](#認証)
- [CI/CD](#cicd)
- [worktree](#worktree)

---

## 開発環境

### DB接続エラー

#### 症状: `ECONNREFUSED` や接続タイムアウト

```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**解決方法:**

```bash
# 1. DBが起動しているか確認
docker ps

# 2. DBを再起動
bun run db:down && bun run db:up:all

# 3. 環境変数を確認
cat .env | grep DATABASE_URL
```

#### 症状: `database "app_db" does not exist`

```bash
# DBを作成
docker exec -it ax_saas_postgres psql -U postgres -c "CREATE DATABASE app_db;"
```

---

### 型エラー

#### 症状: APIの型が古い / client 側で `AppType` の推論が壊れる

```
Property 'xxx' does not exist on type ...
```

**解決方法:**

型は Hono RPC (`AppType`) 経由でサーバーから推論されます。`bun run build --filter=api-service` で `.d.ts` を再生成してから `bun run typecheck` で整合性を確認してください。

---

### ポート競合

#### 症状: `EADDRINUSE` エラー

```bash
# 使用中のポートを確認
lsof -i :3000
lsof -i :8080
lsof -i :5432

# プロセスを終了
kill -9 <PID>

# または、ポートを変更（.envで設定）
CLIENT_PORT=3001
API_PORT=8082
```

---

### マイグレーション関連

#### 症状: マイグレーションが適用できない

```bash
# 1. 生成済みマイグレーションと journal の整合を確認
ls packages/database/drizzle/
cat packages/database/drizzle/meta/_journal.json

# 2. 強制リセット（開発環境のみ。データは消える）
bun run db:down && bun run db:up:all
bun run db:migrate
```

#### 症状: スキーマを変更したのに反映されない

```bash
# スキーマ変更 → マイグレーション生成 → 適用 の順で実行する
bun run db:generate
bun run db:migrate
```

---

### Bun/依存関係

#### 症状: `bun install` が失敗

```bash
# キャッシュをクリアして再インストール
rm -rf node_modules
rm bun.lock
bun install
```

#### 症状: パッケージが見つからない

```bash
# ワークスペースの依存関係を再解決
bun install --force
```

---

## Cloudflare Workers 特有の問題

client は開発時でも `@cloudflare/vite-plugin` 経由で **workerd（Workers ランタイムの emulation）上で動く**。
そのため「Bun では動くのに client 経由だと落ちる」問題は大抵ランタイム差が原因。

#### 症状: `unable to determine transport target` / `worker_threads` 系のエラー

**原因:** Workers ランタイム（emulation 含む）には `worker_threads` がない。pino-pretty など
worker_threads を使うライブラリは `NODE_ENV=development` でも client 経由では動かない。

**解決方法:** 環境変数ではなく **ランタイム検出**で分岐する。標準的な検出方法:

```typescript
const isWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
```

`packages/logging/src/create-logger.ts` が実例。

#### 症状: `WeakRef is not defined` 等、Node 専用 API のエラー

**原因:** ライブラリが内部で Node 専用 API（`WeakRef`、sonic-boom、fs ストリーム等）に触れている。
pino の場合、Node ビルドは stream 引数を渡さない限り内部で SonicBoom を構築しようとする。

**解決方法:** ライブラリに「console のみに依存する書き込み先」を明示的に渡す
（`create-logger.ts` の `workersConsoleStream` が実例）。

#### 症状: SSR の loader から自分の `/api/*` を fetch すると 404

**原因:** CF Workers + Static Assets では、同一オリジンへの `fetch()` サブリクエストは
自分自身の fetch ハンドラーを経由しない（[ADR-001](../architecture/adr-001-cf-workers-session-check.md)）。

**解決方法:** AsyncLocalStorage 経由で注入されるインプロセス Hono RPC クライアントで呼ぶ
（`apps/client/shared/lib/api-client.ts`、実例は `features/tasks/queries/get-tasks.ts`）。

#### 症状: `bun run dev` (client) が wrangler.jsonc のエラーで起動しない

**原因:** テンプレートの `wrangler.jsonc` は `"name": "{{APP_NAME}}"` プレースホルダーのまま。

**解決方法:** `./scripts/init-template.sh <app-name>` で一括置換する（テンプレート初期化時に一度だけ実行）。CI ではビルド前にダミー値へ置換している（`.github/workflows/ci.yml` 参照）。

#### 症状: `main` への push で Deploy ワークフローの build/deploy が skip される

**原因:** `.github/workflows/deploy.yml` は、`wrangler.jsonc` に `{{APP_NAME}}` が残っているか、
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `DATABASE_URL` の secrets が未設定の場合、
build/migrate/deploy の各 step を自動的に skip する（テンプレート原本のままでは実デプロイが
構造的に成立しないため、赤い失敗にせず静かに skip する設計）。

**解決方法:** `./scripts/init-template.sh <app-name>` を実行し、GitHub リポジトリ（または
`staging`/`production` environment）に上記 secrets を設定すれば、次回 push から自動的に
デプロイが実行されるようになる。ワークフロー自体の編集は不要。

---

## 認証

### ログインできない

#### 症状: Googleログインにリダイレクトされない / 失敗する

**確認事項:**
1. `.env` の `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` が正しいか
2. Google Cloud Console の OAuth クライアントで承認済みリダイレクト URI に
   `http://localhost:3000/api/auth/callback/google` が含まれているか
3. `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` が設定されているか

#### 症状: `BETTER_AUTH_SECRET should be at least 32 characters` 警告

```bash
# 強固なシークレットを生成して .env に設定
openssl rand -base64 32
```

---

## CI/CD

### GitHub Actions

#### 症状: GitHub Secretsが見つからない

```
Error: Input required and not supplied: xxx
```

**解決方法:**

```bash
# Secret名を確認（大文字小文字も含む）
gh secret list

# Settings → Secrets and variables → Actions で設定
# デプロイに必要: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / DATABASE_URL
```

#### 症状: wrangler deploy が認証エラー

**確認事項:**
1. `CLOUDFLARE_API_TOKEN` に Workers 編集権限があるか
2. `CLOUDFLARE_ACCOUNT_ID` が正しいか

---

## worktree

### 症状: worktreeが削除できない

```bash
# 強制削除
git worktree remove --force ../<worktree-dir>

# それでも失敗する場合
rm -rf ../<worktree-dir>
git worktree prune
```

### 症状: `already checked out` エラー

同じブランチを複数のworktreeでチェックアウトすることはできない。

**解決方法:**
- 別のブランチ名を使用する
- 既存のworktreeを削除する

### 症状: `bun install` が遅い

worktreeごとに完全な`node_modules`が必要なため、初回は時間がかかる。
2回目以降はBunのグローバルキャッシュで高速化される。

---

## 問題が解決しない場合

1. **ログを確認**: ターミナル、ブラウザコンソール、Cloudflare ダッシュボード
2. **ドキュメントを確認**: 関連するドキュメントを再読
3. **チームに質問**: Slackの関連チャンネル
4. **Issueを作成**: 再現手順とエラーメッセージを含める

---

## 関連ドキュメント

- [開発ガイド](development.md) - 環境構築の詳細
- [Cloudflare Workers デプロイガイド](../deploy/cloudflare-workers.md) - デプロイ・CI/CDの詳細
- [git worktree運用ガイド](git-worktree.md) - worktreeの詳細
