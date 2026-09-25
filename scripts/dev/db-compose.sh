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

# up / rm でサービス名が指定されていれば、そのサービス（と、それがマウントする volume）だけを判定する。
# 全サービスを見ると、触らない pgadmin の衝突で db:up:test まで止まる（scripts/worktree.sh の手動
# worktree は pgadmin の名前を main から引き継ぐので、ここで必ず止まっていた）。down は宣言した全 volume を
# 消すので、常に全サービスを判定する。フラグの値（--timeout 10 の 10 等）はサービス名として紛れ込むが、
# 存在しないサービス名は判定対象を増やさないだけで害は無い。
services=()
case "${1:-}" in
  up | rm)
    for arg in "${@:2}"; do
      case "$arg" in
        -*) ;;
        *) services+=("$arg") ;;
      esac
    done
    ;;
esac

rc=0
foreign="$(compose_foreign_resources "$ROOT" ${services[@]+"${services[@]}"})" || rc=$?
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
