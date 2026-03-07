#!/usr/bin/env bash
set -euo pipefail

# ローカルでDockerビルドをテストするスクリプト
# CIのbuild-push.shと同じロジックでビルドのみ実行（pushはしない）

echo "=== Testing Docker builds locally ==="

REGION=${REGION:-asia-northeast1}
PROJECT_ID=${PROJECT_ID:-local-test}
# Extract prefix from tfvars
TFVARS_FILE="infra/terraform/terraform.tfvars"
PREFIX="ax"
if [[ -f "${TFVARS_FILE}" ]]; then
  TFVARS_PREFIX=$(grep 'prefix' "${TFVARS_FILE}" | sed -n "s/.*prefix[[:space:]]*=[[:space:]]*[\"']\([^\"']*\)[\"'].*/\1/p" | head -1)
  if [[ -n "${TFVARS_PREFIX}" ]]; then
    PREFIX="${TFVARS_PREFIX}"
  fi
fi

REPO="${PREFIX}-repo"
PLATFORM=${PLATFORM:-linux/amd64}

cd "$(dirname "$0")/../.."

# Ensure buildx builder is available
if ! docker buildx inspect >/dev/null 2>&1; then
  echo "Creating docker buildx builder..."
  docker buildx create --use --name "${PREFIX}-builder" || true
fi

build_local() {
  local name=$1
  local dockerfile=$2
  echo ""
  echo "=== Building ${name} for platform ${PLATFORM} ==="
  docker buildx build \
    --platform "${PLATFORM}" \
    -t "local/${name}:test" \
    -f "${dockerfile}" \
    . \
    --load
  echo "✓ ${name} built successfully"
}

echo "Building server..."
build_local server apps/api-service/Dockerfile

echo "Building client..."
build_local client apps/client/Dockerfile

echo ""
echo "=== All builds completed successfully ==="
echo "Note: Images are tagged as 'local/*:test' and not pushed to any registry"

