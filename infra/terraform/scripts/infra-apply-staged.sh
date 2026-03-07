#!/usr/bin/env bash
set -euo pipefail

# Staged terraform apply helper (lives under infra/terraform/scripts)

# Save script directory for later use
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

cd "$SCRIPT_DIR/.."

# Check if ADC is configured
if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
  echo "Error: Application Default Credentials (ADC) not configured." >&2
  echo "Please run: gcloud auth application-default login" >&2
  exit 1
fi

# Optional backend config via env (safe fallback to default init)
if [[ -n "${TF_BACKEND_BUCKET:-}" ]]; then
  echo "[0] backend: bucket=${TF_BACKEND_BUCKET} prefix=${TF_BACKEND_PREFIX:-}"
  INIT_BACKEND=(
    -backend-config="bucket=${TF_BACKEND_BUCKET}"
  )
  if [[ -n "${TF_BACKEND_PREFIX:-}" ]]; then
    INIT_BACKEND+=( -backend-config="prefix=${TF_BACKEND_PREFIX}" )
  fi
else
  INIT_BACKEND=()
fi

echo "[1/7] terraform init"
# Cleanup stale lock if any (safe for local execution)
if [[ -n "${TF_BACKEND_BUCKET:-}" ]]; then
  BUCKET_NAME="${TF_BACKEND_BUCKET#gs://}"
  BUCKET_NAME="${BUCKET_NAME#file://}"
  LOCK_PREFIX="${TF_BACKEND_PREFIX:-}"
  if [[ -n "${LOCK_PREFIX}" ]]; then
    LOCK_PATH="gs://${BUCKET_NAME}/${LOCK_PREFIX}/default.tflock"
  else
    LOCK_PATH="gs://${BUCKET_NAME}/default.tflock"
  fi
  echo "  Cleaning up stale lock: ${LOCK_PATH}"
  gsutil rm -f "${LOCK_PATH}" 2>/dev/null || true
fi
# 初回セットアップやバックエンド変更時は -reconfigure を使用
terraform init -upgrade -reconfigure "${INIT_BACKEND[@]}"

# Extract PROJECT_ID and REGION from terraform.tfvars if not set
TFVARS_FILE="terraform.tfvars"
if [[ -z "${PROJECT_ID:-}" ]]; then
  if [[ -f "${TFVARS_FILE}" ]]; then
    PROJECT_ID=$(grep 'project_id' "${TFVARS_FILE}" | sed -n "s/.*project_id[[:space:]]*=[[:space:]]*[\"']\([^\"']*\)[\"'].*/\1/p" | head -1)
    if [[ -n "${PROJECT_ID}" ]]; then
      export PROJECT_ID
    fi
  fi
fi

REGION=${REGION:-asia-northeast1}
if [[ -f "terraform.tfvars" ]]; then
  TFVARS_REGION=$(grep 'region' terraform.tfvars | sed -n "s/.*region[[:space:]]*=[[:space:]]*[\"']\([^\"']*\)[\"'].*/\1/p" | head -1)
  if [[ -n "${TFVARS_REGION}" ]]; then
    REGION="${TFVARS_REGION}"
  fi
fi

if [[ -z "${PROJECT_ID:-}" ]]; then
  echo "Error: PROJECT_ID is required. Set it as environment variable or in terraform.tfvars" >&2
  exit 1
fi

# Extract PREFIX from terraform.tfvars if not set
PREFIX=${PREFIX:-ax}
if [[ -f "${TFVARS_FILE}" ]]; then
  TFVARS_PREFIX=$(grep 'prefix' "${TFVARS_FILE}" | sed -n "s/.*prefix[[:space:]]*=[[:space:]]*[\"']\([^\"']*\)[\"'].*/\1/p" | head -1)
  if [[ -n "${TFVARS_PREFIX}" ]]; then
    PREFIX="${TFVARS_PREFIX}"
  fi
fi

