# トラブルシューティング

ax-saas-template でよくある問題と解決方法をまとめています。

## 目次

- [開発環境](#開発環境)
  - [DB接続エラー](#db接続エラー)
  - [型エラー](#型エラー)
  - [ポート競合](#ポート競合)
  - [Prisma関連](#prisma関連)
  - [Bun/依存関係](#bun依存関係)
- [認証・認可](#認証認可)
  - [ログインできない](#ログインできない)
  - [セッション関連](#セッション関連)
- [CI/CD・デプロイ](#cicdデプロイ)
  - [GitHub Actions](#github-actions)
  - [Terraform](#terraform)
  - [Cloud Run](#cloud-run)
  - [Cloud SQL](#cloud-sql)
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
# 期待値: postgresql://postgres:postgres@localhost:5432/app_db?schema=public
```

#### 症状: `database "app_db" does not exist`

```bash
# DBを作成
docker exec -it ax_saas_postgres psql -U postgres -c "CREATE DATABASE app_db;"
```

---

### 型エラー

#### 症状: Prismaの型が見つからない

```
Cannot find module '@prisma/client'
```

**解決方法:**

```bash
# Prisma Client を再生成
bun run db:generate
```

#### 症状: APIの型が古い

```
Property 'xxx' does not exist on type ...
```

**解決方法:**

型は Hono RPC (`AppType`) 経由でサーバーから推論されます。`bun run build --filter=api-service` で `.d.ts` を再生成してから `bun run typecheck` で整合性を確認してください。

---

### ポート競合

#### 症状: `EADDRINUSE` エラー

```
Error: listen EADDRINUSE: address already in use :::3000
```

**解決方法:**

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

### Prisma関連

#### 症状: マイグレーションエラー

```
Error: P3006: Migration failed to apply
```

**解決方法:**

```bash
# 1. マイグレーション状態を確認
cd packages/database
npx prisma migrate status

# 2. 強制リセット（開発環境のみ）
bun run db:down && bun run db:up:all
bun run db:migrate

# 3. スキーマの同期（マイグレーションなし）
npx prisma db push
```

#### 症状: `Schema engine error`

```bash
# Prismaのキャッシュをクリア
rm -rf node_modules/.prisma
bun run db:generate
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

## 認証・認可

### ログインできない

#### 症状: Googleログインポップアップが表示されない

**確認事項:**
1. Firebase設定が正しいか（`.env`の`NEXT_PUBLIC_FIREBASE_*`）
2. GCPの承認済みドメインに`localhost`が含まれているか
3. ブラウザのコンソールにエラーが出ていないか

**解決方法:**

```bash
# 環境変数を確認
cat .env | grep FIREBASE
```

#### 症状: 403 Forbidden（本番環境）

**確認事項:**
1. IAP設定で許可されたドメインに含まれているか
2. Google Workspaceアカウントを使用しているか

---

### IAP JWT関連

#### 症状: `IAP JWT verification failed` エラー

**確認事項:**
1. `GOOGLE_CLOUD_PROJECT_NUMBER` が正しいか
2. `IAP_BACKEND_SERVICE_ID` が正しいか
3. Audienceが期待値と一致しているか

#### 症状: 本番環境でIAP JWT検証がスキップされる

**原因:** `IAP_BACKEND_SERVICE_ID` が未設定（初回デプロイ時に発生することあり）

**解決方法:**
1. Cloud Consoleで Backend Service ID を確認
2. Secret Manager に設定
3. Cloud Run を再デプロイ

> JWT検証がスキップされても、IAP自体・VPC・Ingress制限による保護は有効です。

---

## CI/CD・デプロイ

### GitHub Actions

#### 症状: GitHub Secretsが見つからない

```
Error: Input required and not supplied: xxx
```

**解決方法:**

```bash
# Secret名を確認（大文字小文字も含む）
gh secret list

# Secretが正しく設定されているか確認
# Settings → Secrets and variables → Actions
```

#### 症状: WIF認証エラー

```
Error: google-github-actions/auth failed
```

**確認事項:**
1. `WIF_PROVIDER_*`の値が正しいか（プロジェクト番号）
2. `WIF_SA_*`のサービスアカウントが存在するか
3. GitHub Actionsからのアクセスが許可されているか

```bash
# WIF Providerの確認
gcloud iam workload-identity-pools providers describe github-oidc \
  --location=global \
  --workload-identity-pool=github
```

---

### Terraform

#### 症状: `storage: bucket doesn't exist`

**確認事項:**
1. `TFSTATE_BUCKET_*`に`gs://`が含まれていないか（バケット名のみ）
2. バケットが存在するか
3. CI SAにバケットへのアクセス権限があるか

```bash
# バケットの確認
gsutil ls gs://${TFSTATE_BUCKET}

# 権限の付与
SA="ci-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud storage buckets add-iam-policy-binding gs://${TFSTATE_BUCKET} \
  --member="serviceAccount:$SA" \
  --role="roles/storage.objectAdmin"
```

#### 症状: `Error 409: already exists`

既存リソースがTerraform stateにインポートされていない。

**解決方法:**

```bash
# 自動インポート（推奨）
cd infra/terraform/scripts
TF_BACKEND_BUCKET=$BUCKET_STG TF_BACKEND_PREFIX=stg/terraform.tfstate ./infra-apply-staged.sh

# 手動インポート
terraform import google_artifact_registry_repository.repo \
  projects/${PROJECT_ID}/locations/${REGION}/repositories/ax-repo
```

詳細は [Terraform README](../infra/terraform/README.md) を参照。

---

### Cloud Run

#### 症状: ロードバランサー経由でアクセスできない

**確認事項:**
1. ロードバランサーのプロビジョニング完了（数分かかる）
2. Cloud Runサービスの`ingress`設定
3. URLマップのパスルーティング

```bash
# IPアドレスを確認
terraform output load_balancer_ip

# Cloud Runサービスの確認
gcloud run services describe ax-client --region asia-northeast1
```

### Cloud SQL

#### 症状: `P1000: Authentication failed`

Cloud SQLのユーザーとSecretの不一致。

**解決方法:**

```bash
# 1. ユーザー確認
gcloud sql users list --instance ax-db --project $PROJECT_ID

# 2. パスワードリセット
NEW='<your-password>'
gcloud sql users set-password appuser \
  --instance ax-db \
  --project "$PROJECT_ID" \
  --password "$NEW"

# 3. DATABASE_URLを更新（URLエンコードに注意）
HOST=$(gcloud sql instances describe ax-db --project "$PROJECT_ID" --format='value(ipAddresses.ipAddress)')
ENC=$(python3 - <<'PY' "$NEW"
import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=''))
PY
)
printf 'postgresql://appuser:%s@%s:5432/app?schema=public\n' "$ENC" "$HOST" | \
  gcloud secrets versions add database-url --project "$PROJECT_ID" --data-file=-
```

#### 症状: DBマイグレーションが失敗

```bash
# ログを確認
gcloud run jobs executions list --region asia-northeast1 --project $PROJECT_ID

# 確認事項
# - DATABASE_URL Secretの値/権限
# - VPC Connectorの設定
# - Private IPの確認
```

---

## worktree

### 症状: worktreeが削除できない

```bash
# 強制削除
git worktree remove --force ../ax-saas-template-feat-xxx

# それでも失敗する場合
rm -rf ../ax-saas-template-feat-xxx
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

### 症状: Prismaのスキーマ変更が反映されない

```bash
# 各worktreeで再生成が必要
bun run db:generate
```

---

## その他

### 症状: Application Default Credentialsエラー（ローカル開発）

```
Error: Could not load the default credentials
```

**解決方法:**

```bash
gcloud auth application-default login
```

### 症状: Docker buildxの問題

```bash
# buildx builderを再作成
docker buildx rm ax-builder || true
docker buildx create --use --name ax-builder
```

---

## 問題が解決しない場合

1. **ログを確認**: ターミナル、ブラウザコンソール、Cloud Logging
2. **ドキュメントを確認**: 関連するドキュメントを再読
3. **チームに質問**: Slackの関連チャンネル
4. **Issueを作成**: 再現手順とエラーメッセージを含める

---

## 関連ドキュメント

- [開発ガイド](development.md) - 環境構築の詳細
- [デプロイガイド](../deploy/deployment.md) - CI/CDの詳細
- [Terraform README](../infra/terraform/README.md) - インフラの詳細
- [git worktree運用ガイド](git-worktree.md) - worktreeの詳細

