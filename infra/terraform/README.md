# Terraform for GCP（Cloud Run + Artifact Registry + Cloud SQL）

このディレクトリは、Cloud Run（server/client）、Artifact Registry、VPC/Serverless VPC Connector、Cloud SQL(PostgreSQL) を作成・更新するTerraform定義です。

## 前提
- gcloud SDK 初期化（`gcloud auth application-default login`）
- Terraform >= 1.6
- GCPプロジェクトと課金が有効

---
## bootstrap/ ディレクトリ（初回セットアップ用）

`bootstrap/` は、本番 Terraform 実行の前提となる初期リソース（WIF、GCS バケット、GitHub Secrets）を構築するモジュールです。

- **実行タイミング**: `./scripts/setup.sh` の Phase 3 で実行される
- **Backend**: local backend を使用（GCS バケットは bootstrap で作成される）
- **主なリソース**: デプロイ用 SA、WIF プール/プロバイダー、tfstate 用 GCS バケット、`gh secret set` による GitHub Secrets 登録

詳細は [デプロイガイド](../../docs/deploy/deployment.md) および `./scripts/setup.sh` を参照してください。

---
## 0. 変数ファイルの準備
```bash
cp terraform.tfvars.example terraform.tfvars
# 必ず編集:
# - project_id
# - db_password（強固な値）
```

---
## 1. 初回セットアップ（必要最小限）
1) 初期化とPlan
```bash
cd infra/terraform
terraform init
terraform plan
```
2) APIの有効化（初回のみ）
```bash
terraform apply -target=google_project_service.apis -auto-approve
```
3) 段階適用（都度Planの内容を確認）
```bash
# 1) ネットワーク
terraform apply -auto-approve -target=google_compute_network.vpc -target=google_compute_subnetwork.subnet
# 2) Private Service Connect
terraform apply -auto-approve -target=google_compute_global_address.private_service_range -target=google_service_networking_connection.private_vpc_connection
# 3) Cloud SQL（⚠️ 作成に約10〜15分かかります）
terraform apply -auto-approve -target=google_sql_database_instance.db
```
3.5) コンテナイメージのビルド/プッシュ（Cloud Run作成前に1回）
```bash
cd <repo-root>
export PROJECT_ID=<your-project-id>
# 必要なら REGION（既定: asia-northeast1）
# export REGION=asia-northeast1
bash infra/terraform/scripts/build-push.sh
```
4) 残り（Cloud Run / SA など）
```bash
cd infra/terraform
terraform apply
```
補足: 実運用はGitHub Actionsに委譲します。ここはブートストラップ時のみ使用。

---

## 3.5. 既存リソースのインポート（初回のみ）

既存のGCPリソースが存在する場合、Terraform stateにインポートする必要があります。

**エラー例**:
```
Error: Error creating Repository: googleapi: Error 409: the repository already exists
Error: Error creating Secret: googleapi: Error 409: Secret [...] already exists
```

**インポート手順**:

```bash
cd infra/terraform

# プロジェクトIDとリージョンを設定
PROJECT_ID=<your-project-id>
REGION=asia-northeast1

# Artifact Registry リポジトリ
terraform import google_artifact_registry_repository.repo projects/${PROJECT_ID}/locations/${REGION}/repositories/ax-repo

# Secret Manager シークレット（prefixがaxの場合）
terraform import google_secret_manager_secret.database_url projects/${PROJECT_ID}/secrets/ax-database-url

# サービスアカウント
terraform import google_service_account.server projects/${PROJECT_ID}/serviceAccounts/ax-server-sa@${PROJECT_ID}.iam.gserviceaccount.com
terraform import google_service_account.client projects/${PROJECT_ID}/serviceAccounts/ax-client-sa@${PROJECT_ID}.iam.gserviceaccount.com
terraform import google_service_account.migrate projects/${PROJECT_ID}/serviceAccounts/ax-mig-sa@${PROJECT_ID}.iam.gserviceaccount.com

# ネットワーク
terraform import google_compute_network.vpc projects/${PROJECT_ID}/global/networks/ax-vpc
terraform import google_compute_global_address.lb_ip projects/${PROJECT_ID}/global/addresses/ax-lb-ip

# その他の既存リソースも同様にインポート
# terraform import <resource_type>.<resource_name> <resource_id>
```

