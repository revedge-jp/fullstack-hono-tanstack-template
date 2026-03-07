# GitHub Secrets 設定ガイド

このドキュメントでは、GitHub Secretsの設定方法を説明します。

## 必要なSecrets一覧

### STG環境（ステージング）

| Secret名 | 説明 | 例 |
|---------|------|-----|
| `STG_GCP_PROJECT_ID` | デプロイ先GCPプロジェクトID | `my-project-stg` |
| `STG_WIF_PROVIDER` | WIF Providerのフルリソース名 | `projects/123456789/locations/global/workloadIdentityPools/github/providers/github-oidc` |
| `STG_WIF_SA` | CIからTerraform/デプロイを実行するSA | `ci-deployer@my-project-stg.iam.gserviceaccount.com` |
| `STG_TFSTATE_BUCKET` | TerraformのGCSバックエンド用バケット名（`gs://`なし） | `tfstate-my-project-stg` |
| `STG_DB_PASSWORD` | 初回ブートストラップ用DBパスワード | （強固なパスワード） |

### PRD環境（本番）

| Secret名 | 説明 | 例 |
|---------|------|-----|
| `PRD_GCP_PROJECT_ID` | デプロイ先GCPプロジェクトID | `my-project-prd` |
| `PRD_WIF_PROVIDER` | WIF Providerのフルリソース名 | `projects/987654321/locations/global/workloadIdentityPools/github/providers/github-oidc` |
| `PRD_WIF_SA` | CIからTerraform/デプロイを実行するSA | `ci-deployer@my-project-prd.iam.gserviceaccount.com` |
| `PRD_TFSTATE_BUCKET` | TerraformのGCSバックエンド用バケット名（`gs://`なし） | `tfstate-my-project-prd` |
| `PRD_DB_PASSWORD` | 初回ブートストラップ用DBパスワード | （強固なパスワード） |

**注意**: `*_DB_PASSWORD`は初回ブートストラップ後に削除可能です（Secret Managerの`database-url`が作成されれば不要）。

## 設定方法

### 方法1: GitHub CLIを使用（推奨）

GitHub CLIがインストールされている場合、以下のコマンドで一括設定できます：

```bash
# GitHub CLIでログイン（未ログインの場合）
gh auth login

# リポジトリを確認
gh repo view

# STG環境のSecretsを設定
gh secret set STG_GCP_PROJECT_ID --body "your-stg-project-id"
gh secret set STG_WIF_PROVIDER --body "projects/YOUR_PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github-oidc"
gh secret set STG_WIF_SA --body "ci-deployer@your-stg-project-id.iam.gserviceaccount.com"
gh secret set STG_TFSTATE_BUCKET --body "tfstate-your-stg-project"
gh secret set STG_DB_PASSWORD --body "$(openssl rand -base64 24)"

# PRD環境のSecretsを設定
gh secret set PRD_GCP_PROJECT_ID --body "your-prd-project-id"
gh secret set PRD_WIF_PROVIDER --body "projects/YOUR_PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github-oidc"
gh secret set PRD_WIF_SA --body "ci-deployer@your-prd-project-id.iam.gserviceaccount.com"
gh secret set PRD_TFSTATE_BUCKET --body "tfstate-your-prd-project"
gh secret set PRD_DB_PASSWORD --body "$(openssl rand -base64 24)"

# 設定確認
gh secret list
```

### 方法2: Web UIを使用

1. GitHubリポジトリのページにアクセス
2. **Settings** → **Secrets and variables** → **Actions** を開く
3. **New repository secret** をクリック
4. 各Secretを設定

## WIF (Workload Identity Federation) の設定

### 方法A: setup.sh による自動設定（推奨）

`./scripts/setup.sh` を環境ごとに実行すると、Phase 3 で `infra/terraform/bootstrap/` の Terraform が実行され、以下が自動で作成・設定されます：

- デプロイ用サービスアカウント
- WIF プール・プロバイダー
- GCS バケット（tfstate 用）
- **GitHub Variables**（`bootstrap/github-secrets.tf` 内の `gh variable set` により登録）

`./scripts/setup.sh` を使う場合、GitHub Secrets の手動登録は不要です。詳細は [デプロイガイド](deployment.md#方法1-setupsh-による一括セットアップ推奨) を参照してください。

### 方法B: 手動設定（bootstrap-wif.sh）

WIF Provider とサービスアカウントを手動で作成する場合、`infra/terraform/scripts/bootstrap-wif.sh` を使用できます：

```bash
# 事前準備：gcloudで認証
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# WIF設定を作成
cd infra/terraform/scripts
bash bootstrap-wif.sh

# 出力されたWIF_PROVIDERとWIF_SAをGitHub Secretsに設定
```

## Terraform State バケットの作成

```bash
PROJECT_ID=your-project-id
REGION=asia-northeast1
BUCKET_NAME=tfstate-${PROJECT_ID}

# バケット作成
gsutil mb -l ${REGION} gs://${BUCKET_NAME}

# バージョニング有効化（推奨）
gsutil versioning set on gs://${BUCKET_NAME}
```

## 設定後の確認

設定が正しいか確認するには、GitHub Actionsのワークフローを手動実行して確認できます：

1. GitHubリポジトリの **Actions** タブを開く
2. **deploy-stg** ワークフローを選択
3. **Run workflow** をクリックして手動実行
4. ログを確認して、Secretsが正しく読み込まれているか確認

## トラブルシュート

### Secretが見つからないエラー

- Secret名のスペルミスを確認（大文字小文字も含む）
- リポジトリのSettingsでSecretsが正しく設定されているか確認
- ワークフローファイルで参照しているSecret名と一致しているか確認

### WIF認証エラー

- `*_WIF_PROVIDER`の値が正しいか確認（プロジェクト番号が正しいか）
- `*_WIF_SA`のサービスアカウントが存在するか確認
- WIF Providerが正しく設定されているか確認（`./scripts/setup.sh` または `bootstrap-wif.sh` を実行済みか）
- GitHub Actionsからのアクセスが許可されているか確認

### Terraform stateバケットエラー

- `*_TFSTATE_BUCKET`の値に`gs://`が含まれていないか確認（バケット名のみ）
- バケットが存在するか確認
- CI SAにバケットへのアクセス権限があるか確認

### DBパスワードエラー

- 初回デプロイでは`*_DB_PASSWORD`が必要
- 2回目以降はSecret Managerの`database-url`から自動取得されるため不要
- パスワードに特殊文字が含まれる場合、URLエンコードが必要な場合がある

## 関連ドキュメント

- [デプロイガイド](deployment.md) - デプロイフローの全体像
- [インフラ詳細](../infra/terraform/README.md) - Terraformの詳細
- [ローカルCI/CDテスト](../dev/ci-local-testing.md) - ローカルでのテスト方法
