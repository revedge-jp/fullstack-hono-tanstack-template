# インフラストラクチャ構成ガイド

このドキュメントでは、Terraform と GitHub Actions によるインフラ構築の全体像と詳細な構成について説明します。

## 目次

- [アーキテクチャ概要](#アーキテクチャ概要)
- [GCP リソース構成](#gcp-リソース構成)
- [Terraform 構成](#terraform-構成)
- [GitHub Actions ワークフロー](#github-actions-ワークフロー)
- [CI/CD パイプライン詳細](#cicd-パイプライン詳細)
- [セキュリティ設計](#セキュリティ設計)
- [監視・アラート](#監視アラート)
- [環境分離](#環境分離)

---

## アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Internet                                    │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │   Global Load Balancer    │
                    │   (HTTP/HTTPS)            │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │   Cloud Run: Client       │
                    │   (Next.js SSR)           │
                    │   INGRESS: INTERNAL_LB    │
                    └─────────────┬─────────────┘
                                  │ VPC Connector
                    ┌─────────────▼─────────────┐
                    │   Cloud Run: Server       │
                    │   (Hono API)              │
                    │   INGRESS: INTERNAL_ONLY  │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │  Cloud SQL                │
                    │  (PostgreSQL)              │
                    │  Private IP               │
                    └───────────────────────────┘
```

### 主要コンポーネント

| コンポーネント | 説明 | 主要技術 |
|--------------|------|---------|
| Client | フロントエンド（SSR） | Next.js 15, React 19 |
| Server | バックエンドAPI | Hono, Prisma |
| Database | データ永続化 | Cloud SQL (PostgreSQL 18) |

---

## GCP リソース構成

### ネットワーク

```hcl
# VPC Network
google_compute_network.vpc
├── Serverless VPC Access Connector
│   └── Cloud Run → Cloud SQL 接続
└── Private Service Connection
    └── Cloud SQL Private IP
```

| リソース | 名前パターン | 用途 |
|---------|-------------|------|
| VPC | `{prefix}-vpc` | プライベートネットワーク |
| Subnet | `{prefix}-subnet` | 10.10.0.0/24 |
| VPC Connector | `{prefix}-vpc-c` | Cloud Run → VPC 接続 |
| Private Service Range | `{prefix}-private-service-range` | Cloud SQL 用 |

### Cloud Run サービス

| サービス | 名前パターン | Ingress 設定 | 認証 | Startup Probe |
|---------|-------------|-------------|------|--------------|
| Server | `{prefix}-server` | INTERNAL_ONLY | Client SA（VPC内部経由） | `GET /api/health/live`（DB非依存） |
| Client | `{prefix}-client` | INTERNAL_LOAD_BALANCER | allUsers | - |
| DB Migrate | `{prefix}-db-migrate` | - (Job) | - | - |

> **deletion_protection**: Server・Client ともにデフォルト `true`（`cloud_run_deletion_protection` 変数で制御）。解除には `false` に変更して apply が必要。

### Cloud SQL

| 設定 | デフォルト値 | 本番推奨値 |
|-----|-------------|-----------|
| Tier | `db-f1-micro` | `db-n1-standard-1` 以上 |
| Availability | `ZONAL` | `REGIONAL` |
| Disk Type | `PD_HDD` | `PD_SSD` |
| Backup | 無効 | 有効 + PITR |
| SSL Mode | `ENCRYPTED_ONLY`（固定） | - |

CA 証明書は Secret Manager（`{prefix}-cloudsql-server-ca`）に自動保存され、Cloud Run コンテナに `/secrets/cloudsql/server-ca.pem` としてボリュームマウントされます。`DATABASE_URL` には `sslmode=require&uselibpqcompat=true&sslrootcert=/secrets/cloudsql/server-ca.pem` が自動付与されます。

### IAM サービスアカウント

```
{prefix}-server-sa  → Server 実行用
{prefix}-client-sa  → Client 実行用
{prefix}-mig-sa     → DB Migration Job 用
```

### Secret Manager

| シークレット | 用途 | 管理方法 |
|-------------|------|---------|
| `{prefix}-database-url` | DB接続文字列（SSL パラメータ含む） | `secret-sync-db-url.sh` |
| `{prefix}-cloudsql-server-ca` | Cloud SQL サーバー CA 証明書 | Terraform 自動管理 |

---

## Terraform 構成

### ディレクトリ構造

```
infra/terraform/
├── providers.tf          # Provider設定（Google ~> 5.27）
├── variables.tf          # 入力変数定義
├── locals.tf             # ローカル変数（リソース名生成）
├── outputs.tf            # 出力値
├── apis.tf               # GCP API 有効化
├── network.tf            # VPC, Subnet, VPC Connector
├── cloud-sql.tf          # Cloud SQL インスタンス
├── cloud-run.tf          # Cloud Run サービス
├── cloud-run-job.tf      # Cloud Run Job（マイグレーション）
├── iam.tf                # サービスアカウント・IAM
├── load-balancer.tf      # GLB, SSL 証明書
├── artifact-registry.tf  # コンテナレジストリ
├── identity-platform.tf  # Firebase Authentication（オプション）
├── monitoring.tf         # 監視・アラート設定
├── terraform.tfvars.example  # 設定例
└── scripts/
    ├── bootstrap-wif.sh      # WIF 初期設定
    ├── build-push.sh         # イメージビルド・プッシュ
    ├── terraform-apply.sh    # Terraform 適用（安全機構付き）
    ├── run-migration.sh      # DBマイグレーション実行
    ├── secret-sync-db-url.sh # DB URL シークレット同期
    ├── infra-apply-staged.sh # 初回インフラ構築
    └── verify.sh             # 検証スクリプト
```

### Backend 設定

```hcl
# GCS Backend（環境別に prefix で分離）
terraform {
  backend "gcs" {}  # 動的設定
}

# CI での初期化
terraform init -backend-config="bucket=${BUCKET}" \
               -backend-config="prefix=stg/terraform.tfstate"
```

### 変数設計

#### 必須変数

| 変数 | 説明 |
|-----|------|
| `project_id` | GCP プロジェクト ID |
| `prefix` | リソース名プレフィックス（2-20文字） |
| `db_password` | Cloud SQL パスワード |

#### 環境別設定変数

```hcl
# 本番環境向け設定例
db_tier                           = "db-n1-standard-1"
db_availability_type              = "REGIONAL"
db_disk_type                      = "PD_SSD"
db_backup_enabled                 = true
db_point_in_time_recovery_enabled = true
enable_ssl                        = true
load_balancer_domain              = "example.com"  # SSL証明書の発行対象ドメイン
```

#### セキュリティ関連変数

| 変数 | デフォルト | 説明 |
|-----|----------|------|
| `enable_cloud_armor` | `true` | Cloud Armor WAF + レートリミット（Standard は無料） |
| `cloud_armor_rate_limit_count` | `100` | レートリミット上限（リクエスト数/インターバル） |
| `cloud_armor_rate_limit_interval` | `60` | レートリミットのインターバル（秒） |
| `enable_iam_change_alert` | `true` | IAM ポリシー変更検知アラート（要 `roles/logging.configWriter`） |
| `cloud_run_deletion_protection` | `true` | Cloud Run サービスの誤削除防止 |
| `enable_ssl` | `false` | HTTPS + マネージド SSL 証明書の有効化 |
| `load_balancer_domain` | `""` | SSL 証明書の発行ドメイン（`enable_ssl=true` 時に必須） |

### 安全機構

#### 1. 大量削除の防止

`terraform-apply.sh` は、削除予定リソース数が閾値（デフォルト5）を超えると停止します。

```bash
# 閾値を上げて実行する場合
MAX_DESTROY_THRESHOLD=100 ./terraform-apply.sh
```

#### 2. PREFIX 検証

ワークフロー内で PREFIX が正しく設定されているか検証し、誤った PREFIX による全リソース再作成を防止します。

#### 3. prevent_destroy

重要リソース（Cloud SQL）には `prevent_destroy = true` を設定。

---

## GitHub Actions ワークフロー

### ワークフロー一覧

| ワークフロー | ファイル | トリガー | 用途 |
|------------|---------|---------|------|
| CI Pipeline | `ci.yml` | push/PR to main | 品質チェック |
| Deploy STG | `deploy-stg.yml` | 手動 (将来: CI成功後) | ステージングデプロイ |
| Deploy PROD | `deploy-prod.yml` | 手動 | 本番デプロイ |

### CI パイプライン詳細

```yaml
# ci.yml のジョブ構成
jobs:
  changes:        # 変更検出（paths-filter）
  ci:             # Lint, Typecheck, Unit Test, Build
  knip-unused-code:  # 未使用コードチェック（オプション）
  bun-audit-pr:   # セキュリティ監査
  api-service-integration-tests:  # 統合テスト
```

#### 変更検出の対象

| フィルタ | 対象パス |
|--------|---------|
| client | `apps/client/**`, `packages/ui/**`, `packages/contracts/**` |
| api-service | `apps/api-service/**`, `packages/database/**` |

### デプロイワークフロー詳細

```
┌─────────────┐
│ build-push  │──────────────────────────────────────────────────────┐
└─────────────┘                                                       │
      │                                                               │
      ▼ (並列)                                                        │
┌─────────────┐                                                       │
│   apply     │──────────────────────────────────────────────────────┤
└─────────────┘                                                       │
                                                                      │ 両方完了後
                                                               ┌──────▼──────┐
                                                               │   deploy    │
                                                               └─────────────┘
                                                                      │
                                              ┌───────────────────────┴────────────────────┐
                                              ▼                                            ▼
                                    DB Migration                              Wait for Ready &
                                    (Cloud Run Job)                           Switch Traffic
```

`build-push` と `apply` は**並列実行**。両方完了後に `deploy` がマイグレーションと rollout を順次実行します。

#### 1. build-push ジョブ

```yaml
steps:
  - checkout
  - google-github-actions/auth (WIF)
  - setup-gcloud
  - scripts/build-push.sh
    # server, client をビルド・プッシュ
```

#### 2. apply ジョブ

```yaml
steps:
  - checkout
  - google-github-actions/auth (WIF)
  - setup-gcloud
  - setup-terraform
  - Terraform providers cache (restore)
  - Check TF state bucket exists
  - Enable core Google APIs
  - Check and cleanup stale Terraform lock  # 30分以上の古いlockを削除
  - Validate required environment variables  # PREFIX検証
  - Get DB password (Composite Action)
  - Terraform Apply (scripts/terraform-apply.sh)
  - Terraform providers cache (save)
  - Sync Cloud SQL password
```

#### 3. deploy ジョブ（migrate + rollout 統合）

```yaml
needs: [build-push, apply]  # 両方の完了を待機
steps:
  - checkout
  - google-github-actions/auth (WIF)
  - setup-gcloud
  - setup-terraform
  - Terraform Init (for outputs)
  - Run DB Migration Job (scripts/run-migration.sh)
    # migrate:latest イメージで Cloud Run Job を実行
    # succeededCount をポーリングして完了を待機
  - Get DB password (Composite Action)
  - Deploy new revisions (no traffic change)
    # BUILD_SHA を環境変数に設定して新リビジョン作成
  - Wait for revisions to be ready and switch traffic
    # 新リビジョンの READY を確認後に 100% 切り替え
```

### Composite Actions

#### get-db-password

```yaml
# .github/actions/get-db-password/action.yml
inputs:
  project_id: GCP プロジェクト ID
  prefix: リソースプレフィックス
  fallback_password: フォールバック用パスワード

outputs:
  DB_PASSWORD: 取得したパスワード

# 優先順位:
# 1. Secret Manager ({prefix}-database-url から抽出)
# 2. fallback_password (GitHub Secret)
```

### 同時実行制御

```yaml
concurrency:
  group: deploy-stg
  cancel-in-progress: false  # 実行中のデプロイはキャンセルしない
```

---

## CI/CD パイプライン詳細

### 全体フロー

```
[Developer] ─push─▶ [main branch]
                         │
                         ▼
              ┌──────────────────────┐
              │    CI Pipeline       │
              │  (ci.yml)            │
              │  - Lint              │
              │  - Typecheck         │
              │  - Unit Test         │
              │  - Integration Test  │
              │  - Architecture Check│
              └──────────┬───────────┘
                         │ success
                         ▼
              ┌──────────────────────┐
              │  Deploy STG          │
              │  (deploy-stg.yml)    │
              │  手動トリガー         │
              └──────────┬───────────┘
                         │
    ┌────────────────────┐
    │                    │
    ▼ (並列)             ▼ (並列)
┌────────┐         ┌──────────┐
│build   │         │ apply    │
│push    │         │(Terraform│
└───┬────┘         │ + secret │
    │              │  sync)   │
    │              └────┬─────┘
    └──────────┬─────────┘
               │ 両方完了後
               ▼
         ┌──────────┐
         │  deploy  │
         │ (migrate │
         │ + rollout│
         │   )      │
         └──────────┘
```

### 本番デプロイ

```
[Manual Trigger] ─workflow_dispatch─▶ [Deploy PROD]
                                           │
                                           ▼
                              (同じフロー: build-push → apply → migrate → rollout)
```

### キャッシュ戦略

| キャッシュ | キー | 対象 |
|----------|-----|------|
| Bun | `bun-${{ hashFiles('**/bun.lock') }}` | `~/.bun`, `~/.cache/bun` |
| Turbo | `turbo-${{ github.ref }}-${{ hashFiles('**/turbo.json') }}` | `.turbo` |
| Prisma | `prisma-${{ hashFiles('**/schema.prisma') }}` | `node_modules/.prisma` |
| Terraform | `terraform-${{ hashFiles('**/*.tf') }}` | `.terraform` |

---

## セキュリティ設計

### 認証・認可

#### Workload Identity Federation (WIF)

```
GitHub Actions ─OIDC─▶ WIF Provider ─token─▶ GCP SA
```

- GitHub からの OIDC トークンを GCP サービスアカウントに紐づけ
- リポジトリ単位で制限（`attribute.repository`）

#### Cloud Run 間通信

| 通信経路 | 認証方式 |
|---------|---------|
| Client → Server | VPC内部通信（Client SA で認証） |

### ネットワークセキュリティ

- Cloud SQL: Private IP のみ（パブリック IP 無効）
- Server: `INGRESS_TRAFFIC_INTERNAL_ONLY`
- Client: `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER`

### Cloud Armor（WAF + レートリミット）

`enable_cloud_armor = true`（デフォルト）で有効化。Cloud Armor Standard は追加費用なし。

| ルール | 動作 | 優先度 |
|-------|------|-------|
| デフォルト | 全トラフィック許可 | 2147483647 |
| レートリミット | IP 単位で `cloud_armor_rate_limit_count` rps 超過で 429 | 1000 |

```hcl
# レートリミット設定例（terraform.tfvars）
cloud_armor_rate_limit_count    = 100  # リクエスト数
cloud_armor_rate_limit_interval = 60   # 秒
```

### SSL/TLS

| 層 | 設定 |
|---|------|
| Cloud SQL → App | `ssl_mode = ENCRYPTED_ONLY`（常時暗号化） |
| Internet → LB | `enable_ssl = true` でマネージド SSL 証明書（HTTP は HTTPS へ自動リダイレクト） |
| LB → Cloud Run | HTTPS（Cloud Run 内部で終端） |

### シークレット管理

```
GitHub Secrets (初回ブートストラップ用)
    ├── STG_GCP_PROJECT_ID / PRD_GCP_PROJECT_ID
    ├── STG_WIF_PROVIDER / PRD_WIF_PROVIDER
    ├── STG_WIF_SA / PRD_WIF_SA
    ├── STG_TFSTATE_BUCKET / PRD_TFSTATE_BUCKET
    └── STG_DB_PASSWORD / PRD_DB_PASSWORD (初回のみ、以降削除可)

Secret Manager (ランタイム用)
    ├── {prefix}-database-url      … DB 接続文字列（SSL パラメータ含む）
    └── {prefix}-cloudsql-server-ca … Cloud SQL CA 証明書（Cloud Run にボリュームマウント）
```

---

## 監視・アラート

### 有効化

```hcl
# terraform.tfvars
enable_monitoring = true
alert_notification_channels = ["projects/.../notificationChannels/..."]
```

### アラートポリシー

| アラート | 条件 | 重要度 | 制御変数 |
|---------|------|-------|---------|
| Cloud Run Error Rate | 5xx エラー > 10件/5分 | High | `enable_monitoring` |
| Cloud Run Instance Count | インスタンス数 = 0 が10分継続 | Low | `enable_monitoring` |
| Cloud SQL Connections | 接続数 > 80 | Medium | `enable_monitoring` |
| Cloud SQL CPU | CPU使用率 > 80% が5分継続 | Medium | `enable_monitoring` |
| IAM Policy Change | `SetIamPolicy` ログ検知（5分に1回上限） | High | `enable_iam_change_alert` |

IAM 変更検知アラートには deployer SA に `roles/logging.configWriter` が必要です。`bootstrap/service-account.tf` で自動付与されます。

### 通知チャンネル設定

Cloud Monitoring コンソールで通知チャンネル（Email, Slack等）を作成し、ID を取得して `alert_notification_channels` に設定します。

---

## 環境分離

### State 分離

```
gs://tfstate-{app}-stg/
└── stg/terraform.tfstate/
    ├── default.tfstate
    └── default.tflock

gs://tfstate-{app}-prd/
└── prod/terraform.tfstate/
    ├── default.tfstate
    └── default.tflock
```

### 環境別設定

| 設定項目 | STG | PROD |
|---------|-----|------|
| トリガー | 手動 (将来: CI成功後自動) | 手動 (将来: タグ) |
| DB Tier | db-f1-micro | db-n1-standard-1 推奨 |
| DB Backup | 無効 | 有効推奨 |
| SSL (`enable_ssl`) | 無効 | 有効推奨 |
| Cloud Armor (`enable_cloud_armor`) | 有効（デフォルト） | 有効（デフォルト） |
| IAM 変更検知アラート (`enable_iam_change_alert`) | 有効（デフォルト） | 有効（デフォルト） |
| deletion_protection (`cloud_run_deletion_protection`) | 有効（デフォルト） | 有効（デフォルト） |
| 監視アラート (`enable_monitoring`) | 有効 | 有効 |

### PREFIX 命名規則

全リソースは `{prefix}-` で始まる名前を持ちます。

```
例: prefix = "ax"

ax-vpc
ax-server
ax-db
ax-database-url         (Secret: DB 接続文字列)
ax-cloudsql-server-ca   (Secret: Cloud SQL CA 証明書)
```

---

## 参照ドキュメント

- [デプロイガイド](../deploy/deployment.md) - 初回セットアップ手順
- [Terraform README](../infra/terraform/README.md) - Terraform 詳細
- [GitHub Secrets 設定](../deploy/github-secrets-setup.md) - シークレット設定手順
- [ドメイン設定](../infra/terraform/docs/domain-setup.md) - SSL/カスタムドメイン設定
- [認証システム](../dev/authentication.md) - Identity Platform 認証