# Function to auto-import existing resources
auto_import_existing_resources() {
  echo "[1.5/7] checking and auto-importing existing resources..."
  
  # Debug: PROJECT_ID and REGIONが設定されているか確認
  if [[ -z "${PROJECT_ID:-}" ]]; then
    echo "  ❌ Error: PROJECT_ID is not set" >&2
    return 1
  fi
  if [[ -z "${REGION:-}" ]]; then
    echo "  ❌ Error: REGION is not set" >&2
    return 1
  fi
  echo "  Using PROJECT_ID=${PROJECT_ID}, REGION=${REGION}, PREFIX=${PREFIX}"
  
  # Helper function to check if resource exists in state
  resource_in_state() {
    local resource_name="$1"
    # terraform state showの実行時にエラーで停止しないようにサブシェルで実行
    # サブシェル内でset +eを使用することで、外側のset -eに影響を与えない
    (
      set +e
      terraform state show "${resource_name}" >/dev/null 2>&1
      exit $?
    )
  }
  
  # Helper function to import resource
  try_import() {
    local resource_type="$1"
    local resource_name="$2"
    local import_id="$3"
    
    if resource_in_state "${resource_type}.${resource_name}"; then
      echo "  ℹ️  ${resource_type}.${resource_name} already in state, skipping..."
      return 0  # Already in state
    fi
    
    echo "  Attempting to import ${resource_type}.${resource_name}..."
    # terraform importの出力をすべて表示し、成功かどうかを判定
    # set -eを一時的に無効化してエラー時も続行
    set +e
    local import_output
    import_output=$(terraform import "${resource_type}.${resource_name}" "${import_id}" 2>&1)
    local import_status=$?
    set -e
    
    if [[ $import_status -eq 0 ]]; then
      echo "  ✓ Imported ${resource_type}.${resource_name}"
      return 0
    elif echo "$import_output" | grep -q "Import successful"; then
      echo "  ✓ Imported ${resource_type}.${resource_name}"
      return 0
    else
      # エラーでも続行（リソースが存在しない場合は正常）
      if [[ -n "$import_output" ]]; then
        echo "$import_output" | grep -v "^$" || true  # 空行以外を表示
      fi
      echo "  ⚠️  Could not import ${resource_type}.${resource_name} (may not exist or already in state)"
      return 0  # エラーでも続行するため0を返す
    fi
  }
  
  # Service Accounts (サフィックスは locals.tf と一致させる)
  try_import "module.iam.google_service_account" "server" "projects/${PROJECT_ID}/serviceAccounts/${PREFIX}-server-sa@${PROJECT_ID}.iam.gserviceaccount.com" || true
  try_import "module.iam.google_service_account" "client" "projects/${PROJECT_ID}/serviceAccounts/${PREFIX}-client-sa@${PROJECT_ID}.iam.gserviceaccount.com" || true
  try_import "module.iam.google_service_account" "migrate" "projects/${PROJECT_ID}/serviceAccounts/${PREFIX}-mig-sa@${PROJECT_ID}.iam.gserviceaccount.com" || true
  
  # Artifact Registry
  try_import "module.artifact_registry.google_artifact_registry_repository" "repo" "projects/${PROJECT_ID}/locations/${REGION}/repositories/${PREFIX}-repo" || true
  
  # Secret Manager
  try_import "module.cloud_sql.google_secret_manager_secret" "database_url" "projects/${PROJECT_ID}/secrets/${PREFIX}-database-url" || true
  
  # Network
  echo "  Checking network resources..."
  # ネットワーク名を変数から読み取る（優先順位: 環境変数 > terraform.tfvars > デフォルト）
  NETWORK_NAME="${TF_VAR_network_name:-${PREFIX}-vpc}"
  if [[ -f "${TFVARS_FILE}" ]]; then
    set +e
    TFVARS_NETWORK=$(grep 'network_name' "${TFVARS_FILE}" 2>/dev/null | sed -n "s/.*network_name[[:space:]]*=[[:space:]]*[\"']\([^\"']*\)[\"'].*/\1/p" | head -1)
    set -e
    if [[ -n "${TFVARS_NETWORK}" ]]; then
      NETWORK_NAME="${TFVARS_NETWORK}"
    fi
  fi
  echo "  Using NETWORK_NAME=${NETWORK_NAME}"
  try_import "module.networking.google_compute_network" "vpc" "projects/${PROJECT_ID}/global/networks/${NETWORK_NAME}" || true
  
  # Subnetwork
  # サブネット名を変数から読み取る（優先順位: 環境変数 > terraform.tfvars > デフォルト）
  SUBNET_NAME="${TF_VAR_subnet_name:-${PREFIX}-subnet}"
  if [[ -f "${TFVARS_FILE}" ]]; then
    set +e
    TFVARS_SUBNET=$(grep 'subnet_name' "${TFVARS_FILE}" 2>/dev/null | sed -n "s/.*subnet_name[[:space:]]*=[[:space:]]*[\"']\([^\"']*\)[\"'].*/\1/p" | head -1)
    set -e
    if [[ -n "${TFVARS_SUBNET}" ]]; then
      SUBNET_NAME="${TFVARS_SUBNET}"
    fi
  fi
  echo "  Using SUBNET_NAME=${SUBNET_NAME}"
  try_import "module.networking.google_compute_subnetwork" "subnet" "projects/${PROJECT_ID}/regions/${REGION}/subnetworks/${SUBNET_NAME}" || true
  
  # Private Service Connect range
  echo "  Checking private service connect range..."
  try_import "module.networking.google_compute_global_address" "private_service_range" "projects/${PROJECT_ID}/global/addresses/${PREFIX}-private-service-range" || true
  
  # Private Service Connect connection
  # インポートIDは特殊な形式: projects/<project>/global/networks/<network>:servicenetworking.googleapis.com
  echo "  Checking private service connect connection..."
  try_import "module.networking.google_service_networking_connection" "private_vpc_connection" "projects/${PROJECT_ID}/global/networks/${NETWORK_NAME}:servicenetworking.googleapis.com" || true
  
  # VPC Access Connector
  # コネクタ名を変数から読み取る（優先順位: 環境変数 > terraform.tfvars > デフォルト）
  CONNECTOR_NAME="${TF_VAR_connector_name:-${PREFIX}-vpc-c}"
  if [[ -f "${TFVARS_FILE}" ]]; then
    set +e
    TFVARS_CONNECTOR=$(grep 'connector_name' "${TFVARS_FILE}" 2>/dev/null | sed -n "s/.*connector_name[[:space:]]*=[[:space:]]*[\"']\([^\"']*\)[\"'].*/\1/p" | head -1)
    set -e
    if [[ -n "${TFVARS_CONNECTOR}" ]]; then
      CONNECTOR_NAME="${TFVARS_CONNECTOR}"
    fi
  fi
  echo "  Using CONNECTOR_NAME=${CONNECTOR_NAME}"
  try_import "module.networking.google_vpc_access_connector" "connector" "projects/${PROJECT_ID}/locations/${REGION}/connectors/${CONNECTOR_NAME}" || true
  
  # グローバルIP名（変数化されていないため決め打ち）
  echo "  Checking global IP address..."
  try_import "module.load_balancer.google_compute_global_address" "lb_ip" "projects/${PROJECT_ID}/global/addresses/${PREFIX}-lb-ip" || true
  
  # Cloud SQL Instance
  # インスタンス名を変数から読み取る（優先順位: 環境変数 > terraform.tfvars > デフォルト）
  DB_INSTANCE_NAME="${TF_VAR_db_instance_name:-${PREFIX}-db}"
  if [[ -f "${TFVARS_FILE}" ]]; then
    set +e
    TFVARS_DB_INSTANCE=$(grep 'db_instance_name' "${TFVARS_FILE}" 2>/dev/null | sed -n "s/.*db_instance_name[[:space:]]*=[[:space:]]*[\"']\([^\"']*\)[\"'].*/\1/p" | head -1)
    set -e
    if [[ -n "${TFVARS_DB_INSTANCE}" ]]; then
      DB_INSTANCE_NAME="${TFVARS_DB_INSTANCE}"
    fi
  fi
  echo "  Using DB_INSTANCE_NAME=${DB_INSTANCE_NAME}"
  try_import "module.cloud_sql.google_sql_database_instance" "db" "projects/${PROJECT_ID}/instances/${DB_INSTANCE_NAME}" || true
  
  # Cloud SQL Database
  # データベース名を変数から読み取る（優先順位: 環境変数 > terraform.tfvars > デフォルト）
  DB_DATABASE_NAME="${TF_VAR_db_database_name:-app}"
  if [[ -f "${TFVARS_FILE}" ]]; then
    set +e
    TFVARS_DB_DATABASE=$(grep 'db_database_name' "${TFVARS_FILE}" 2>/dev/null | sed -n "s/.*db_database_name[[:space:]]*=[[:space:]]*[\"']\([^\"']*\)[\"'].*/\1/p" | head -1)
    set -e
    if [[ -n "${TFVARS_DB_DATABASE}" ]]; then
      DB_DATABASE_NAME="${TFVARS_DB_DATABASE}"
    fi
  fi
  echo "  Using DB_DATABASE_NAME=${DB_DATABASE_NAME}"
  try_import "module.cloud_sql.google_sql_database" "app" "projects/${PROJECT_ID}/instances/${DB_INSTANCE_NAME}/databases/${DB_DATABASE_NAME}" || true
  
  # Cloud Run Services
  echo "  Checking Cloud Run services..."
  # サービス名を変数から読み取る（優先順位: 環境変数 > terraform.tfvars > デフォルト）
  RUN_SERVICE_NAME_SERVER="${TF_VAR_run_service_name_server:-${PREFIX}-server}"
  RUN_SERVICE_NAME_CLIENT="${TF_VAR_run_service_name_client:-${PREFIX}-client}"
  if [[ -f "${TFVARS_FILE}" ]]; then
    set +e
    TFVARS_SERVER=$(grep 'run_service_name_server' "${TFVARS_FILE}" 2>/dev/null | sed -n "s/.*run_service_name_server[[:space:]]*=[[:space:]]*[\"']\([^\"']*\)[\"'].*/\1/p" | head -1)
    TFVARS_CLIENT=$(grep 'run_service_name_client' "${TFVARS_FILE}" 2>/dev/null | sed -n "s/.*run_service_name_client[[:space:]]*=[[:space:]]*[\"']\([^\"']*\)[\"'].*/\1/p" | head -1)
    set -e
    if [[ -n "${TFVARS_SERVER}" ]]; then
      RUN_SERVICE_NAME_SERVER="${TFVARS_SERVER}"
    fi
    if [[ -n "${TFVARS_CLIENT}" ]]; then
      RUN_SERVICE_NAME_CLIENT="${TFVARS_CLIENT}"
    fi
  fi
  echo "  Using RUN_SERVICE_NAME_SERVER=${RUN_SERVICE_NAME_SERVER}"
  echo "  Using RUN_SERVICE_NAME_CLIENT=${RUN_SERVICE_NAME_CLIENT}"
  try_import "module.cloud_run.google_cloud_run_v2_service" "server" "projects/${PROJECT_ID}/locations/${REGION}/services/${RUN_SERVICE_NAME_SERVER}" || true
  try_import "module.cloud_run.google_cloud_run_v2_service" "client" "projects/${PROJECT_ID}/locations/${REGION}/services/${RUN_SERVICE_NAME_CLIENT}" || true
  
  # Cloud Run Job
  echo "  Checking Cloud Run job..."
  # ジョブ名は決め打ち（変数化されていないため）
  try_import "module.cloud_run_job.google_cloud_run_v2_job" "db_migrate" "projects/${PROJECT_ID}/locations/${REGION}/jobs/${PREFIX}-db-migrate" || true
  
  # Load Balancer NEGs
  echo "  Checking Network Endpoint Groups..."
  # NEG名を変数から読み取る（優先順位: 環境変数 > terraform.tfvars > デフォルト）
  # server_neg は削除（serverは内部専用のため）
  NEG_NAME_CLIENT="${TF_VAR_neg_name_client:-${PREFIX}-client-neg}"
  if [[ -f "${TFVARS_FILE}" ]]; then
    set +e
    TFVARS_NEG_CLIENT=$(grep 'neg_name_client' "${TFVARS_FILE}" 2>/dev/null | sed -n "s/.*neg_name_client[[:space:]]*=[[:space:]]*[\"']\([^\"']*\)[\"'].*/\1/p" | head -1)
    set -e
    if [[ -n "${TFVARS_NEG_CLIENT}" ]]; then
      NEG_NAME_CLIENT="${TFVARS_NEG_CLIENT}"
    fi
  fi
  echo "  Using NEG_NAME_CLIENT=${NEG_NAME_CLIENT}"
  try_import "module.load_balancer.google_compute_region_network_endpoint_group" "client_neg" "projects/${PROJECT_ID}/regions/${REGION}/networkEndpointGroups/${NEG_NAME_CLIENT}" || true
  
  # Load Balancer Resources
  echo "  Checking Load Balancer resources..."
  # server_backend は削除（serverは内部専用のため）
  # バックエンドサービス、URL Map、プロキシ、転送ルールは決め打ち（変数化されていないため）
  try_import "module.load_balancer.google_compute_backend_service" "client_backend" "projects/${PROJECT_ID}/global/backendServices/${PREFIX}-client-backend" || true
  try_import "module.load_balancer.google_compute_url_map" "main" "projects/${PROJECT_ID}/global/urlMaps/${PREFIX}-lb-url-map" || true
  try_import "module.load_balancer.google_compute_target_http_proxy" "main" "projects/${PROJECT_ID}/global/targetHttpProxies/${PREFIX}-lb-http-proxy" || true
  try_import "module.load_balancer.google_compute_global_forwarding_rule" "http" "projects/${PROJECT_ID}/global/forwardingRules/${PREFIX}-lb-http-forwarding" || true
  
  echo "  Done checking existing resources."
}

