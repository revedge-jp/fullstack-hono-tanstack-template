#!/usr/bin/env bash
set -euo pipefail

# Terraform Apply スクリプト
# 安全機構: 大量削除を検出したらエラーで停止

TF_DIR=${TF_DIR:-.}
BUCKET_NAME=${BUCKET_NAME:?"BUCKET_NAME is required"}
BACKEND_PREFIX=${BACKEND_PREFIX:?"BACKEND_PREFIX is required (e.g., stg/terraform.tfstate)"}

# 削除数の閾値（これを超えたらエラー）
MAX_DESTROY_THRESHOLD=${MAX_DESTROY_THRESHOLD:-5}

# 選択的 apply: カンマ区切りのモジュールを除外（例: EXCLUDE_MODULES=module.monitoring,module.identity_platform）
# NOTE: -exclude フラグは Terraform 1.9+ が必要。それ以前のバージョンでは EXCLUDE_MODULES は無視されます。
EXCLUDE_MODULES=${EXCLUDE_MODULES:-}

echo "=== Terraform Apply ==="
echo "TF_DIR: ${TF_DIR}"
echo "BUCKET_NAME: ${BUCKET_NAME}"
echo "BACKEND_PREFIX: ${BACKEND_PREFIX}"
echo "MAX_DESTROY_THRESHOLD: ${MAX_DESTROY_THRESHOLD}"
echo "EXCLUDE_MODULES: ${EXCLUDE_MODULES:-<none>}"
echo "PWD: $(pwd)"
echo ""

# バケット名の正規化（gs:// プレフィックスを削除）
BUCKET_NAME="${BUCKET_NAME#gs://}"
BUCKET_NAME="${BUCKET_NAME#file://}"

# Terraform の初期化
echo "📋 Initializing Terraform backend..."
cd "${TF_DIR}"
terraform init -upgrade -reconfigure \
  -backend-config="bucket=${BUCKET_NAME}" \
  -backend-config="prefix=${BACKEND_PREFIX}" || {
  echo "❌ Error: Terraform init failed"
  exit 1
}
echo "  ✓ Terraform initialized"
echo ""

# EXCLUDE_MODULES サポート: 指定モジュールを除外して plan/apply（Terraform 1.9+ 必須）
# NOTE: -exclude は保存済み plan ファイルに渡せないため、plan 生成時に指定する。
#       plan と apply が同じスコープで実行されることを保証するため。
PLAN_EXCLUDE_FLAGS=()
if [[ -n "${EXCLUDE_MODULES}" ]]; then
  TF_MINOR=$(terraform version -json 2>/dev/null | grep '"terraform_version"' | sed -E 's/.*"([0-9]+)\.([0-9]+)\..*/\2/' || echo "0")
  if [[ "${TF_MINOR}" -lt 9 ]]; then
    echo "  ⚠️  Warning: EXCLUDE_MODULES requires Terraform 1.9+. Detected version is older — ignoring EXCLUDE_MODULES."
  else
    echo "  ℹ️  Excluding modules: ${EXCLUDE_MODULES}"
    IFS=',' read -ra MODULES <<< "${EXCLUDE_MODULES}"
    for mod in "${MODULES[@]}"; do
      PLAN_EXCLUDE_FLAGS+=("-exclude=${mod}")
    done
  fi
fi

# 安全チェック: terraform plan で削除数を確認
echo "🔍 Running Terraform plan (safety check)..."
PLAN_OUTPUT=$(terraform plan -detailed-exitcode -out=tfplan "${PLAN_EXCLUDE_FLAGS[@]}" 2>&1) || PLAN_EXIT_CODE=$?
PLAN_EXIT_CODE=${PLAN_EXIT_CODE:-0}

# exit code: 0=no changes, 1=error, 2=changes present
if [ "${PLAN_EXIT_CODE}" -eq 1 ]; then
  echo "❌ Error: Terraform plan failed"
  echo "${PLAN_OUTPUT}"
  exit 1
fi

if [ "${PLAN_EXIT_CODE}" -eq 0 ]; then
  echo "  ✓ No changes detected"
  echo ""
  echo "✓ Terraform apply completed (no changes)"
  rm -f tfplan
  exit 0
fi

# 変更がある場合、削除数をチェック
DESTROY_COUNT=$(echo "${PLAN_OUTPUT}" | grep -oE '[0-9]+ to destroy' | grep -oE '[0-9]+' || echo "0")
ADD_COUNT=$(echo "${PLAN_OUTPUT}" | grep -oE '[0-9]+ to add' | grep -oE '[0-9]+' || echo "0")
CHANGE_COUNT=$(echo "${PLAN_OUTPUT}" | grep -oE '[0-9]+ to change' | grep -oE '[0-9]+' || echo "0")

