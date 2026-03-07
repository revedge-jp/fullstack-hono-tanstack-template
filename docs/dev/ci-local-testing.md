# ローカルCI/CDテストガイド

GitHub Actionsのワークフローをローカルで検証する方法と、sandbox環境での実際のデプロイテスト方法です。

## 関連ドキュメント

- **sandbox環境でのテスト**: `docs/dev/ci-sandbox-test.md` - 実際のGCPリソースを使った検証方法
- **actでのローカルテスト**: このドキュメント（制限あり）

# act でのローカルCIテスト

GitHub Actionsのワークフローをローカルで実行するためのガイドです。

## 前提条件

1. [act](https://github.com/nektos/act) をインストール
   ```bash
   # macOS
   brew install act
   
   # または公式のインストール方法に従う
   ```

2. Docker Desktop が起動していること

## 制限事項

`deploy-stg.yml`のようなデプロイワークフローは、以下の理由で完全に再現できません：

- GCP認証（Workload Identity Federation）が必要
- Artifact Registryへのpushが必要
- Terraformの実行が必要

そのため、**ビルドステップのみ**をローカルでテストすることを推奨します。

## ビルドテスト（推奨）

CIのビルド部分だけをローカルでテストする場合は、専用スクリプトを使用：

```bash
# 環境変数の設定（必要に応じて）
export REGION=asia-northeast1
export PROJECT_ID=local-test
export PLATFORM=linux/amd64

# ビルドテスト実行
bash scripts/ci-cd/build-local.sh
```

このスクリプトは：
- `apps/api-service/Dockerfile` をビルド
- `apps/client/Dockerfile` をビルド
- レジストリへのpushは行わない（`--load`でローカルイメージとして保存）

## act を使用したワークフロー実行

完全なワークフローをテストする場合（一部のジョブのみ可能）：

```bash
# 特定のジョブのみ実行（build-pushジョブなど）
act push \
  --job build-push \
  --env REGION=asia-northeast1 \
  --env PROJECT_ID=local-test \
  --secret-file .act-secrets \
  --container-architecture linux/amd64

# すべてのジョブを実行（警告: 実際のGCPリソースへのアクセスは失敗します）
act push \
  --secret-file .act-secrets \
  --container-architecture linux/amd64
```

## Secrets の設定

`.act-secrets` ファイルを作成（`.gitignore`に追加推奨）：

```bash
# 例: .act-secrets
STG_GCP_PROJECT_ID=local-test
STG_WIF_PROVIDER=dummy
STG_WIF_SA=dummy
STG_DB_PASSWORD=dummy
STG_TFSTATE_BUCKET=dummy
```

## 実際のデプロイ前の確認

本番デプロイ前に確実にビルドが通ることを確認：

```bash
# 1. ローカルビルドテスト
bash scripts/ci-cd/build-local.sh

# 2. CIでのlint/typecheckをローカルで実行
bun run check-all

# 3. 実際のCI/CDパイプラインで確認
# GitHub Actionsでmainブランチにpush
```

## トラブルシューティング

### Docker buildx の問題

```bash
# buildx builderを再作成
docker buildx rm ax-builder || true
docker buildx create --use --name ax-builder
```

### Prisma Client の生成エラー

ローカルで事前に生成：

```bash
cd packages/database
bun run db:generate
```

### act が遅い場合

actはDockerコンテナ内で実行するため、初回は時間がかかります。
キャッシュを活用するため、`--container-architecture linux/amd64`を指定してください。