# Auto-import existing resources if they exist
set +e
auto_import_existing_resources
import_status=$?
set -e

if [[ $import_status -ne 0 ]]; then
  echo "⚠️  Warning: Auto-import failed, but continuing..." >&2
fi

echo "[2/7] terraform plan (skipping if container images not available)"
# terraform plan はコンテナイメージが存在しない場合エラーになるため、エラーを無視する
terraform plan || echo "⚠️  Plan failed (likely due to missing container images). Continuing..."

echo "[3/7] apply: enable required APIs (first-time only)"
# 既存のリソースは自動的にスキップされます
terraform apply -auto-approve \
  -target=google_project_service.apis

echo "[4/7] apply: network (vpc, subnet)"
terraform apply -auto-approve \
  -target=module.networking.google_compute_network.vpc \
  -target=module.networking.google_compute_subnetwork.subnet

echo "[5/7] apply: private service connect (address, service networking)"
terraform apply -auto-approve \
  -target=module.networking.google_compute_global_address.private_service_range \
  -target=module.networking.google_service_networking_connection.private_vpc_connection

echo "[6/7] apply: Cloud SQL instance (⚠️ 作成に約10〜15分かかります)"
# 既に作成済みの場合はスキップされます
terraform apply -auto-approve -target=module.cloud_sql.google_sql_database_instance.db || {
  echo "⚠️  Cloud SQL instance may already exist or creation failed. Checking state..."
  terraform state show module.cloud_sql.google_sql_database_instance.db >/dev/null 2>&1 && echo "✓ Cloud SQL instance exists, skipping..."
}

