#!/usr/bin/env bash
# preview 環境（stage = pr-N）のリソースが実際に消えたかを確かめる。
#
#   bash scripts/deploy/verify-preview-destroyed.sh pr-123
#
# `alchemy destroy` は削除に失敗しても exit 0 で終わる（alchemy 0.93 の lib/alchemy.js が destroy の
# 例外を握って process.exit(0) する）。そのままだと PlanetScale の DB ブランチ（PS-DEV、存在時間で課金）が
# 残っても緑になるので、destroy の後で PlanetScale / Cloudflare の API に実物を問い合わせる。
#
# 終了コード: 0 = すべて無い / 1 = 残っている / 2 = API に問い合わせられず確かめられない
# 必要な環境変数: APP_NAME, PLANETSCALE_ORGANIZATION, PLANETSCALE_SERVICE_TOKEN_ID,
#   PLANETSCALE_SERVICE_TOKEN, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
set -euo pipefail

STAGE="${1:-}"
if ! [[ "$STAGE" =~ ^pr-[0-9]+$ ]]; then
  echo "使い方: bash scripts/deploy/verify-preview-destroyed.sh pr-<PR番号>" >&2
  exit 2
fi
for name in APP_NAME PLANETSCALE_ORGANIZATION PLANETSCALE_SERVICE_TOKEN_ID PLANETSCALE_SERVICE_TOKEN \
  CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID; do
  if [ -z "${!name:-}" ]; then
    echo "::error::${name} が未設定のため、preview の削除を確かめられません" >&2
    exit 2
  fi
done

# 名前は alchemy.run.ts と揃える（DB ブランチ = staging DB の <stage>、Worker / Hyperdrive = <APP_NAME>-<stage>）
DATABASE="${APP_NAME}-staging"
RESOURCE_NAME="${APP_NAME}-${STAGE}"
PS_API="https://api.planetscale.com/v1/organizations/${PLANETSCALE_ORGANIZATION}/databases/${DATABASE}"
CF_API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}"

http_status() {
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$@") || true
  printf '%s' "${code:-000}"
}

# Hyperdrive は名前で引く API が無いので一覧を全ページ辿る（alchemy の findHyperdriveConfigByName と同じ方式）。
# 出力: found / absent / unknown
hyperdrive_state() {
  local page=1 configs found total_pages
  while true; do
    if ! configs=$(curl -sSf --max-time 20 -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      "${CF_API}/hyperdrive/configs?page=${page}" 2>/dev/null); then
      echo unknown
      return
    fi
    # jq -e の終了コード: 0 = 一致あり / 1 = 一致なし / それ以外 = 応答を読めない（「無い」扱いにしない）
    found=0
    printf '%s' "$configs" | jq -e --arg name "$RESOURCE_NAME" \
      'if (.result | type) == "array" then any(.result[]; .name == $name) else error("result がありません") end' \
      >/dev/null 2>&1 || found=$?
    case "$found" in
      0) echo found; return ;;
      1) ;;
      *) echo unknown; return ;;
    esac
    total_pages=$(printf '%s' "$configs" | jq -r '.result_info.total_pages // 1')
    if ! [[ "$total_pages" =~ ^[0-9]+$ ]] || [ "$page" -ge "$total_pages" ]; then
      echo absent
      return
    fi
    page=$((page + 1))
  done
}

# 1 回の問い合わせで「残っているもの」を remaining に積む。確かめられなかったら unknown に積む
check_once() {
  remaining=""
  unknown=""

  # PlanetScale の DB ブランチは削除が非同期で、DELETE の直後はまだ GET できることがある
  status=$(http_status -H "Authorization: ${PLANETSCALE_SERVICE_TOKEN_ID}:${PLANETSCALE_SERVICE_TOKEN}" \
    "${PS_API}/branches/${STAGE}")
  case "$status" in
    404) ;;
    200) remaining="$remaining PlanetScale:${DATABASE}/${STAGE}" ;;
    *) unknown="$unknown PlanetScale(HTTP ${status})" ;;
  esac

  status=$(http_status -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    "${CF_API}/workers/scripts/${RESOURCE_NAME}/settings")
  case "$status" in
    404) ;;
    200) remaining="$remaining Worker:${RESOURCE_NAME}" ;;
    *) unknown="$unknown Worker(HTTP ${status})" ;;
  esac

  case "$(hyperdrive_state)" in
    found) remaining="$remaining Hyperdrive:${RESOURCE_NAME}" ;;
    absent) ;;
    *) unknown="$unknown Hyperdrive(一覧を取得・解釈できない)" ;;
  esac
}

attempt=1
max_attempts="${VERIFY_ATTEMPTS:-6}"
while true; do
  check_once
  if [ -z "$remaining" ] && [ -z "$unknown" ]; then
    echo "preview ${STAGE} のリソースは残っていません"
    exit 0
  fi
  if [ "$attempt" -ge "$max_attempts" ]; then
    break
  fi
  interval="${VERIFY_INTERVAL_SECONDS:-10}"
  echo "  残り:${remaining:- なし} / 未確認:${unknown:- なし}（${attempt}/${max_attempts} 回目。${interval} 秒後に再確認）"
  attempt=$((attempt + 1))
  sleep "$interval"
done

if [ -n "$remaining" ]; then
  echo "::error::preview ${STAGE} の削除後もリソースが残っています:${remaining}。課金が続くので手で削除してください（docs/deploy/cloudflare-workers.md「PR プレビュー環境（opt-in）」）"
  exit 1
fi
echo "::error::preview ${STAGE} の削除を確かめられませんでした:${unknown}"
exit 2
