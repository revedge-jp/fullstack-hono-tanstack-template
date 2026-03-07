#!/usr/bin/env bash
set -euo pipefail

# Sync Secret Manager `database-url` and Cloud SQL user password (appuser)
# Usage:
#   PROJECT_ID=xxx INSTANCE=ax-db USER=appuser PASSWORD='plain' ./secret-sync-db-url.sh
# Password resolution order:
#   1. PASSWORD environment variable
#   2. DB_PASSWORD environment variable
#   3. terraform.tfvars (db_password value)
#   4. PASSWORD_FILE environment variable (file path)
#   5. Interactive prompt

PROJECT_ID=${PROJECT_ID:?"PROJECT_ID is required"}

# Extract prefix from terraform.tfvars
# PREFIX の決定（優先順位: 環境変数 > terraform.tfvars > デフォルト値 'ax'）
TFVARS_FILE="$(dirname "$0")/../terraform.tfvars"
if [[ -n "${PREFIX:-}" ]]; then
  echo "Using PREFIX from environment variable: ${PREFIX}"
else
  PREFIX="ax"
  if [[ -f "${TFVARS_FILE}" ]]; then
    # コメント行を除外してprefixを抽出
    TFVARS_PREFIX=$(grep '^[[:space:]]*prefix[[:space:]]*=' "${TFVARS_FILE}" | sed -n "s/.*prefix[[:space:]]*=[[:space:]]*[\"']\([^\"']*\)[\"'].*/\1/p" | head -1)
    if [[ -n "${TFVARS_PREFIX}" ]]; then
      PREFIX="${TFVARS_PREFIX}"
      echo "Using PREFIX from terraform.tfvars: ${PREFIX}"
    fi
  fi
fi

INSTANCE=${INSTANCE:-${PREFIX}-db}
USER=${USER:-appuser}
PASSWORD_FILE=${PASSWORD_FILE:-}
PASSWORD=${PASSWORD:-${DB_PASSWORD:-}}
SECRET_ID="${PREFIX}-database-url"

# Try reading from terraform.tfvars if PASSWORD is not set
if [[ -z "${PASSWORD}" ]]; then
  TFVARS_FILE="$(dirname "$0")/../terraform.tfvars"
  if [[ -f "${TFVARS_FILE}" ]]; then
    # Extract db_password value from terraform.tfvars
    # Handles: db_password = "value" or db_password = 'value'
    TFVARS_PASSWORD=$(grep 'db_password' "${TFVARS_FILE}" | sed -n "s/.*db_password[[:space:]]*=[[:space:]]*[\"']\([^\"']*\)[\"'].*/\1/p" | head -1)
    if [[ -z "${TFVARS_PASSWORD}" ]]; then
      # Fallback: try without quotes (shouldn't happen in practice)
      TFVARS_PASSWORD=$(grep 'db_password' "${TFVARS_FILE}" | awk '{print $NF}' | head -1)
    fi
    if [[ -n "${TFVARS_PASSWORD}" ]]; then
      PASSWORD="${TFVARS_PASSWORD}"
    fi
  fi
fi

# Prefer reading from file if provided
if [[ -z "${PASSWORD}" && -n "${PASSWORD_FILE}" && -f "${PASSWORD_FILE}" ]]; then
  PASSWORD=$(cat "${PASSWORD_FILE}")
fi

# Secure interactive prompt as a fallback
if [[ -z "${PASSWORD}" ]]; then
  read -s -p "Enter Cloud SQL password for user ${USER}: " PASSWORD
  echo ""
fi

if [[ -z "${PASSWORD}" ]]; then
  echo "Password is required (use PASSWORD env, PASSWORD_FILE, or interactive prompt)" >&2
  exit 1
fi

echo "[1/3] fetch Cloud SQL private IP"
HOST=$(gcloud sql instances describe "${INSTANCE}" --project "${PROJECT_ID}" --format='value(ipAddresses.ipAddress)')
if [[ -z "${HOST}" ]]; then
  echo "Failed to obtain instance IP" >&2
  exit 1
fi

if [[ "${SKIP_SQL_PASSWORD:-0}" != "1" ]]; then
  echo "[2/3] update Cloud SQL user password"
  # REST API 経由でパスワードを更新（コマンドライン引数へのパスワード露出を回避）
  ACCESS_TOKEN=$(gcloud auth print-access-token)
  curl -sf -X PUT \
    "https://sqladmin.googleapis.com/v1/projects/${PROJECT_ID}/instances/${INSTANCE}/users?name=${USER}&host=" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"password\": \"${PASSWORD}\"}"
else
  echo "[2/3] skip Cloud SQL user password update (SKIP_SQL_PASSWORD=1)"
fi

echo "[3/3] write Secret Manager: ${SECRET_ID} (latest)"
ENC_PW=$(python3 - <<'PY' "$PASSWORD"
import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=''))
PY
)
URL="postgresql://${USER}:${ENC_PW}@${HOST}:5432/app?schema=public&sslmode=require&uselibpqcompat=true&sslrootcert=/secrets/cloudsql/server-ca.pem"

CURRENT_URL=$(gcloud secrets versions access latest --secret="${SECRET_ID}" --project="${PROJECT_ID}" 2>/dev/null || echo "")
if [[ "${URL}" == "${CURRENT_URL}" ]]; then
  echo "  Secret ${SECRET_ID} is already up to date, skipping"
else
  printf '%s' "${URL}" | gcloud secrets versions add "${SECRET_ID}" --project "${PROJECT_ID}" --data-file=-
  echo "  Secret ${SECRET_ID} updated"
fi

echo "Done. Cloud SQL password synchronized."


