#!/usr/bin/env bash
set -euo pipefail

# Cloud Run リビジョンが READY 状態になるまで待機するスクリプト
# 使用方法:
#   SERVICE=ax-server REGION=asia-northeast1 PROJECT_ID=my-project bash wait-revision-ready.sh

SERVICE=${SERVICE:?"SERVICE is required (e.g., ax-server)"}
REGION=${REGION:?"REGION is required (e.g., asia-northeast1)"}
PROJECT_ID=${PROJECT_ID:?"PROJECT_ID is required"}
TIMEOUT=${TIMEOUT:-600}  # デフォルト10分
POLL_INTERVAL=${POLL_INTERVAL:-5}

echo "=== Waiting for Cloud Run revision to be ready ==="
echo "Service: ${SERVICE}"
echo "Region: ${REGION}"
echo "Project: ${PROJECT_ID}"
echo "Timeout: ${TIMEOUT}s"
echo ""

# 最新のリビジョン名を取得
echo "📋 Getting latest revision..."
LATEST_REVISION=$(gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format='value(status.latestCreatedRevisionName)' 2>/dev/null || echo "")

if [ -z "${LATEST_REVISION}" ]; then
  echo "❌ Error: Could not get latest revision name"
  echo "  Service may not exist or you may not have access"
  exit 1
fi

echo "  Latest revision: ${LATEST_REVISION}"
echo ""

# リビジョンが READY になるまで待機
echo "⏳ Waiting for revision to be ready..."
START=$(date +%s)
ITERATION=0
MAX_ITERATIONS=$((TIMEOUT / POLL_INTERVAL))

while [ ${ITERATION} -lt ${MAX_ITERATIONS} ]; do
  ITERATION=$((ITERATION + 1))
  
  # リビジョンの状態を取得
  set +e
  REVISION_JSON=$(gcloud run revisions describe "${LATEST_REVISION}" \
    --region="${REGION}" \
    --project="${PROJECT_ID}" \
    --format=json 2>&1)
  DESCRIBE_CODE=$?
  set -e
  
  if [ ${DESCRIBE_CODE} -ne 0 ]; then
    echo "⚠ Warning: Failed to describe revision (attempt ${ITERATION}/${MAX_ITERATIONS})"
    echo "  Error: ${REVISION_JSON}" | head -3
    sleep ${POLL_INTERVAL}
    continue
  fi
  
  # Ready 状態をチェック（status.conditions[0] の type="Ready" かつ status="True"）
  READY_STATUS=$(echo "${REVISION_JSON}" | jq -r '.status.conditions[]? | select(.type=="Ready") | .status' 2>/dev/null || echo "")
  READY_REASON=$(echo "${REVISION_JSON}" | jq -r '.status.conditions[]? | select(.type=="Ready") | .reason' 2>/dev/null || echo "")
  
  NOW=$(date +%s)
  ELAPSED=$((NOW - START))
  
  # ステータスを表示
  printf "  [%3ds] iteration=%3d | ready=%s | reason=%s\n" \
    "${ELAPSED}" "${ITERATION}" "${READY_STATUS:-unknown}" "${READY_REASON:-unknown}"
  
  # Ready 判定
  if [ "${READY_STATUS}" = "True" ]; then
    echo ""
    echo "✓ Revision is READY"
    echo "  Revision: ${LATEST_REVISION}"
    echo "  Elapsed: ${ELAPSED}s"
    echo ""
    # 標準出力にリビジョン名を出力（スクリプトから利用可能）
    echo "${LATEST_REVISION}"
    exit 0
  fi
  
  # 失敗判定（Reason が明示的にエラーを示している場合）
  if [[ "${READY_REASON}" =~ (Failed|Error|ContainerError) ]]; then
    echo ""
    echo "❌ Revision failed to become ready"
    echo "  Revision: ${LATEST_REVISION}"
    echo "  Status: ${READY_STATUS}"
    echo "  Reason: ${READY_REASON}"
    echo ""
    echo "  Check logs:"
    echo "    gcloud run revisions logs ${LATEST_REVISION} --region=${REGION} --project=${PROJECT_ID}"
    exit 1
  fi
  
  # タイムアウトチェック
  if [ ${ELAPSED} -ge ${TIMEOUT} ]; then
    echo ""
    echo "❌ Timeout: Revision not ready after ${TIMEOUT}s"
    echo "  Revision: ${LATEST_REVISION}"
    echo "  Last status: ${READY_STATUS}"
    echo "  Last reason: ${READY_REASON}"
    echo ""
    echo "  Check logs:"
    echo "    gcloud run revisions logs ${LATEST_REVISION} --region=${REGION} --project=${PROJECT_ID}"
    exit 1
  fi
  
  sleep ${POLL_INTERVAL}
done

# 理論上は到達しないはずだが、念のため
echo ""
echo "❌ Unexpected exit: Maximum iterations reached"
exit 1