**確認**:
```bash
terraform plan
# インポート成功後は、既存リソースに関するエラーが消え、差分のみが表示されます
```

---
## 2. 疎通確認
```bash
cd <repo-root>
bash infra/terraform/scripts/verify.sh
```

---
## 3. DBマイグレーション（Cloud Run Job）
- Private IP運用のため、Cloud Run Job `ax-db-migrate` で `DATABASE_URL`(Secret) を参照して `prisma migrate deploy` を実行します。
```bash
# 作成後に1回実行（イメージpush → terraform apply 済みであること）
PROJECT_ID=<your-project-id>
REGION=asia-northeast1
JOB=$(terraform -chdir=infra/terraform output -raw migrate_job_name)

gcloud run jobs execute "$JOB" --region "$REGION" --project "$PROJECT_ID"
```

---
## スクリプト一覧
- 段階適用: `infra/terraform/scripts/infra-apply-staged.sh`
- ビルド/プッシュ: `PROJECT_ID=xxx infra/terraform/scripts/build-push.sh`
- 疎通確認: `infra/terraform/scripts/verify.sh`

---
## Cloud SQL / Prisma
- DB接続文字列は `Secret Manager` の `${prefix}-database-url`（デフォルト: `ax-database-url`）に格納され、Cloud Run(server)へ `DATABASE_URL` として注入されます。
- Private IPのみのため、DBマイグレーションはCloud Run Jobでの実行を推奨します（上記の 3 を参照）。

---
## 補足
- `API_BASE_URL` は client の Cloud Run に server の内部 URL が自動注入されます（VPC 内部経由でアクセス）。

---
## 6. ネットワーク構成とロードバランサー

### アーキテクチャ概要

本テンプレートは以下のネットワーク構成を採用しています：

```
インターネット
    ↓
外部HTTP(S)ロードバランサー（グローバルIP）
    ↓
client (Cloud Run) - ingress: INTERNAL_LOAD_BALANCER
    ↓ VPC Connector
server (Cloud Run) - ingress: INTERNAL_ONLY（内部専用）
    ↓
Cloud SQL (Private IP)
```

### Cloud Run の ingress 設定

- **client**: `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER`
  - ロードバランサー経由でのみアクセス可能
  - 直接の外部アクセスは不可
  - ロードバランサー経由では認証不要（公開アクセス許可）

- **server**: `INGRESS_TRAFFIC_INTERNAL_ONLY`
  - VPC 内部からのみアクセス可能（Client の SSR 用）
  - IAM ポリシー: `ax-client-sa` に `run.invoker` 権限（Client からのアクセス用）
  - ロードバランサー経由では公開されていない（Client が `API_BASE_URL` で直接 Server の Cloud Run URL を使用）

### ロードバランサー構成

- **種類**: 外部 HTTP(S) ロードバランサー（Application Load Balancer）
- **ルーティング**:
  - すべてのパス → client バックエンド（server は内部専用のため公開しない）
- **IP**: グローバル静的IP（`ax-lb-ip`）
- **HTTPS**: オプション（`enable_ssl=true` で有効化、マネージドSSL証明書）

### ロードバランサーの出力

```bash
# ロードバランサーのIPアドレス
terraform output load_balancer_ip

# ロードバランサーのURL
terraform output load_balancer_url
```

### 環境変数の自動注入

- `SERVER_INTERNAL_URL`: Server の Cloud Run 直接 URL が client の環境変数に自動注入されます（Terraform で設定）
- `API_BASE_URL`: client 側では VPC 内部通信のため、Server の Cloud Run URL を直接使用

### SSL証明書とドメイン設定（オプション）

HTTPSを有効化する場合：

```hcl
# terraform.tfvars
enable_ssl = true
load_balancer_domain = "example.com"
```

マネージドSSL証明書は有効化まで最大15分程度かかります。

**詳細な設定手順:** [ドメイン設定ガイド](./docs/domain-setup.md) を参照してください。