echo "  Plan summary: ${ADD_COUNT} to add, ${CHANGE_COUNT} to change, ${DESTROY_COUNT} to destroy"

# 🔒 重要: Cloud SQL / データベースリソースの削除を検知して停止
# これらのリソースの削除はデータ損失につながるため、CI/CDでは絶対に許可しない

# jq が利用可能か確認
if ! command -v jq &> /dev/null; then
  echo ""
  echo "❌ CRITICAL ERROR: jq is not installed"
  echo "  jq is required for database deletion safety check."
  echo "  Install jq and retry."
  echo ""
  rm -f tfplan
  exit 1
fi

# terraform plan の JSON 出力を取得
PLAN_JSON=$(terraform show -json tfplan 2>&1) || {
  echo ""
  echo "❌ CRITICAL ERROR: Failed to parse terraform plan"
  echo "  Cannot verify if database resources will be deleted."
  echo "  Aborting for safety."
  echo ""
  rm -f tfplan
  exit 1
}

# JSON が有効か確認
if ! echo "${PLAN_JSON}" | jq empty 2>/dev/null; then
  echo ""
  echo "❌ CRITICAL ERROR: Invalid JSON from terraform plan"
  echo "  Cannot verify if database resources will be deleted."
  echo "  Aborting for safety."
  echo ""
  rm -f tfplan
  exit 1
fi

# Cloud SQL 関連リソースの削除を検知
CRITICAL_RESOURCES_TO_DESTROY=$(echo "${PLAN_JSON}" | \
  jq -r '.resource_changes[]? | select(.change.actions[] == "delete") | select(.type == "google_sql_database_instance" or .type == "google_sql_database" or .type == "google_sql_user") | .address' 2>/dev/null || echo "")

if [ -n "${CRITICAL_RESOURCES_TO_DESTROY}" ]; then
  echo ""
  echo "🚨 CRITICAL SAFETY CHECK FAILED: Database resources would be DELETED!"
  echo ""
  echo "The following database resources are marked for destruction:"
  echo "${CRITICAL_RESOURCES_TO_DESTROY}" | sed 's/^/  - /'
  echo ""
  echo "This is EXTREMELY DANGEROUS and will cause DATA LOSS."
  echo ""
  echo "Common causes:"
  echo "  1. 'prefix' variable mismatch between local and CI/CD"
  echo "  2. 'db_database_name' or 'db_instance_name' variable changed"
  echo "  3. Terraform state corruption or mismatch"
  echo ""
  echo "To fix:"
  echo "  1. Ensure CI/CD uses the same 'prefix' as your Terraform state"
  echo "  2. Check .github/workflows/*.yml for TF_VAR_prefix value"
  echo "  3. Run 'terraform state list | grep sql' to verify current state"
  echo ""
  echo "If you REALLY need to destroy these resources (e.g., environment teardown),"
  echo "run 'terraform destroy' manually with explicit confirmation."
  echo ""
  rm -f tfplan
  exit 1
fi

if [ "${DESTROY_COUNT}" -gt "${MAX_DESTROY_THRESHOLD}" ]; then
  echo ""
  echo "❌ SAFETY CHECK FAILED: Too many resources to destroy (${DESTROY_COUNT} > ${MAX_DESTROY_THRESHOLD})"
  echo ""
  echo "This usually indicates a configuration error (e.g., wrong prefix)."
  echo "Please review the plan output carefully before proceeding."
  echo ""
  echo "To override this check, set MAX_DESTROY_THRESHOLD to a higher value:"
  echo "  MAX_DESTROY_THRESHOLD=100 ./terraform-apply.sh"
  echo ""
  rm -f tfplan
  exit 1
fi

echo "  ✓ Safety check passed (no critical database resources will be deleted)"
echo ""

# SSL certificate state drift 対策: managed SSL certificateが存在すればstateにimport
if terraform state list 2>/dev/null | grep -q "module.load_balancer.google_compute_managed_ssl_certificate"; then
  echo "  ℹ️  SSL certificate already in state"
else
  SSL_CERT_IN_PLAN=$(echo "${PLAN_JSON}" | jq -r '.resource_changes[]? | select(.type=="google_compute_managed_ssl_certificate") | .address' 2>/dev/null || true)
  if [[ -n "${SSL_CERT_IN_PLAN}" ]]; then
    echo "  ℹ️  SSL certificate will be created/managed by Terraform"
  fi
fi
echo ""

# apply 実行（plan 生成時に -exclude を適用済みのため、tfplan をそのまま使用）
echo "🚀 Running Terraform apply..."
terraform apply -auto-approve -input=false -lock-timeout=10m tfplan || {
  echo "❌ Error: Terraform apply failed"
  echo "  Check the error output above for details"
  rm -f tfplan
  exit 1
}
rm -f tfplan
echo "  ✓ Apply completed"
echo ""

echo "✓ Terraform apply completed successfully"
