#!/usr/bin/env bash
#
# bun run db:up / db:down 系の入口。compose を動かす前に、compose が起動・削除する DB のコンテナ・volume が
# 別の compose プロジェクトの持ち物でないかを確かめる（scripts/lib/compose-ownership.sh）。
# 既定名のまま他プロジェクトと衝突していると、up は他プロジェクトの DB の volume をマウントし、
# down -v はそれを消しうるため、その場合は compose を動かさずに止める。
#
# 使い方: bash scripts/dev/db-compose.sh <preset> [追加の docker compose 引数...]
#   preset: up / down / up-test / down-test / up-all（package.json の db:* と1対1）
#
# 判定対象はプリセットで決める。compose の引数を解析して「どのサービスに触るか」を推測しない —
# フラグの値（--pull missing / --no-attach postgres-test 等）をサービス指定と取り違え、判定を
# 素通りさせる穴が引数の形ごとに出る（PR レビューで2周続けて踏んだ）。
# - 追加の引数が渡されたら、何に触るか分からないので全サービスを判定する
# - サービスを絞るプリセットは、依存先（depends_on で一緒に起動するもの）まで compose 自身に解決させる
# - down は宣言した全 volume を消すので、常に全サービスを判定する

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

preset="${1:-}"
[ $# -gt 0 ] && shift
case "$preset" in
  up) compose_args=(up -d) scope=() ;;
  down) compose_args=(down -v) scope=() ;;
  up-test) compose_args=(up -d postgres-test) scope=(postgres-test) ;;
  down-test) compose_args=(rm -sf postgres-test) scope=(postgres-test) ;;
  up-all) compose_args=(up -d postgres postgres-test --wait) scope=(postgres postgres-test) ;;
  *)
    echo "使い方: bash scripts/dev/db-compose.sh <up|down|up-test|down-test|up-all> [追加の引数...]" >&2
    exit 1
    ;;
esac

for tool in docker jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "❌ $tool が見つかりません（DB コンテナの持ち主の確認に必要です）" >&2
    [ "$tool" = jq ] && echo "   brew install jq" >&2
    exit 1
  fi
done

# shellcheck source=../lib/compose-ownership.sh
source "$ROOT/scripts/lib/compose-ownership.sh"

services=()
if [ $# -eq 0 ] && [ "${#scope[@]}" -gt 0 ]; then
  while IFS= read -r svc; do
    [ -n "$svc" ] && services+=("$svc")
  done < <(docker compose config --format json "${scope[@]}" 2>/dev/null | jq -r '.services | keys[]')
  # 依存先の解決に失敗して空になったら、全サービスを判定する（安全側）
fi

rc=0
foreign="$(compose_foreign_resources "$ROOT" ${services[@]+"${services[@]}"})" || rc=$?
if [ "$rc" -eq 2 ]; then
  echo "❌ docker compose の設定を解決できません（docker-compose.yml と .env を確認してください）" >&2
  exit 1
fi
if [ -n "$foreign" ]; then
  echo "❌ DB コンテナ / volume の名前が別プロジェクトと衝突しているため、docker compose ${compose_args[0]} を実行しません" >&2
  printf '%s\n' "$foreign" | print_foreign_resources
  exit 1
fi

exec docker compose "${compose_args[@]}" "$@"
