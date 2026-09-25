#!/usr/bin/env bash
# PR プレビューの DB ブランチ（staging DB の `pr-<番号>` ブランチ）を PlanetScale API で確かめる。
# preview.yml / preview-cleanup.yml が使う。
#
#   bash scripts/deploy/preview-db-branch.sh wait-gone pr-123   # ブランチが消えるまで待つ（消えなければ exit 1）
#   bash scripts/deploy/preview-db-branch.sh list               # 残っている pr-<番号> ブランチを 1 行ずつ出す
#
# `alchemy destroy` は削除に失敗しても exit 0 で終わる（alchemy 0.93 の destroy は例外を握って
# process.exit(0) する）。PS-DEV ブランチは存在する間ずっと課金されるので、destroy の成否はここで確かめる。
#
# 必要な環境変数: APP_NAME / PLANETSCALE_ORGANIZATION / PLANETSCALE_SERVICE_TOKEN_ID / PLANETSCALE_SERVICE_TOKEN
set -euo pipefail

for key in APP_NAME PLANETSCALE_ORGANIZATION PLANETSCALE_SERVICE_TOKEN_ID PLANETSCALE_SERVICE_TOKEN; do
  if [ -z "${!key:-}" ]; then
    echo "::error::環境変数 ${key} が未設定です" >&2
    exit 1
  fi
done

API="https://api.planetscale.com/v1/organizations/${PLANETSCALE_ORGANIZATION}/databases/${APP_NAME}-staging/branches"
BODY_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE"' EXIT

# HTTP ステータスを標準出力に、本文を BODY_FILE に書く（接続失敗でも curl は -w の 000 を出す）。
# PlanetScale のサービストークンは Bearer を付けない `<ID>:<TOKEN>` 形式。
request() {
  curl -sS --max-time 20 -o "$BODY_FILE" -w '%{http_code}' \
    -H "Authorization: ${PLANETSCALE_SERVICE_TOKEN_ID}:${PLANETSCALE_SERVICE_TOKEN}" \
    -H "Accept: application/json" "$1" || true
}

wait_gone() {
  local stage="$1"
  if ! [[ "$stage" =~ ^pr-[0-9]+$ ]]; then
    echo "::error::stage は pr-<番号> で指定してください（現在: ${stage}）" >&2
    exit 1
  fi
  local attempt status
  # ブランチの削除は非同期に進むことがあるので、最大 2 分待つ
  for attempt in $(seq 1 12); do
    status=$(request "${API}/${stage}")
    if [ "$status" = "404" ]; then
      echo "DB ブランチ ${APP_NAME}-staging/${stage} は削除済みです"
      return 0
    fi
    echo "  ${stage} はまだ残っています（HTTP ${status}、${attempt}/12）。10 秒後に確かめ直します"
    sleep 10
  done
  echo "::error::DB ブランチ ${APP_NAME}-staging/${stage} が削除されていません（最後の応答: HTTP ${status}）。PS-DEV の課金が続くので、PlanetScale のダッシュボードで確認してください" >&2
  exit 1
}

list_branches() {
  local page=1 status
  while :; do
    status=$(request "${API}?page=${page}&per_page=100")
    if [ "$status" != "200" ]; then
      echo "::error::DB ブランチの一覧を取得できませんでした（HTTP ${status}）: $(head -c 300 "$BODY_FILE")" >&2
      exit 1
    fi
    jq -r '.data[].name | select(test("^pr-[0-9]+$"))' "$BODY_FILE"
    page=$(jq -r '.next_page // empty' "$BODY_FILE")
    [ -z "$page" ] && break
  done
}

case "${1:-}" in
  wait-gone) wait_gone "${2:-}" ;;
  list) list_branches ;;
  *)
    echo "使い方: bash scripts/deploy/preview-db-branch.sh <wait-gone pr-N|list>" >&2
    exit 1
    ;;
esac
