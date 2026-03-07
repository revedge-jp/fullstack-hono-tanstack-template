#!/usr/bin/env bash
set -euo pipefail

# ワークフローのGet DB passwordステップをローカルでテスト

# Extract prefix from tfvars if exists (but this script mostly uses project_id)
# PROJECT_ID should be passed as env var or set here
PROJECT_ID=${PROJECT_ID:-your-project-id}

# Extract prefix from tfvars
TFVARS_FILE="infra/terraform/terraform.tfvars"
PREFIX="ax"
if [[ -f "${TFVARS_FILE}" ]]; then
  TFVARS_PREFIX=$(grep 'prefix' "${TFVARS_FILE}" | sed -n "s/.*prefix[[:space:]]*=[[:space:]]*[\"']\([^\"']*\)[\"'].*/\1/p" | head -1)
  if [[ -n "${TFVARS_PREFIX}" ]]; then
    PREFIX="${TFVARS_PREFIX}"
  fi
fi
SECRET_ID="${PREFIX}-database-url"

echo "=== Testing Get DB Password Step ==="
echo "PROJECT_ID: ${PROJECT_ID}"
echo "SECRET_ID: ${SECRET_ID}"
echo ""

# まずdatabase-urlからパスワードを取得を試行
echo "📋 Trying to get password from ${SECRET_ID}..."
set +e
DATABASE_URL=$(gcloud secrets versions access latest \
  --secret="${SECRET_ID}" \
  --project="${PROJECT_ID}" 2>&1)
SECRET_CODE=${PIPESTATUS[0]}
set -e

if [ ${SECRET_CODE} -eq 0 ] && [ -n "${DATABASE_URL}" ]; then
  echo "  ✓ database-url found"
  echo "  URL: ${DATABASE_URL:0:50}..."
  echo ""
  
  # database-urlからパスワードを抽出
  echo "📋 Extracting password from database-url..."
  PASSWORD=$(echo "${DATABASE_URL}" | sed -n 's|postgresql://[^:]*:\([^@]*\)@.*|\1|p' | python3 -c 'import sys, urllib.parse; print(urllib.parse.unquote(sys.stdin.read().strip()))' 2>/dev/null || echo "")
  
  if [ -n "${PASSWORD}" ]; then
    echo "  ✓ Password extracted successfully"
    echo "  Password length: ${#PASSWORD} characters"
    echo "  Password preview: ${PASSWORD:0:3}***"
    echo ""
    echo "✓ Test passed: ${SECRET_ID}からパスワードを取得できました"
    exit 0
  else
    echo "  ✗ Failed to extract password from ${SECRET_ID}"
    echo "  DATABASE_URL format might be incorrect"
    exit 1
  fi
fi

echo "  ✗ ${SECRET_ID} not found or empty"
echo "  SECRET_CODE: ${SECRET_CODE}"
echo "  DATABASE_URL: ${DATABASE_URL}"
echo ""
echo "  This is expected if ${SECRET_ID} doesn't exist yet."
echo "  In workflow, STG_DB_PASSWORD secret would be used as fallback."
exit 0

