# デプロイガイド

このドキュメントでは、ax-saas-template のデプロイ方法について説明します。

## 目次

- [概要](#概要)
- [クイックスタート（初回セットアップのみ）](#クイックスタート初回セットアップのみ)
- [デプロイフロー](#デプロイフロー)
- [トラブルシュート](#トラブルシュート)
- [詳細情報](#詳細情報)

## 概要

本テンプレートは、GitHub Actions を使用した自動デプロイに対応しています。

**初回セットアップ（手動）**: プロジェクトごとに1回だけ実行
- CI/CD用のサービスアカウントやWIF設定
- Terraform stateバケットの作成
- GitHub Secretsの登録
- 初回のインフラ作成（Cloud SQLインスタンスなど）

**通常のデプロイ（自動）**: コードをpushするだけで自動実行
- **stg 環境**: `main` ブランチへの push/merge で自動デプロイ
- **prod 環境**: タグ `v*` を push で自動デプロイ

デプロイフローの詳細は [システムアーキテクチャ](../architecture/architecture.md#デプロイフロー) を参照してください。

## クイックスタート（初回セットアップのみ）

**重要**: 以下の手順は**初回セットアップ時のみ**必要です。2回目以降のデプロイは自動で行われます。

### 方法1: setup.sh による一括セットアップ（推奨）

`./scripts/setup.sh` を実行すると、対話形式でパラメータを収集し、以下を自動実行します：

| Phase | 内容 |
|-------|------|
| Phase 0 | 前提チェック（gcloud, terraform, docker, gh の存在と認証） |
| Phase 1 | パラメータ収集（PROJECT_ID, REGION, PREFIX, GITHUB_REPO, DB_PASSWORD など） |
| Phase 2 | 設定生成（`bootstrap/terraform.tfvars`, `infra/terraform/terraform.tfvars`） |
| Phase 3 | Bootstrap Terraform（SA, WIF, GCS バケット, GitHub Secrets） |
| Phase 4 | 本番 Terraform（`infra-apply-staged.sh` でインフラ構築） |
| Phase 5 | 完了メッセージと次のステップ案内 |

**前提**:
```bash
gcloud auth login
gcloud auth application-default login
```

**実行**:
```bash
./scripts/setup.sh
```

Bootstrap では `infra/terraform/bootstrap/` の Terraform が実行され、WIF・GCS・GitHub Secrets が一括で作成されます。本番 Terraform は `infra-apply-staged.sh` により段階的に適用されます。

### 方法2: 手動セットアップ（詳細）

`./scripts/setup.sh` を使わず、手動で各ステップを実行する場合の手順です。

#### ステップ1: GCPプロジェクトの準備

```bash
# GCPプロジェクトを設定
gcloud config set project <YOUR_PROJECT_ID>

# Terraform実行に必要なAPIを事前に有効化（推奨）
gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com \
  --project <YOUR_PROJECT_ID>
```

#### ステップ2: 環境変数の設定

```bash
# 基本設定
export PROJECT_ID=<YOUR_PROJECT_ID>
export ORG_REPO=<org>/<repo>  # 例: kikagaku/ax-saas-template
export REGION=asia-northeast1

# ⚠️ 重要: POOL_ID と PROVIDER_ID は必ずプロジェクト固有の名前を使用
# 複数プロジェクトで同じ値を共有すると、WIF属性条件が上書きされてCI/CDが失敗します
export POOL_ID=github-myproject           # 例: github-ax-saas-template
export PROVIDER_ID=github-oidc-myproject  # 例: github-oidc-ax-saas-template

# Terraform stateバケット名
export BUCKET_STG=tfstate-myproject-stg   # 例: tfstate-ax-saas-template-stg
export BUCKET_PRD=tfstate-myproject-prd   # 例: tfstate-ax-saas-template-prd
```

#### ステップ3: terraform.tfvarsの作成

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars

# エディタで編集（以下の値を設定）
# - project_id: 上記で設定した PROJECT_ID
# - db_password: 強固なパスワード（後でGitHub Secretsにも設定）
```

**重要**: `db_password` は次のステップで GitHub Secrets にも登録するため、メモしておいてください。

#### ステップ4: CI用サービスアカウントとWIFの作成

```bash
cd infra/terraform/scripts

# WIFとサービスアカウントを一括作成
PROJECT_ID=$PROJECT_ID \
ORG_REPO=$ORG_REPO \
POOL_ID=$POOL_ID \
PROVIDER_ID=$PROVIDER_ID \
SKIP_BUCKET_IAM=1 \
./bootstrap-wif.sh

# 出力結果をメモ（次のステップで使用）
# - SA_EMAIL: ci-deployer@<PROJECT_ID>.iam.gserviceaccount.com
# - WIF_PROVIDER: projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/<POOL_ID>/providers/<PROVIDER_ID>
```

**注意**: `SKIP_BUCKET_IAM=1` を指定しているのは、この時点ではまだバケットが作成されていないためです。バケット作成後に再実行します。

#### ステップ5: Terraform stateバケットの作成

```bash
# stg/prod 環境用のバケットを作成
gsutil mb -l $REGION gs://$BUCKET_STG
gsutil mb -l $REGION gs://$BUCKET_PRD

# バージョニングを有効化（state履歴管理のため）
gsutil versioning set on gs://$BUCKET_STG
gsutil versioning set on gs://$BUCKET_PRD
```

#### ステップ6: CI用サービスアカウントにバケット権限を付与

バケット作成が完了したので、bootstrap-wif.shを再実行してバケットIAM権限を付与します：

```bash
cd infra/terraform/scripts

PROJECT_ID=$PROJECT_ID \
ORG_REPO=$ORG_REPO \
POOL_ID=$POOL_ID \
PROVIDER_ID=$PROVIDER_ID \
BUCKET_STG=$BUCKET_STG \
BUCKET_PRD=$BUCKET_PRD \
./bootstrap-wif.sh
```

#### ステップ7: GitHub Secretsの登録

ステップ4で出力された `SA_EMAIL` と `WIF_PROVIDER` を使って、GitHub Secretsを登録します。

#### 方法1: GitHub CLI を使用（推奨）

```bash
# GitHub CLI でログイン（未ログインの場合）
gh auth login

# リポジトリを確認
gh repo view

# STG 環境の Secrets を設定
gh secret set STG_GCP_PROJECT_ID --body "$PROJECT_ID"
gh secret set STG_WIF_PROVIDER --body "<ステップ4で出力されたWIF_PROVIDER>"
gh secret set STG_WIF_SA --body "<ステップ4で出力されたSA_EMAIL>"
gh secret set STG_TFSTATE_BUCKET --body "$BUCKET_STG"
gh secret set STG_DB_PASSWORD --body "<terraform.tfvarsで設定したdb_password>"

# PROD 環境の Secrets を設定（本番環境では別プロジェクトを推奨）
gh secret set PRD_GCP_PROJECT_ID --body "$PROJECT_ID"
gh secret set PRD_WIF_PROVIDER --body "<ステップ4で出力されたWIF_PROVIDER>"
gh secret set PRD_WIF_SA --body "<ステップ4で出力されたSA_EMAIL>"
gh secret set PRD_TFSTATE_BUCKET --body "$BUCKET_PRD"
gh secret set PRD_DB_PASSWORD --body "<terraform.tfvarsで設定したdb_password>"

# 設定確認
gh secret list
```

#### 方法2: Web UI を使用

1. GitHub リポジトリのページにアクセス
2. **Settings** → **Secrets and variables** → **Actions** を開く
3. **New repository secret** をクリック
4. 以下の Secrets を登録（STG環境）:

| Secret名 | 値 |
|---------|-----|
| `STG_GCP_PROJECT_ID` | `<YOUR_PROJECT_ID>` |
| `STG_WIF_PROVIDER` | ステップ4で出力された `WIF_PROVIDER` |
| `STG_WIF_SA` | ステップ4で出力された `SA_EMAIL` |
| `STG_TFSTATE_BUCKET` | `<BUCKET_STG>` （例: `tfstate-myproject-stg`） |
| `STG_DB_PASSWORD` | `terraform.tfvars` で設定した `db_password` |

5. 同様にPROD環境用のSecrets（`PRD_`プレフィックス）も登録

#### ステップ8: 初回インフラの作成

ローカルからTerraformを実行して、初回のインフラ（Cloud SQL、Cloud Run、ネットワークなど）を作成します。

**認証について**: ローカルからの `terraform apply` 実行時は、CI 用のサービスアカウント（WIF）ではなく、実行者のユーザーアカウントの Application Default Credentials（ADC）で認証されます。事前に `gcloud auth application-default login` を実行してください。

**必要なロール**: ローカルからの `terraform apply` 実行時には、実行者のユーザーアカウントに以下のロールが必要です：

- IAM Workload Identity プール管理者（ベータ版）
- Project IAM 管理者
- サービス アカウント管理者
- サービス ネットワーキング管理者（ベータ版）
- Cloud Run 管理者

```bash
cd infra/terraform/scripts

# CIと同じバックエンド設定を使用して初回インフラを作成
PROJECT_ID=$PROJECT_ID \
TF_BACKEND_BUCKET=$BUCKET_STG \
TF_BACKEND_PREFIX=stg/terraform.tfstate \
./infra-apply-staged.sh
```

このスクリプトは以下を自動実行します：
- `terraform.tfvars` から変数を読み取り
- 既存リソースを自動インポート（既にGCPに存在する場合）
- 段階的にインフラを作成（ネットワーク→ Cloud SQL → Cloud Runの順）
- Cloud SQLの作成には約10〜15分かかります

**重要**: CIと同じstateファイル（`prefix=stg/terraform.tfstate`）を使用するため、このステップが完了すれば、以降のデプロイはGitHub Actionsで自動実行されます。

#### ステップ9: 動作確認

初回インフラ作成が完了したら、GitHub Actionsが正常に動作するか確認します：

```bash
# ローカルで変更をコミット・プッシュ
git add .
git commit -m "Initial setup"
git push origin main

# GitHub Actionsのログを確認
# https://github.com/<your-org>/<your-repo>/actions
```

mainブランチへのpushにより、自動的に以下が実行されます：
1. CI パイプライン（Lint、Typecheck、Test、Architecture Check）
2. STG環境へのデプロイ（Build & Push → Apply → Migrate → Rollout）

### 🎉 セットアップ完了！

以降は、コードをpushするだけで自動デプロイされます：
- **stg 環境**: `main` ブランチへの push/merge で自動デプロイ
- **prod 環境**: タグ `v*` を push で自動デプロイ（例: `git tag v1.0.0 && git push origin v1.0.0`）

## デプロイフロー

### 通常のデプロイ（自動）

初回セットアップが完了したら、以降は**コードをpushするだけで自動的にデプロイされます**。手動での操作は不要です。

### CI パイプライン（自動）

`main` ブランチへの push/merge で CI パイプラインが**自動実行**されます。

- Lint（Biome）
- Typecheck（TypeScript）
- Unit Test
- Architecture Check（FSD、依存、guards、knip）

詳細は [.github/workflows/ci.yml](../.github/workflows/ci.yml) を参照してください。

### stg デプロイ（自動）

CI パイプラインが成功した場合、**自動的に** stg 環境にデプロイされます。

1. **Build & Push**: コンテナイメージを buildx でビルド → Artifact Registry へ push（自動）
2. **Apply**: Terraform を GCS Backend で `init` → `apply`（自動）
   - Cloud Run の `image` はダイジェスト固定 → push 毎に `terraform apply` で差分検知して新 Revision へ
   - 依存リソース作成更新 → Cloud SQL ユーザーのパスワードを Secret（GitHub Secrets 優先、なければ Secret Manager の database-url）に合わせて同期（自動）
3. **Migrate**: Cloud Run Job で `prisma migrate deploy` を実行（自動）
   - `succeededCount/failedCount` と `completionTime` をポーリングして結果を判定
4. **Rollout**: migrate 成功時のみ、以下の2段階でデプロイを実行（自動）
   - **Phase 1**: 新しいリビジョンを作成（`BUILD_SHA` で差分を強制）
     - **注意**: `lifecycle { ignore_changes = [traffic] }` により、トラフィックは切り替わらない
   - **Phase 2**: リビジョンが READY 状態になるまで待機 → トラフィックを 100% に切り替え
     - 各サービス（server/client）のリビジョンを順次チェック
     - 全リビジョンが READY になったことを確認後、`gcloud run services update-traffic` でトラフィック切り替え

**トラフィック切り替えの安全性**:
- 新しいリビジョンが完全に起動してヘルスチェックに合格するまで、既存のリビジョンにトラフィックが流れ続けます
- rollout 中に準備が整っていないインスタンスにリクエストが送られることはありません
- リビジョンが READY にならない場合（起動失敗、ヘルスチェック失敗など）は、デプロイが失敗し、既存のリビジョンにトラフィックが保持されます

**初回デプロイ時の注意**:
- 初回デプロイ時は、Terraform の `traffic` 設定が適用され、自動的に最新リビジョンに 100% のトラフィックが向けられます
- 2回目以降のデプロイでは、`lifecycle { ignore_changes = [traffic] }` により、Terraform はトラフィック設定を変更せず、rollout スクリプトが制御します

詳細は [.github/workflows/_deploy.yml](../.github/workflows/_deploy.yml)（再利用可能ワークフロー）と [deploy-stg.yml](../.github/workflows/deploy-stg.yml) を参照してください。

### prod デプロイ（自動）

タグ `v*` を push で**自動的に** prod 環境にデプロイされます。

```bash
# 本番デプロイの例
git tag v1.0.0
git push origin v1.0.0
```

フローは stg デプロイと同様です（Build & Push → Apply → Migrate → Rollout の2段階デプロイ）。

詳細は [.github/workflows/_deploy.yml](../.github/workflows/_deploy.yml)（再利用可能ワークフロー）と [deploy-prod.yml](../.github/workflows/deploy-prod.yml) を参照してください。

## トラブルシュート

### ⚠️ CI/CD でデータベースが削除される事故を防ぐ

**重要**: CI/CD でデプロイ時にデータベースが削除される事故を防ぐため、以下の点に注意してください。

#### 事故の原因

以下のような変数の不一致があると、Terraform は「旧リソースを削除→新リソースを作成」と判断します：

| 項目 | ローカル | CI/CD | 結果 |
|------|---------|-------|------|
| `prefix` | `myapp` | `ax`（ワークフローでハードコード） | 全リソース再作成 |
| `db_database_name` | `mydb` | `app`（デフォルト値） | DB削除→新DB作成 |

#### 安全機構

本テンプレートには以下の安全機構が組み込まれています：

1. **`prevent_destroy = true`**: Cloud SQL インスタンスとデータベースに設定済み（Terraform経由の削除を防止）
2. **`deletion_protection = true`**: Cloud SQL インスタンスに設定済み（GCP側の削除保護、gcloudやコンソールからの削除も防止）
3. **`ignore_changes = [name]`**: インスタンス名とデータベース名の変更を無視（prefix不一致による再作成を防止）
4. **CI/CD での破壊的変更検知**: `terraform-apply.sh` で Cloud SQL 関連リソースの削除を検知して停止（jq による厳密なチェック）

#### 推奨事項

1. **`prefix` を統一する**: ローカルの `terraform.tfvars` と CI/CD のワークフロー（`.github/workflows/*.yml`）で同じ値を使用
2. **ローカルで `terraform plan` を実行して差分を確認**: 特に `destroy` が含まれる場合は注意
3. **バックアップを有効化**: 本番環境では `db_backup_enabled = true` を設定

#### CI/CD で使用される変数

`.github/workflows/deploy-stg.yml` で以下の変数がハードコードされています：

```yaml
env:
  PREFIX: ax  # ← これと terraform.tfvars の prefix を一致させる
```

ローカルの `terraform.tfvars` と一致していることを確認してください。

### GitHub Secrets が見つからないエラー

- Secret 名のスペルミスを確認（大文字小文字も含む）
- リポジトリの Settings → Secrets and variables → Actions で Secrets が正しく設定されているか確認
- ワークフローファイルで参照している Secret 名と一致しているか確認
- GitHub CLI で確認: `gh secret list`

### 最終デプロイ日が更新されない

- 原因: Cloud Run の `image` をタグで指定すると差分として検出されないことがある
- 対応: ダイジェスト指定（本リポジトリは対応済み）/ 一時的に `terraform apply -replace=google_cloud_run_v2_service.<service>`

### DB マイグレーションが失敗する

- `gcloud run jobs executions list --region <region> --project <project>` でログを確認
- `DATABASE_URL` Secret の値/権限、VPC Connector、Private IP を確認

### Artifact Registry への push が失敗する

- `gcloud auth configure-docker <region>-docker.pkg.dev` を実行
- WIF/SA の権限（Artifact Registry Writer）を確認

### Terraform init で `storage: bucket doesn't exist`

- バケット名（`TFSTATE_BUCKET_*`）が正しいか（`gs://` なしの純名）
- バケットの所在プロジェクトと `PROJECT_ID` の整合
- CI サービスアカウントにバケット IAM（`roles/storage.objectAdmin` と必要に応じ `roles/storage.legacyBucketReader`）が付いているか

### ロードバランサー経由でアクセスできない

- ロードバランサーのプロビジョニング完了を確認（数分かかる場合あり）
- `terraform output load_balancer_ip` でIPアドレスを確認
- Cloud Runサービスが `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER` に設定されているか確認
- ロードバランサーのURLマップでパスルーティング（`/api/*` → server）が正しく設定されているか確認

### 既存リソースが存在するエラー（409エラー）

既存のGCPリソースが存在する場合、以下のようなエラーが発生することがあります：

```
Error: Error creating Repository: googleapi: Error 409: the repository already exists
Error: Error creating Secret: googleapi: Error 409: Secret [...] already exists
```

これは、既存のGCPリソースがTerraform stateにインポートされていないためです。

**解決方法**: ローカルで`infra-apply-staged.sh`を実行すると、既存リソースを自動的にインポートします：

```bash
cd infra/terraform/scripts
export BUCKET_STG=tfstate-<app>-stg
# 重要: CIと同じprefixを指定する必要があります
TF_BACKEND_BUCKET=$BUCKET_STG TF_BACKEND_PREFIX=stg/terraform.tfstate ./infra-apply-staged.sh
```

このスクリプトは、`terraform.tfvars`から変数を読み取り、既存リソースを自動的にインポートします。

詳細な手順は [infra/terraform/README.md](../infra/terraform/README.md#35-既存リソースのインポート初回のみ) を参照してください。

### Cloud SQL 認証エラー（P1000）

`Error: P1000: Authentication failed ... appuser` が出る場合は、Cloud SQL のユーザーと Secret の不一致が原因です。

1. ユーザー確認:
   ```bash
   gcloud sql users list --instance ax-db --project $PROJECT_ID
   ```

2. パスワードリセット:
   ```bash
   NEW='<your-password>'
   gcloud sql users set-password appuser \
     --instance ax-db \
     --project "$PROJECT_ID" \
     --password "$NEW"
   ```

3. DATABASE_URL を同値で更新（URL エンコードに注意）:
   ```bash
   HOST=$(gcloud sql instances describe ax-db --project "$PROJECT_ID" --format='value(ipAddresses.ipAddress)')
   ENC=$(python3 - <<'PY' "$NEW"
   import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=''))
   PY
   )
   printf 'postgresql://appuser:%s@%s:5432/app?schema=public\n' "$ENC" "$HOST" | \
     gcloud secrets versions add database-url --project "$PROJECT_ID" --data-file=-
   ```

4. CI 再実行（apply → migrate）

### WIF Provider 作成で INVALID_ARGUMENT

- `--attribute-condition` が `attribute.*` を参照しているか確認（例を再実行）

### rollout で 403 iam.serviceaccounts.actAs

- `TF_VAR_deployer_service_account` が渡っているか確認
- 対象 SA に `roles/iam.serviceAccountUser` が付いているか確認

詳細は [インフラ詳細](../infra/terraform/README.md#5-トラブルシュート要点) を参照してください。

## 詳細情報

### デフォルト設定値

本テンプレートのデフォルト設定値:

- **リージョン**: `asia-northeast1`
- **サービス名**:
  - Server: `ax-server`
  - Client: `ax-client`
- **データベース**:
  - インスタンス名: `ax-db`
  - データベース名: `app`
  - ユーザー名: `appuser`
- **サービスアカウント**:
  - Server: `ax-server-sa`
  - Client: `ax-client-sa`
  - Migrate: `ax-mig-sa`

これらの値は `infra/terraform/variables.tf` で変更可能です。

### 手動セットアップ（詳細）

クイックスタートのスクリプトを使用せず、手動でセットアップする場合や、詳細な仕組みを理解したい場合は、以下を参照してください：

#### WIF Provider / デプロイ用 SA の手動作成

**デプロイ用サービスアカウント（CI が使う）**の作成と最小権限付与:

```bash
PROJECT_ID="<YOUR_PROJECT_ID>"
gcloud iam service-accounts create ci-deployer \
  --project ${PROJECT_ID} \
  --display-name "CI Deployer"

SA="ci-deployer@${PROJECT_ID}.iam.gserviceaccount.com"

# 必要最小ロール（必要に応じて調整）
for ROLE in \
  roles/run.admin \
  roles/artifactregistry.admin \
  roles/secretmanager.admin \
  roles/cloudsql.admin \
  roles/serviceusage.serviceUsageAdmin \
  roles/resourcemanager.projectIamAdmin \
  roles/compute.networkAdmin \
  roles/compute.loadBalancerAdmin \
  roles/vpcaccess.admin \
  roles/iam.serviceAccountAdmin
do
  gcloud projects add-iam-policy-binding ${PROJECT_ID} \
    --member="serviceAccount:${SA}" \
    --role="${ROLE}"
done
```

**重要**: CI SA は Terraform 実行主体として、ランタイムSAに対する actAs が必要です。このテンプレートでは `TF_VAR_deployer_service_account` に SA を渡すと、Terraform 側で server/client/migrate それぞれに `roles/iam.serviceAccountUser` を付与します。

**Workload Identity Federation（WIF）** の作成（GitHub OIDC 用）:

```bash
PROJECT_NUMBER=$(gcloud projects describe ${PROJECT_ID} --format='value(projectNumber)')

# ⚠️ 重要: POOL_ID と PROVIDER_ID は必ずプロジェクト固有の名前を使用
# 複数プロジェクトで同じ値を使用すると attribute-condition が上書きされます
POOL_ID="github-myproject"          # 例: github-ax-saas-template
PROVIDER_ID="github-oidc-myproject" # 例: github-oidc-ax-saas-template

# 既存なら create はスキップ可
gcloud iam workload-identity-pools describe ${POOL_ID} --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create ${POOL_ID} \
    --location=global \
    --display-name="GitHub"

gcloud iam workload-identity-pools providers create-oidc ${PROVIDER_ID} \
  --location=global \
  --workload-identity-pool=${POOL_ID} \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.actor=assertion.actor,attribute.aud=assertion.aud" \
  --attribute-condition="attribute.repository=='<your-org>/<your-repo>'"

# CI 用 SA に WIF の利用権限を付与（pool レベルで OK）
SA="ci-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud iam service-accounts add-iam-policy-binding ${SA} \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/<your-org>/<your-repo>" \
  --role="roles/iam.workloadIdentityUser"
```

**ポイント**: 
- `--attribute-mapping` で属性を定義し、**`--attribute-condition` は `attribute.*` を参照**します（`assertion.*` ではありません）
- **POOL_ID と PROVIDER_ID は必ずプロジェクト固有の値を使用**してください（複数プロジェクトでの共有は禁止）
- さらに厳密にするなら、`--attribute-condition` に `attribute.repository=='<your-org>/<your-repo>' && attribute.ref=='refs/heads/main'` のようにブランチ条件も追加できます

#### WIF_PROVIDER の取得方法

```bash
gcloud iam workload-identity-pools providers describe <PROVIDER_ID> \
  --location=global --workload-identity-pool=<POOL_ID> --format='value(name)'
```

#### DB パスワード運用（Secret Manager を真実とする）

**重要**: 
- Cloud SQLインスタンスは、Terraformで作成した後でないと `secret-sync-db-url.sh` を実行できません。
- Cloud SQLインスタンスの作成には約10〜15分かかります。初回セットアップ時は時間に余裕を持って実行してください。

初回適用後、Cloud SQL のプライベートIPを取得し、Secret Manager の `database-url` を作成/上書きします。

**クイック同期**: 付属スクリプトで一括作成/同期できます。

```bash
cd infra/terraform/scripts
# terraform.tfvars の db_password から自動的に読み取ります（PASSWORD 指定不要）
PROJECT_ID=<YOUR_PROJECT_ID> INSTANCE=ax-db USER=appuser ./secret-sync-db-url.sh

# または、明示的にパスワードを指定する場合
PROJECT_ID=<YOUR_PROJECT_ID> INSTANCE=ax-db USER=appuser PASSWORD='<plain>' ./secret-sync-db-url.sh
```

**パスワード解決の優先順位**:
1. `PASSWORD` 環境変数（最優先）
2. `DB_PASSWORD` 環境変数
3. `terraform.tfvars` の `db_password` 値（自動読み取り）
4. `PASSWORD_FILE` 環境変数で指定されたファイル
5. 対話的プロンプト（フォールバック）

以後 CI は `database-url` からパスワードを抽出→Cloud SQL 同期を自動実行します。

### 参照ドキュメント

- [システムアーキテクチャ](../architecture/architecture.md) - システム全体の構成とデプロイフロー
- [インフラ詳細](../infra/terraform/README.md) - Terraform の詳細とローカル実行方法
- [GitHub Secrets 設定ガイド](github-secrets-setup.md) - GitHub Secretsの詳細な設定方法
