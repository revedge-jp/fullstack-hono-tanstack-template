# CI/CD ローカルテスト

CI/CDワークフローをローカルで検証するためのスクリプトとドキュメントをまとめています。

## スクリプト

- **`build-local.sh`**: Dockerビルドをローカルでテスト（pushはしない）
- **`deploy-steps.sh`**: デプロイワークフローの各ステップを検証

## ドキュメント

- **`local-testing.md`**: act を使ったローカルテスト方法（`docs/dev/ci-local-testing.md`）
- **`sandbox-test.md`**: sandbox環境での実際のデプロイテスト方法（`docs/dev/ci-sandbox-test.md`）

## セットアップ

### 前提条件

1. **必要なツール**
   - Docker Desktop が起動していること
   - `gcloud` CLI がインストール済み
   - `terraform` がインストール済み
   - `gsutil` がインストール済み（gcloudと一緒にインストールされる）

2. **GCP認証の設定**

```bash
# 1. ユーザー認証（ブラウザで認証）
gcloud auth login

# 2. Application Default Credentials（Terraform用）
gcloud auth application-default login

# 3. Docker認証（Artifact Registry用）
gcloud auth configure-docker asia-northeast1-docker.pkg.dev
```

3. **環境変数の設定**

```bash
# 必須環境変数
export PROJECT_ID=your-project-id          # GCPプロジェクトID
export REGION=asia-northeast1              # リージョン（デフォルト値あり）
export TFSTATE_BUCKET=your-tfstate-bucket  # Terraform stateバケット名（gs://なし）

# オプション
export BUILD_SHA=$(git rev-parse HEAD)     # デフォルトは現在のHEAD
```

### 設定ファイル（推奨）

`.env.deploy` ファイルを作成して環境変数を管理できます。
ファイルは以下のいずれかの場所に配置できます（優先順位順）：
1. ルートディレクトリの `.env.deploy`
2. `scripts/ci-cd/env.deploy`

```bash
# 設定例ファイルをコピー（どちらかの場所に）
cp scripts/ci-cd/env.deploy.example .env.deploy
# または
cp scripts/ci-cd/env.deploy.example scripts/ci-cd/env.deploy

# 実際の値を設定
# .env.deploy を編集して PROJECT_ID と TFSTATE_BUCKET を設定
```

使用する場合：

```bash
# スクリプトが自動的に .env.deploy を読み込みます
bash scripts/ci-cd/deploy-steps.sh
```

**注意**: `.env.deploy` は `.gitignore` に追加されています（機密情報を含む可能性があるため）

## 使用方法

### ビルドテスト

```bash
bash scripts/ci-cd/build-local.sh
```

### デプロイステップ検証

```bash
# 環境変数を設定
export PROJECT_ID=your-project-id
export REGION=asia-northeast1
export TFSTATE_BUCKET=your-tfstate-bucket

# スクリプトを実行
bash scripts/ci-cd/deploy-steps.sh
```

このスクリプトは以下を検証します：
- Dockerビルド（pushなし）
- Terraform plan（dry-run）
- gcloud認証とプロジェクト設定
- TF stateバケットの存在確認
- 必要なAPIの有効状態確認
- マイグレーションJobの存在確認（リソースがデプロイ済みの場合）
- ロールアウトのplan検証（リソースがデプロイ済みの場合）

詳細は `docs/dev/` 配下のドキュメント（`ci-local-testing.md`, `ci-sandbox-test.md`）を参照してください。

