#!/usr/bin/env bash
#
# bun run db:up / db:down 系の入口。compose を動かす前に、compose が解決するコンテナ・volume が
# 別の compose プロジェクトの持ち物でないかを確かめる（scripts/lib/compose-ownership.sh）。
# 既定名のまま他プロジェクトと衝突していると、up は他プロジェクトの DB の volume をマウントし、
# down -v はそれを消しうるため、その場合は compose を動かさずに止める。
#
# 使い方: bash scripts/dev/db-compose.sh <docker compose の引数...>
#   例: bash scripts/dev/db-compose.sh up -d postgres postgres-test --wait

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

for tool in docker jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "❌ $tool が見つかりません（DB コンテナの持ち主の確認に必要です）" >&2
    [ "$tool" = jq ] && echo "   brew install jq" >&2
    exit 1
  fi
done

# shellcheck source=../lib/compose-ownership.sh
source "$ROOT/scripts/lib/compose-ownership.sh"

rc=0
foreign="$(compose_foreign_resources "$ROOT")" || rc=$?
if [ "$rc" -eq 2 ]; then
  echo "❌ docker compose の設定を解決できません（docker-compose.yml と .env を確認してください）" >&2
  exit 1
fi
if [ -n "$foreign" ]; then
  echo "❌ DB コンテナ / volume の名前が別プロジェクトと衝突しているため、docker compose $1 を実行しません" >&2
  printf '%s\n' "$foreign" | print_foreign_resources
  exit 1
fi

exec docker compose "$@"
