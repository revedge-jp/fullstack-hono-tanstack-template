# Sandbox環境でのデプロイテストガイド

sandbox環境（GCPプロジェクト）で`deploy-stg.yml`のワークフロー全体を検証する方法です。

## コスト見積もり

### 基本コスト（リソースが動いている限り）

- **Cloud SQL (db-f1-micro)**: 月額約$7-10
- **VPC Connector (e2-micro)**: 月額約$10
- **Cloud Run**: 従量課金（無料枠: 月200万リクエストまで）
- **Artifact Registry**: 無料枠あり（ストレージ50GBまで）

**合計: 月額約$20-30程度**（リソースが常時稼働している場合）

### 無料枠の活用

- Cloud Runは使用量が少なければ無料枠内
- Artifact Registryのストレージも無料枠内

### コスト削減のポイント

1. **テスト後はリソースを削除**
   ```bash
   cd infra/terraform
   terraform destroy
   ```

2. **Cloud SQLを停止**（再起動に時間がかかる）
   ```bash
   gcloud sql instances patch ax-db --activation-policy=NEVER
   # 再開時
   gcloud sql instances patch ax-db --activation-policy=ALWAYS
   ```

3. **予算アラートを設定**
   - GCP Console → 予算とアラート
   - 月額$50程度でアラートを設定

## ローカル検証（推奨）

実際のリソースを作成する前に、各ステップを検証：

```bash
# 環境変数を設定
export PROJECT_ID=your-sandbox-project-id
export REGION=asia-northeast1
export TFSTATE_BUCKET=your-tfstate-bucket-name

# 各ステップを検証（リソースは作成しない）
bash scripts/ci-cd/deploy-steps.sh
```

このスクリプトは以下を確認します：
- Dockerビルド（pushなし）
- Terraform plan（dry-run）
- gcloud認証とプロジェクト設定
- TF stateバケットの存在
- 必要なAPIの有効状態

## Sandbox環境での実際のデプロイテスト

### 前提条件

1. **GCPプロジェクトの準備**
   ```bash
   # プロジェクトを設定
   gcloud config set project ${PROJECT_ID}
   
   # 課金が有効になっていることを確認
   gcloud billing projects describe ${PROJECT_ID}
   ```

2. **必要な権限**
   - Owner または Editor 権限
   - Service Account作成権限
   - リソース作成権限

3. **Secretsの設定**
   - GitHub Secretsまたはローカル環境変数として設定

### ステップ1: ビルドテスト（ローカル）

```bash
# ビルドのみテスト（pushはしない）
bash scripts/ci-cd/build-local.sh
```

### ステップ2: ビルド&プッシュ（実際のリソース使用）

```bash
# 実際にArtifact Registryにpush
export PROJECT_ID=your-sandbox-project-id
export REGION=asia-northeast1
bash infra/terraform/scripts/build-push.sh
```

**コスト**: Artifact Registryのストレージ（無料枠内なら無料）

### ステップ3: Terraform Plan（dry-run）

```bash
cd infra/terraform

# 初期化
BUCKET_NAME=your-tfstate-bucket
terraform init \
  -backend-config="bucket=${BUCKET_NAME}" \
  -backend-config="prefix=stg/terraform.tfstate"

# Plan（実際には作成しない）
terraform plan \
  -var="project_id=${PROJECT_ID}" \
  -var="region=${REGION}" \
  -var="db_password=$(openssl rand -base64 32)"
```

**コスト**: なし（dry-run）

### ステップ4: 段階的なApply（推奨）

リソースを段階的に作成して、問題があれば早期に発見：

```bash
# 1. APIの有効化（無料）
terraform apply -target=google_project_service.apis -auto-approve

# 2. ネットワーク（無料）
terraform apply \
  -target=google_compute_network.vpc \
  -target=google_compute_subnetwork.subnet

# 3. Private Service Connect（無料）
terraform apply \
  -target=google_compute_global_address.private_service_range \
  -target=google_service_networking_connection.private_vpc_connection

# 4. Cloud SQL（有料: ~$7-10/月）
# 注意: 作成に10-15分かかります
terraform apply -target=google_sql_database_instance.db

# 5. 残りのリソース（Cloud Run など）
terraform apply
```

または、段階適用スクリプトを使用：

```bash
bash infra/terraform/scripts/infra-apply-staged.sh
```

### ステップ5: マイグレーションテスト

```bash
# マイグレーションJobを実行
JOB=$(terraform -chdir=infra/terraform output -raw migrate_job_name)
gcloud run jobs execute "$JOB" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --wait
```

**コスト**: Cloud Run Jobの実行時間に応じた従量課金（通常は無料枠内）

### ステップ6: ロールアウトテスト

```bash
cd infra/terraform

# 新しいリビジョンを強制的に作成
terraform apply \
  -var="project_id=${PROJECT_ID}" \
  -var="region=${REGION}" \
  -var="server_env={BUILD_SHA=\"test\"}" \
  -var="client_env={BUILD_SHA=\"test\"}" \
  -auto-approve
```

## 完全なワークフローの再現

GitHub Actionsのワークフロー全体をローカルで再現するのは難しいですが、各ステップを順に実行することで同等の検証が可能です：

```bash
# 1. ビルド&プッシュ
export PROJECT_ID=your-sandbox-project-id
export REGION=asia-northeast1
bash infra/terraform/scripts/build-push.sh

# 2. Terraform Apply
cd infra/terraform
terraform apply -auto-approve

# 3. マイグレーション
JOB=$(terraform output -raw migrate_job_name)
gcloud run jobs execute "$JOB" --region "${REGION}" --project "${PROJECT_ID}" --wait

# 4. ロールアウト
terraform apply \
  -var="server_env={BUILD_SHA=\"$(git rev-parse HEAD)\"}" \
  -auto-approve
```

## クリーンアップ（重要）

テストが終わったら、リソースを削除してコストを節約：

```bash
cd infra/terraform

# 確認してから削除（慎重に）
terraform plan -destroy

# 実際に削除
terraform destroy -auto-approve
```

## トラブルシューティング

### ビルドが失敗する

```bash
# ローカルでビルドテスト
bash scripts/ci-cd/build-local.sh
```

### Terraform Applyが失敗する

```bash
# 段階的に適用して問題箇所を特定
bash infra/terraform/scripts/infra-apply-staged.sh
```

### コストが予想以上に高い

```bash
# リソースの使用状況を確認
gcloud billing budgets list --billing-account=YOUR_BILLING_ACCOUNT

# 予算アラートを設定
# GCP Console → 予算とアラート → 予算を作成
```

## 推奨ワークフロー

1. **コード変更前**: ローカルビルドテスト
   ```bash
   bash scripts/ci-cd/build-local.sh
   ```

2. **デプロイ前**: 各ステップを検証
   ```bash
   bash scripts/ci-cd/deploy-steps.sh
   ```

3. **初回デプロイ**: 段階的に適用
   ```bash
   bash infra/terraform/scripts/infra-apply-staged.sh
   ```

4. **通常のデプロイ**: GitHub Actionsに任せる
   - mainブランチへのpushで自動デプロイ

5. **テスト後**: リソースを削除（必要に応じて）
   ```bash
   terraform destroy
   ```

