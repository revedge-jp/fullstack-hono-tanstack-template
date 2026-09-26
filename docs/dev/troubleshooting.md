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

# 2. DBを起動し直す（データは残る）
bun run db:up:all

# 3. 環境変数を確認
cat .env | grep DATABASE_URL
```

> **注意**: データごと作り直す `db:reset` は `compose down -v` で、main の共有コンテナ内に Claude Code の worktree が持つ
> `wt_<name>` DB（dev/test 両方）もすべて消える。開いている worktree があるなら、その worktree のルートで
> `bash scripts/agent-worktree-setup.sh` を再実行して DB を作り直すこと（`docs/dev/git-worktree.md`）。
> また worktree の中では `db:up` / `db:down` を実行しない（DB は main の共有コンテナ）。

#### 症状: `database "app_db" does not exist`

```bash
# DBを作成（コンテナ名の既定は app_postgres。.env の POSTGRES_CONTAINER_NAME で変えていればその名前）
docker exec -it app_postgres psql -U postgres -c "CREATE DATABASE app_db;"
```

---

### 型エラー

#### 症状: APIの型が古い / client 側で `AppType` の推論が正しくない

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

# ポートを変更する（.env で設定）
CLIENT_PORT=3001
API_PORT=8082
```

`lsof` の出力で持ち主を確かめ、前回の `bun run dev` の残りなど自分が止めてよいプロセスなら、起動した端末で
Ctrl+C するか `kill <PID>` で止める。別の worktree の dev サーバーや他のアプリのこともあるので、PID だけを見て
`kill -9` しない。`CLIENT_PORT` を変えたら、`BETTER_AUTH_URL` / `BETTER_AUTH_TRUSTED_ORIGINS` / `CORS_ORIGIN` の
ポートも同じ値にする。

---

### マイグレーション関連

#### 症状: マイグレーションが適用できない

```bash
# 1. 生成済みマイグレーションと journal の整合を確認
ls packages/database/drizzle/
cat packages/database/drizzle/meta/_journal.json

# 2. 強制リセット（開発環境のみ。データは消える。確認が出る）
bun run db:reset && bun run db:up:all
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
# node_modules だけを消して再インストール（bun.lock は残す）
rm -rf node_modules
bun install
```

`bun.lock` を消して解決し直さない（`.claude/rules/package-management.md`: lock を信頼する）。
`minimum release age` を含むエラーで失敗する場合の対処も同ファイルにある。

#### 症状: パッケージが見つからない

```bash
# ワークスペースのリンクを張り直す
bun install
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

#### 症状: Deploy ワークフローがデプロイせずに終わる（skip される）

**原因:** `.github/workflows/deploy.yml` は push で CI Pipeline が成功したときに起動し、次のどちらかに
当たると赤い失敗にせず notice を出して skip する（テンプレート原本やセットアップ途中のリポジトリを
赤くしないため）。

1. `detect-target` ジョブ: デプロイ先の GitHub Environment が未作成（main への push なら `staging`、
   `vX.Y.Z` タグなら `production`。それ以外のブランチ・タグはそもそもデプロイ対象外）
2. `deploy` ジョブの `Check deploy readiness` step: その Environment の secrets / vars が揃っていない
   （足りない名前が notice に出る）

`wrangler.jsonc` の `{{APP_NAME}}` は skip の条件ではない（deploy は `APP_NAME` 変数で置換してから
ビルドする）。`DATABASE_URL` も登録不要（Alchemy が provision する）。

**解決方法:** Actions の実行結果の notice で、どちらで skip したかと足りない名前を確認する。
`bash scripts/setup-deploy-env.sh <staging|production>` で Environment を作り、secrets / vars を登録する
（一覧は [Cloudflare Workers デプロイガイド](../deploy/cloudflare-workers.md) の「2. GitHub Environments の設定」）。
ワークフロー自体の編集は不要。

---

## 認証

### ログインできない

#### 症状: Googleログインにリダイレクトされない / 失敗する

**確認事項:**
1. `.env` の `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` が正しいか
2. Google Cloud Console の OAuth クライアントで承認済みリダイレクト URI に
   `<BETTER_AUTH_URL>/api/auth/callback/google`（既定は `http://localhost:3000/api/auth/callback/google`）が含まれているか
3. `BETTER_AUTH_URL` が client のオリジン（`http://localhost:<CLIENT_PORT>`）になっているか。API のポート
   （8080）にすると、Google から戻る先が client と食い違う。worktree ではフックが worktree の client ポートに書き換える

#### 症状: `BETTER_AUTH_SECRET should be at least 32 characters` 警告

`.env.example` のダミー値（`your-secret-here`）のままだと dev でも出る。ダミーは本番で拒否させるために意図的に短く
してあるので、dev では無視してよい。本番（`NODE_ENV=production`）では `config.ts` が 32 文字未満を拒否する。

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
# デプロイ用の secrets は Environment ごとに登録する（名前は大文字小文字も含めて確認）
gh secret list --env staging
gh variable list --env staging
```

必要な secrets / vars の一覧は [Cloudflare Workers デプロイガイド](../deploy/cloudflare-workers.md) の
「2. GitHub Environments の設定」。

#### 症状: デプロイ（`alchemy deploy`）が Cloudflare の認証エラーで落ちる

**確認事項:**
1. `CLOUDFLARE_API_TOKEN` に Workers 編集権限があるか
2. `CLOUDFLARE_ACCOUNT_ID` が正しいか

---

## worktree

### 症状: worktreeが削除できない

`git worktree remove --force` や `rm -rf` で消さない。未コミットの変更を確認なしに消すうえ、ポートの登録と
`wt_*` DB が残る。Claude Code の worktree（`.claude/worktrees/<name>`）は、作ったセッションなら `ExitWorktree`
（remove）で、前のセッションで残したものは main のルートから削除フックを流して消す:

```bash
echo '{"worktree_path":"<worktree の絶対パス>"}' | bash .claude/hooks/worktree-remove.sh
```

フックが止まったときは表示された理由（未コミットの変更・どのブランチにも乗っていないコミット）を確かめる。
詳細は [git worktree ガイド](git-worktree.md) の「Q: worktree が削除できない」。

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
3. **Issueを作成**: 再現手順とエラーメッセージを含める

---

## 関連ドキュメント

- [開発ガイド](development.md) - 環境構築の詳細
- [Cloudflare Workers デプロイガイド](../deploy/cloudflare-workers.md) - デプロイ・CI/CDの詳細
- [git worktree運用ガイド](git-worktree.md) - worktreeの詳細