---
## 4. 環境別CI/CD（GitHub Actions）

- 本リポジトリは、環境ごとに「認証/WIF・State・tfvars」を分離する運用を想定しています。
- CI からの `terraform init` は GCS Backend を利用します（providers.tf を `backend "gcs" {}` に変更済み）。

### ⚠️ Workload Identity の重要な注意点

**Workload Identity Pool/Provider は必ずプロジェクト（リポジトリ）ごとに固有の名前を使用してください。**

#### 問題の背景

Workload Identity Provider の `attribute-condition` はプロバイダーレベルで設定されます。複数のリポジトリで同じプール/プロバイダーを共有すると、後から実行したリポジトリの条件で上書きされ、他のリポジトリのCI/CDが失敗します。

```
リポジトリA → attribute.repository=='org/repo-A' 設定
リポジトリB → attribute.repository=='org/repo-B' に上書き ❌
結果: リポジトリAのGitHub Actionsが認証失敗
```

#### 推奨される命名規則

```bash
# プロジェクト名を含む固有の名前を使用
POOL_ID=github-{project-name}
PROVIDER_ID=github-oidc-{project-name}

# 例: ax-saas-template プロジェクトの場合
POOL_ID=github-ax-saas-template
PROVIDER_ID=github-oidc-ax-saas-template
```

#### WIF セットアップコマンド例

```bash
PROJECT_ID=your-project-id \
ORG_REPO="your-org/your-repo" \
POOL_ID=github-myproject \
PROVIDER_ID=github-oidc-myproject \
BUCKET_STG=tfstate-myproject-stg \
BUCKET_PRD=tfstate-myproject-prd \
./infra/terraform/scripts/bootstrap-wif.sh
```

### 初回セットアップ手順

初回のみ（プロジェクトごとに実施）
- GCS バケットを作成し、バージョニング有効化
```bash
gsutil mb -l asia-northeast1 gs://<tfstate-bucket-stg>
gsutil mb -l asia-northeast1 gs://<tfstate-bucket-prd>
gsutil versioning set on gs://<tfstate-bucket-stg>
gsutil versioning set on gs://<tfstate-bucket-prd>
```
- WIF Provider とデプロイ用 SA を stg/prod で作成（上記コマンド参照）
- `infra/terraform/stg.tfvars` / `prod.tfvars` を用意
```hcl
project_id = "your-stg-project-id"
region     = "asia-northeast1"
db_password = "強固なパスワード"
```

GitHub Actions（標準運用）
- main → ステージングに自動デプロイ（`.github/workflows/deploy-stg.yml`）
- タグ`v*` → 本番に自動デプロイ（`.github/workflows/deploy-prod.yml`）
- 必要なSecretsは [GitHub Secrets 設定](../../docs/deploy/github-secrets-setup.md) を参照

ポイント（重要）
- Cloud Run の `image` は「タグ」ではなく「ダイジェスト」で固定し、Artifact Registry の latest 更新を差分として `terraform apply` が新Revisionを作るようにしています。
- 画像のビルド/プッシュは `infra/terraform/scripts/build-push.sh` を CI から呼び出します（server/client をビルド・プッシュ）。

---
## 5. トラブルシュート（要点）

- 最終デプロイ日が更新されない
  - 原因: Cloud Run の `image` をタグで指定すると差分として検出されないことがある
  - 対応: ダイジェスト指定（本リポジトリは対応済み）/ 一時的に `terraform apply -replace=google_cloud_run_v2_service.<service>`
- DB マイグレーションが失敗する
  - `gcloud run jobs executions list --region <region> --project <project>` でログを確認
  - `DATABASE_URL` Secret の値/権限、VPC Connector、Private IP を確認
- Artifact Registry への push が失敗する
  - `gcloud auth configure-docker <region>-docker.pkg.dev` を実行
  - WIF/SA の権限（Artifact Registry Writer）を確認
- ロードバランサー経由でアクセスできない
  - ロードバランサーのプロビジョニング完了を確認（数分かかる場合あり）
  - `terraform output load_balancer_ip` でIPアドレスを確認
  - Cloud Run サービスが `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER` に設定されているか確認