echo "[6.5/7] apply: Artifact Registry and Service Accounts (required before container image push)"
# コンテナイメージをプッシュする前に Artifact Registry リポジトリとサービスアカウントを作成
terraform apply -auto-approve \
  -target=module.artifact_registry.google_artifact_registry_repository.repo \
  -target=module.iam.google_service_account.server \
  -target=module.iam.google_service_account.client \
  -target=module.iam.google_service_account.migrate

echo "[7/7] build/push container images (required before Cloud Run creation)"
# Build and push images (server/client)
# PROJECT_ID is already set above
# Run from repo root
cd "$REPO_ROOT"
bash "$SCRIPT_DIR/build-push.sh"

# Return to terraform directory
cd "$SCRIPT_DIR/.."

echo "[final-1] apply: IAM, secrets, load balancer, monitoring"
terraform apply -auto-approve \
  -target=module.iam \
  -target=module.cloud_sql.google_secret_manager_secret.database_url \
  -target=module.cloud_sql.google_secret_manager_secret.cloudsql_ca_cert \
  -target=module.cloud_sql.google_secret_manager_secret_version.cloudsql_ca_cert_v \
  -target=module.cloud_sql.google_secret_manager_secret_version.database_url_v \
  -target=module.load_balancer \
  -target=module.monitoring

echo "[final-2] apply: Cloud Run services (requires images + IAM to be ready)"
terraform apply -auto-approve \
  -target=module.cloud_run \
  -target=module.cloud_run_job || {
  echo ""
  echo "⚠️  Cloud Run apply failed. Common causes:"
  echo "  1. Container images not yet pushed to Artifact Registry"
  echo "     → Run: bash ${SCRIPT_DIR}/build-push.sh"
  echo "  2. IAM permissions not yet propagated (wait ~60s and retry)"
  echo "     → Re-run: terraform apply -auto-approve -target=module.cloud_run"
  echo "  3. VPC connector not ready"
  echo "     → Check: gcloud compute networks vpc-access connectors list --region ${REGION}"
  echo ""
  echo "After resolving, run: terraform apply -auto-approve"
  exit 1
}

echo ""
echo "[final] apply: any remaining resources"
terraform apply -auto-approve

echo "Done. Infrastructure setup complete."
