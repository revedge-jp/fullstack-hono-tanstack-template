#!/usr/bin/env bash
# デプロイ直後の稼働確認（post-deploy smoke check）。
# - /api/health: API と DB 接続（本番では Hyperdrive 経由）の疎通を検証する。
#   prod-shape E2E では Hyperdrive バインディングの分岐まではカバーできないため、
#   実環境に対するこのチェックが最後の砦になる。
# - / : SSR がレスポンスを返すことを検証する（未認証リダイレクト込みで最終 200）。
set -euo pipefail

BASE_URL="${1:-}"
if [ -z "$BASE_URL" ]; then
  echo "::notice::SMOKE_BASE_URL is not configured for this environment. Skipping smoke check."
  echo "Set it under Settings > Environments > (staging|production) > Variables."
  exit 0
fi
BASE_URL="${BASE_URL%/}"

echo "==> Smoke checking $BASE_URL ..."

# デプロイ直後はエッジへの反映に数秒かかることがあるためリトライする
attempt=0
until curl -fsS --max-time 10 "$BASE_URL/api/health" > /dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 5 ]; then
    echo "::error::GET $BASE_URL/api/health did not become healthy after $attempt attempts."
    exit 1
  fi
  echo "  /api/health not ready yet (attempt $attempt), retrying in 5s..."
  sleep 5
done
echo "OK: /api/health"

# /api/health と同じエッジ反映ラグの影響を受けるため、同じリトライ回数・間隔を適用する
# （/api/health だけリトライしても、直後に叩く / が反映ラグで一度だけ 404 を返すと
# 誤検知でロールバックが走ってしまう）
attempt=0
while true; do
  status="$(curl -sL -o /dev/null -w '%{http_code}' --max-time 10 "$BASE_URL/")"
  if [ "$status" = "200" ]; then
    break
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 5 ]; then
    echo "::error::GET $BASE_URL/ returned $status (expected 200) after $attempt attempts."
    exit 1
  fi
  echo "  / not ready yet (attempt $attempt, status $status), retrying in 5s..."
  sleep 5
done
echo "OK: / ($status)"

echo "==> Smoke check passed."
