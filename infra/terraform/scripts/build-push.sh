#!/usr/bin/env bash
set -euo pipefail

REGION=${REGION:-asia-northeast1}
PROJECT_ID=${PROJECT_ID:?"PROJECT_ID is required"}

# リポジトリルートに移動（この後のパス解決のため）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
cd "${REPO_ROOT}"

# PREFIX の決定（優先順位: 環境変数 > terraform.tfvars > デフォルト値 'ax'）
if [[ -n "${PREFIX:-}" ]]; then
  echo "Using PREFIX from environment variable: ${PREFIX}"
else
  TFVARS_FILE="${REPO_ROOT}/infra/terraform/terraform.tfvars"
  if [[ -f "${TFVARS_FILE}" ]]; then
    # コメント行を除外してprefixを抽出
    TFVARS_PREFIX=$(grep '^[[:space:]]*prefix[[:space:]]*=' "${TFVARS_FILE}" | sed -n "s/.*prefix[[:space:]]*=[[:space:]]*[\"']\([^\"']*\)[\"'].*/\1/p" | head -1)
    if [[ -n "${TFVARS_PREFIX}" ]]; then
      PREFIX="${TFVARS_PREFIX}"
      echo "Using PREFIX from terraform.tfvars: ${PREFIX}"
    fi
  fi
fi

# PREFIX が未設定の場合はデフォルト値を使用
if [[ -z "${PREFIX:-}" ]]; then
  PREFIX="ax"
  echo "Using default PREFIX: ${PREFIX}"
fi

echo "Using prefix: ${PREFIX}"
REPO="${PREFIX}-repo"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"
PLATFORM=${PLATFORM:-linux/amd64}
SHA_TAG=""
if [[ -n "${COMMIT_SHA:-}" ]]; then
  SHA_TAG="sha-${COMMIT_SHA:0:7}"
  echo "Commit SHA tag: ${SHA_TAG}"
fi
echo "Registry: ${REGISTRY}"

# Ensure buildx builder with docker-container driver (required for cache export)
BUILDER_NAME="${PREFIX}-builder"
if ! docker buildx inspect "${BUILDER_NAME}" >/dev/null 2>&1; then
  echo "Creating docker buildx builder (docker-container driver)..."
  docker buildx create --use --name "${BUILDER_NAME}" --driver docker-container || true
else
  docker buildx use "${BUILDER_NAME}"
fi

echo "Login to Artifact Registry"
gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet

build_and_push() {
  local name=$1
  local dockerfile=$2
  local target=${3:-}
  # Remaining args (4th onwards) are passed as extra build args to docker buildx
  # e.g., build_and_push server Dockerfile runner --build-arg FOO=bar
  local -a extra_build_args=()
  if [[ $# -gt 3 ]]; then
    shift 3
    extra_build_args=("$@")
  fi
  local cache_ref="${REGISTRY}/${name}:cache"
  local target_flag=""
  if [[ -n "${target}" ]]; then
    target_flag="--target=${target}"
  fi
  local tags=("-t" "${REGISTRY}/${name}:latest")
  if [[ -n "${SHA_TAG}" ]]; then
    tags+=("-t" "${REGISTRY}/${name}:${SHA_TAG}")
  fi
  echo "Building ${name} for platform ${PLATFORM} and pushing to ${REGISTRY}/${name}:latest${SHA_TAG:+ + ${SHA_TAG}}"
  docker buildx build \
    --platform "${PLATFORM}" \
    "${tags[@]}" \
    -f "${dockerfile}" \
    ${target_flag} \
    --cache-from=type=registry,ref="${cache_ref}" \
    --cache-to=type=registry,ref="${cache_ref}",mode=max \
    "${extra_build_args[@]}" \
    . \
    --push
}

# client は独立した Dockerfile なので並列でビルド開始
build_and_push client apps/client/Dockerfile &
PID_CLIENT=$!

# server → migrate は同じ Dockerfile を共有し、builder キャッシュを活用するため直列
build_and_push server apps/api-service/Dockerfile runner
echo "server: OK"
build_and_push migrate apps/api-service/Dockerfile migrate
echo "migrate: OK"

# client の完了を待つ
wait "${PID_CLIENT}"
echo "client: OK"

echo "Done: pushed linux/amd64 images to ${REGISTRY}"
