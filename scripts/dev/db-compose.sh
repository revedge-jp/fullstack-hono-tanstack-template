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

# up / rm でサービス名が指定されていれば、そのサービスと**依存先**（depends_on で一緒に起動するもの）
# だけを判定する。全サービスを見ると、触らない pgadmin の衝突で db:up:test まで止まる（scripts/worktree.sh
# の手動 worktree は pgadmin の名前を main から引き継ぐので、ここで必ず止まっていた）。
# - 位置引数は実在のサービス名と突き合わせる。フラグの値（--pull missing の missing 等）だけが残って
#   実在のサービスが1つも無いときは全サービスを判定する（絞り込むと何も判定されず素通りになる）
# - 依存先は compose 自身に解決させる（`config --format json <svc>` は依存先を含めて返す）
# - down は宣言した全 volume を消すので、常に全サービスを判定する
services=()
case "${1:-}" in
  up | rm)
    all_services="$(docker compose config --services 2>/dev/null || true)"
    named=()
    for arg in "${@:2}"; do
      if printf '%s\n' "$all_services" | grep -qxF -- "$arg"; then
        named+=("$arg")
      fi
    done
    if [ "${#named[@]}" -gt 0 ]; then
      while IFS= read -r svc; do
        [ -n "$svc" ] && services+=("$svc")
      done < <(docker compose config --format json "${named[@]}" 2>/dev/null | jq -r '.services | keys[]')
      # 解決に失敗して空になったら、安全側に倒して全サービスを判定する
    fi
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
