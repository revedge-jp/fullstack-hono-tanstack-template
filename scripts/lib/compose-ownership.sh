#!/usr/bin/env bash
#
# compose が解決するコンテナ・volume のうち、既に存在して**別の compose プロジェクトの持ち物**に
# なっているものを列挙する。db:up / db:down（scripts/dev/db-compose.sh）と WorktreeCreate フック
# （.claude/hooks/worktree-lib.sh）が、compose を動かす前に呼ぶ。
#
# なぜ要るか: docker-compose.yml の既定名（app_postgres / app-postgres-data 等）はこのテンプレートから
# 作った全プロジェクトで共通で、named volume はプロジェクトを跨いだグローバルな名前解決になる。
# 既定名のまま up すると他プロジェクトの稼働中 DB の volume を2つ目の Postgres がマウントし（データ
# 破損）、down -v すると他プロジェクトの DB の volume を消しうる。compose の --no-recreate は自プロジェクト
# 内の作り直しを防ぐだけで、これは防がない。
#
# 使い方: compose_foreign_resources <project_dir> [service...]
#   service を渡すとそのサービスのコンテナ名と、そのサービスがマウントする volume だけを見る。
#   省略時は全サービス。1件につき1行「<container|volume> <名前> <持ち主(空なら compose 外)>」を出す。
#   戻り値: 0=判定できた（出力が空なら衝突なし）、2=compose 設定を解決できない
#
# 前提コマンド: docker / jq

compose_foreign_resources() {
  local dir="$1"
  shift
  local cfg project services res owner
  if ! cfg="$(docker compose --project-directory "$dir" config --format json 2>/dev/null)"; then
    return 2
  fi
  project="$(printf '%s' "$cfg" | jq -r '.name')"
  services="$(printf '%s\n' "$@" | jq -R 'select(length > 0)' | jq -s '.')"

  while IFS= read -r res; do
    [ -n "$res" ] || continue
    owner="$(docker container inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$res" 2>/dev/null)" || continue
    [ "$owner" = "$project" ] || printf 'container %s %s\n' "$res" "$owner"
  done < <(printf '%s' "$cfg" | jq -r --argjson svcs "$services" '
    .services | to_entries[]
    | select(($svcs | length) == 0 or (.key as $k | $svcs | index($k)))
    | .value.container_name // empty')

  while IFS= read -r res; do
    [ -n "$res" ] || continue
    owner="$(docker volume inspect -f '{{index .Labels "com.docker.compose.project"}}' "$res" 2>/dev/null)" || continue
    [ "$owner" = "$project" ] || printf 'volume %s %s\n' "$res" "$owner"
  done < <(printf '%s' "$cfg" | jq -r --argjson svcs "$services" '
    . as $root
    | [.services | to_entries[]
       | select(($svcs | length) == 0 or (.key as $k | $svcs | index($k)))
       | .value.volumes[]? | select(.type == "volume") | .source]
    | unique[]
    | $root.volumes[.].name // empty')
  return 0
}

# compose_foreign_resources の出力を人が読める形で stderr に出す
print_foreign_resources() {
  local kind name owner
  while read -r kind name owner; do
    [ -n "$kind" ] || continue
    printf '  %s %s は別プロジェクト（%s）のものです\n' "$kind" "$name" "${owner:-compose 外}" >&2
  done
  printf '  .env で POSTGRES_CONTAINER_NAME / POSTGRES_TEST_CONTAINER_NAME / POSTGRES_VOLUME_NAME /\n' >&2
  printf '  PGADMIN_CONTAINER_NAME / PGADMIN_VOLUME_NAME をこのプロジェクト固有の値にしてください（.env.example 参照）\n' >&2
}
