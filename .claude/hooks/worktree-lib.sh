#!/usr/bin/env bash
#
# WorktreeCreate / WorktreeRemove フック共用ロジック。
#
# 設計メモ:
#   - DB は worktree ごとにコンテナを立てず、main の共有コンテナ（postgres / postgres-test）内に
#     データベースを1つずつ切る（wt_<slug>）。コンテナ/ボリュームが増えないので使い捨ての
#     worktree に耐える。旧方式（agent-worktree-setup.sh のスロット方式）は worktree ごとに
#     コンテナ2つ + volume を作り、派生プロダクトでは実測で21コンテナ・0.8GiB が常駐した。
#   - アプリのポート（CLIENT/API）だけは worktree ごとに割り当てる。レジストリ + lsof の実測で
#     決め、旧方式の worktree や以前の手動 worktree（削除した scripts/worktree.sh 製）が .env に持つポートも予約扱い。
#   - ポートレジストリは git-common-dir（全 worktree で共有される main の .git）に置く。

set -euo pipefail

# main リポジトリのルート。
# スクリプトの位置から `../..` で求めてはいけない。worktree 側にコピーされた同名スクリプトから
# 実行された場合に worktree 自身を main と誤認するため。git-common-dir は全 worktree で共通して
# main の .git を指す。
_HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
_GIT_COMMON="$(git -C "$_HOOK_DIR" rev-parse --git-common-dir)"
_GIT_COMMON="$(cd "$_HOOK_DIR" && cd "$_GIT_COMMON" && pwd)"
MAIN_ROOT="$(dirname "$_GIT_COMMON")"

PORT_REGISTRY="$_GIT_COMMON/claude-worktree-ports.json"
PORT_LOCK="${PORT_REGISTRY}.lock"

# 旧方式（スロット計算）と同じ帯から探す。main は 3000/8080 既定。
CLIENT_PORT_BASE=3001
API_PORT_BASE=8082

log() { printf '  %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# worktree 名 → PostgreSQL のデータベース名（英小文字/数字/アンダースコア、63バイト上限）。
# 大文字小文字・記号を丸めたときや長さで切ったときは、元の名前の短いハッシュを付けて一意にする。
# 丸めるだけだと feat-x と feat_x が同じ wt_feat_x になり、片方の worktree を消すともう片方の DB が
# DROP されていた（作成側も「既に存在します」で黙って同じ DB を共有する）。
# 末尾が _<16進6桁> の名前はそのまま使わずハッシュを付ける。そのまま使うと、ハッシュを付けた別の名前
# （feat-x → wt_feat_x_ce2db9）と、worktree 名 feat_x_ce2db9 が同じ DB 名になる
db_name_for() {
  local raw="$1" s
  s="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_]/_/g')"
  if [ "$s" = "$raw" ] && [ "${#s}" -le 60 ] && ! [[ "$s" =~ _[0-9a-f]{6}$ ]]; then
    printf 'wt_%s' "$s"
  else
    hashed_db_name_for "$raw"
  fi
}

hashed_db_name_for() {
  local raw="$1" s
  s="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_]/_/g')"
  printf 'wt_%s_%s' "$(printf '%s' "$s" | cut -c1-53)" "$(printf '%s' "$raw" | git hash-object --stdin | cut -c1-6)"
}

# ハッシュを付ける前の命名規則。これより前に作った worktree の .env はこの名前を指している
legacy_db_name_for() {
  printf 'wt_%s' "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_]/_/g')" | cut -c1-63
}

# worktree が使う DB 名。DB 名もポート割り当ても worktree の名前で管理する（git worktree move での改名は
# 非対応）。.env の名前は、この worktree の名前から求めうるもの（今の規則・名前が重なったときのハッシュ付き・
# 以前の規則）のときだけ使う。別の worktree の .env をコピーした・手で別の DB に向けたときに、その DB を
# 自分のものとして DROP しない
db_name_for_worktree() {
  local wt_path="$1" name="$2" from_env
  from_env="$(db_name_from_env "$wt_path")"
  if [ -n "$from_env" ] &&
    { [ "$from_env" = "$(db_name_for "$name")" ] || [ "$from_env" = "$(hashed_db_name_for "$name")" ] ||
      [ "$from_env" = "$(legacy_db_name_for "$name")" ]; }; then
    printf '%s' "$from_env"
  else
    db_name_for "$name"
  fi
}

physical_path() {
  if [ -d "$1" ]; then (cd "$1" && pwd -P); else printf '%s' "${1%/}"; fi
}

# git に登録された worktree と .claude/worktrees/ の下のディレクトリ（登録が外れた残り）。
# git は GIT_* を外して呼ぶ（git フックから起動されたとき GIT_DIR を引き継ぎ、別のリポジトリを答えるため）
list_worktree_dirs() {
  (
    for var in $(compgen -e | grep '^GIT_' || true); do unset "$var"; done
    git -C "$MAIN_ROOT" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p'
  )
  local dir
  for dir in "$MAIN_ROOT"/.claude/worktrees/*/; do
    [ -d "$dir" ] && printf '%s\n' "${dir%/}"
  done
  return 0
}

# 他の worktree の .env が同じ DB を指していれば、その worktree のパスを出す。以前の規則で作った
# worktree（feat-x → wt_feat_x）と今の規則の名前（feat_x → wt_feat_x）は同じ名前になりうる。
# .claude/worktrees/ の外に置いた worktree も見る
worktree_using_db() {
  local db="$1" self dir
  self="$(physical_path "$2")"
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    [ -f "$dir/.env" ] || continue
    [ "$(physical_path "$dir")" = "$self" ] && continue
    if [ "$(db_name_from_env "$dir")" = "$db" ]; then
      printf '%s' "$dir"
      return 0
    fi
  done < <(list_worktree_dirs)
  return 1
}

# worktree の .env の DATABASE_URL から、その worktree が作った DB の名前を読む（wt_ で始まるものだけ）。
# 削除は作ったときの名前をそのまま使う（命名規則が変わっても、以前に作った worktree の DB を取り違えない）
db_name_from_env() {
  local url db
  url="$(env_file_value "$1/.env" DATABASE_URL)"
  db="${url##*/}"
  db="${db%%\?*}"
  if [[ "$db" =~ ^wt_[a-z0-9_]+$ ]]; then
    printf '%s' "$db"
  fi
}

# .env から値を1つ取り出す（無ければ既定値）
env_file_value() {
  local file="$1" key="$2" default="${3:-}" v
  v="$(grep -hE "^${key}=" "$file" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d ' ' || true)"
  v="${v%$'\r'}"
  printf '%s' "${v:-$default}"
}

main_env_value() { env_file_value "$MAIN_ROOT/.env" "$1" "${2:-}"; }

# 旧方式（worktree ごとの専用コンテナ）でセットアップされた worktree か
is_legacy_slot_worktree() {
  local envfile="$1/.env"
  [ -f "$envfile" ] || return 1
  [ "$(env_file_value "$envfile" WORKTREE_SHARED_DB)" = "1" ] && return 1
  grep -qE '^POSTGRES_CONTAINER_NAME=.*_wt[0-9]+$' "$envfile" 2>/dev/null
}

# --- ポートレジストリ -------------------------------------------------------

# mkdir はアトミックなので macOS に flock がなくてもロックとして使える
acquire_port_lock() {
  local waited=0
  until mkdir "$PORT_LOCK" 2>/dev/null; do
    [ "$waited" -ge 30 ] && die "ポートレジストリのロックを取得できません: $PORT_LOCK (古い場合は rmdir してください)"
    sleep 1
    waited=$((waited + 1))
  done
  # shellcheck disable=SC2064
  trap "rmdir '$PORT_LOCK' 2>/dev/null || true" EXIT
}

release_port_lock() {
  rmdir "$PORT_LOCK" 2>/dev/null || true
  trap - EXIT
}

read_registry() {
  if [ -f "$PORT_REGISTRY" ]; then cat "$PORT_REGISTRY"; else echo '{}'; fi
}

port_is_free() {
  local port="$1" reserved="$2"
  printf '%s' "$reserved" | grep -qx "$port" && return 1
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 1
  return 0
}

find_free_port() {
  local base="$1" reserved="$2" port="$1" tries=0
  while ! port_is_free "$port" "$reserved"; do
    port=$((port + 1))
    tries=$((tries + 1))
    [ "$tries" -gt 200 ] && die "$base 以降に空きポートが見つかりません"
  done
  printf '%s' "$port"
}

# 予約済みポート = レジストリ + main/.env + 他 worktree の .env（旧方式で作られたものを含む）
reserved_ports() {
  local name="$1" registry="$2" envfile
  printf '%s' "$registry" | jq -r --arg n "$name" 'to_entries[] | select(.key != $n) | .value | .client, .api'
  # 以前の scripts/worktree.sh（削除済み）が作った手動 worktree（../<project>-<branch>/.env）も予約に含める
  # （停止中は lsof で捕まらないため）
  for envfile in "$MAIN_ROOT/.env" "$MAIN_ROOT"/.claude/worktrees/*/.env "$(dirname "$MAIN_ROOT")/$(basename "$MAIN_ROOT")"-*/.env; do
    [ -f "$envfile" ] || continue
    [ "$envfile" = "$MAIN_ROOT/.claude/worktrees/$name/.env" ] && continue
    grep -hoE '^(CLIENT_PORT|API_PORT)=[0-9]+' "$envfile" 2>/dev/null | cut -d= -f2 || true
  done
}

# ポートを割り当ててレジストリに記録する。結果は WT_CLIENT_PORT / WT_API_PORT に入る。
allocate_ports() {
  local name="$1"
  acquire_port_lock

  local registry existing reserved
  registry="$(read_registry)"

  existing="$(printf '%s' "$registry" | jq -r --arg n "$name" '.[$n] // empty')"
  if [ -n "$existing" ]; then
    WT_CLIENT_PORT="$(printf '%s' "$existing" | jq -r '.client')"
    WT_API_PORT="$(printf '%s' "$existing" | jq -r '.api')"
    log "既存のポート割り当てを再利用: client=${WT_CLIENT_PORT} api=${WT_API_PORT}"
    release_port_lock
    return 0
  fi

  reserved="$(reserved_ports "$name" "$registry")"
  WT_CLIENT_PORT="$(find_free_port "$CLIENT_PORT_BASE" "$reserved")"
  reserved="$reserved
$WT_CLIENT_PORT"
  WT_API_PORT="$(find_free_port "$API_PORT_BASE" "$reserved")"

  printf '%s' "$registry" | jq \
    --arg n "$name" --argjson c "$WT_CLIENT_PORT" --argjson a "$WT_API_PORT" \
    '.[$n] = {client: $c, api: $a}' > "$PORT_REGISTRY.tmp"
  mv "$PORT_REGISTRY.tmp" "$PORT_REGISTRY"

  log "ポート割り当て: client=${WT_CLIENT_PORT} api=${WT_API_PORT}"
  release_port_lock
}

release_ports() {
  local name="$1"
  acquire_port_lock
  read_registry | jq --arg n "$name" 'del(.[$n])' > "$PORT_REGISTRY.tmp"
  mv "$PORT_REGISTRY.tmp" "$PORT_REGISTRY"
  log "ポート割り当てを解放: $name"
  release_port_lock
}

# --- 共有 Postgres ----------------------------------------------------------

# main の compose プロジェクトとして共有コンテナを扱う。--project-directory を main に固定するのが
# 要点（compose ファイルと .env も main から解決される）。worktree 側のディレクトリで compose を
# 動かすと別プロジェクト扱いになり、同名コンテナを奪い合って失敗する。
compose_main() {
  docker compose --project-directory "$MAIN_ROOT" "$@"
}

# compose が解決する postgres / postgres-test のコンテナ名と volume 名のうち、既に存在するものが
# **別の compose プロジェクトの持ち物**なら 1 を返す（判定の本体と理由は
# scripts/lib/compose-ownership.sh。db:up / db:down と共通）。
#
# 共通 lib はこのフックと同じチェックアウトから読む（フックは main チェックアウトのコピーが
# 実行されるので、同じコミットに lib もある）。読めなければ安全側に倒して触らない。
compose_resources_owned_by_main() {
  local lib="$_HOOK_DIR/../../scripts/lib/compose-ownership.sh" foreign rc=0
  if [ ! -f "$lib" ]; then
    log "$lib が見つからないため、共有 Postgres の持ち主を確認できません"
    return 1
  fi
  # shellcheck source=../../scripts/lib/compose-ownership.sh
  source "$lib"
  foreign="$(compose_foreign_resources "$MAIN_ROOT" postgres postgres-test)" || rc=$?
  if [ "$rc" -ne 0 ]; then
    log "main の compose 設定を解決できません"
    return 1
  fi
  if [ -n "$foreign" ]; then
    printf '%s\n' "$foreign" | print_foreign_resources
    log "  直したらフックを再実行してください（worktree のルートで bash scripts/agent-worktree-setup.sh）"
    return 1
  fi
  return 0
}

# 共有 Postgres を「起動していなければ起動する」だけに留める。成功なら 0、触るべきでない/失敗
# なら非 0（呼び出し側が DB 処理を諦める）。
#
# --no-recreate が要点。これが無いと compose は「あるべき構成」に合わせて既存コンテナを作り直す。
# main の .env が無い状態では container_name も volume も compose 既定値に化けるため、稼働中の
# main の DB コンテナを停止・リネームして別ボリュームで作り直してしまう（移植元で実際に踏んだ）。
ensure_shared_postgres() {
  if [ ! -f "$MAIN_ROOT/.env" ]; then
    log "main に .env が無いため共有 Postgres には触れません"
    log "  （コンテナ名とボリュームが compose 既定値に化け、main の DB を作り直してしまうため）"
    return 1
  fi
  if ! compose_resources_owned_by_main; then
    log "共有 Postgres には触れません。DB 関連の処理をスキップします"
    return 1
  fi
  log "共有 Postgres を起動中 (main の compose プロジェクト)..."
  if ! compose_main up -d --no-recreate postgres postgres-test --wait >&2; then
    log "共有 Postgres を起動できませんでした。DB 関連の処理をスキップします"
    return 1
  fi
  return 0
}

psql_main()      { docker exec -i "$(main_env_value POSTGRES_CONTAINER_NAME app_postgres)" psql -U postgres -d postgres "$@"; }
psql_main_test() { docker exec -i "$(main_env_value POSTGRES_TEST_CONTAINER_NAME app_postgres_test)" psql -U postgres -d postgres "$@"; }

database_exists() {
  local db="$1" psql_fn="$2" out
  out="$("$psql_fn" -tAc "select 1 from pg_database where datname = '$db'" 2>/dev/null | tr -d '[:space:]')"
  [ "$out" = "1" ]
}

# データベースを1つ作る。戻り値 0=作成済みまたは既存、1=本物の失敗。
#
# psql は既定（ON_ERROR_STOP=0）だと SQL エラーでも exit 0 を返すため `|| log` では失敗を検出
# できない。文言一致は locale 依存になるので、存在確認を先に行い、CREATE は ON_ERROR_STOP=1 で
# 実行して exit code を信頼する。$db は SQL に埋め込むので、db_name_for() 系で [a-z0-9_] に正規化した値か、
# db_name_from_env() の ^wt_[a-z0-9_]+$ 検査を通った値だけを渡す。
create_database_with() {
  local label="$1" db="$2" psql_fn="$3" out
  if database_exists "$db" "$psql_fn"; then
    log "  ${label}: 既に存在します"
    return 0
  fi
  if out="$("$psql_fn" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db\"" 2>&1)"; then
    return 0
  fi
  if database_exists "$db" "$psql_fn"; then
    log "  ${label}: 既に存在します（並行作成）"
    return 0
  fi
  log "  ${label}: データベース作成に失敗しました"
  printf '%s\n' "$out" | sed 's/^/      /' >&2
  return 1
}

create_worktree_databases() {
  local db="$1" rc=0
  log "データベース作成: $db (dev/test 両方)"
  create_database_with dev  "$db" psql_main      || rc=1
  create_database_with test "$db" psql_main_test || rc=1
  return "$rc"
}

drop_database_with() {
  local label="$1" db="$2" psql_fn="$3" out
  if out="$("$psql_fn" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" 2>&1)"; then
    return 0
  fi
  log "  ${label}: 削除に失敗しました（手動で確認してください）"
  printf '%s\n' "$out" | sed 's/^/      /' >&2
  return 1
}

# 削除は失敗しても worktree の削除自体は続行する
drop_worktree_databases() {
  local db="$1"
  log "データベース削除: $db (dev/test 両方)"
  drop_database_with dev  "$db" psql_main      || true
  drop_database_with test "$db" psql_main_test || true
}

# --- 使い捨て worktree の判定 ----------------------------------------------

# Claude Code が機械生成する worktree 名（Agent(isolation:"worktree") / workflow / background job）。
# 短命でコードを読む/書くだけのことが多いため DB 作成とマイグレーションを省く
# （CLAUDE_WORKTREE_FULL_SETUP=1 で無効化）。接頭辞一致にすると agent-analytics のような人間由来の
# 名前を誤判定するため、ID 部分の形まで見る。job-/bg- の末尾 8 hex は人間が偶然満たしうる
# （job-fix-typo-deadbeef）が、DB 未作成は .env の WORKTREE_DB_READY 欠如で /start-dev が検出する。
is_ephemeral_worktree_name() {
  local name="$1" p
  [ "${CLAUDE_WORKTREE_FULL_SETUP:-}" = "1" ] && return 1
  for p in \
    '^agent-a[0-9a-f]{16}$' \
    '^agent-a[0-9a-f]{7}$' \
    '^wf_[0-9a-f]{8}-[0-9a-f]{3}-[0-9]+$' \
    '^wf-[0-9]+$' \
    '^job-[a-zA-Z0-9._-]{1,55}-[0-9a-f]{8}$' \
    '^bg-[a-zA-Z0-9._-]{1,55}-[0-9a-f]{8}$'
  do
    if [[ "$name" =~ $p ]]; then
      return 0
    fi
  done
  return 1
}

# --- 前提コマンドの確認 -----------------------------------------------------

# 置換フックなので、必要なコマンドが無いと worktree が1つも作れなくなる。素の
# `command not found` ではなく、何が足りずどう入れるのかを明示して落とす。
require_tools() {
  local missing=() t
  for t in "$@"; do
    command -v "$t" >/dev/null 2>&1 || missing+=("$t")
  done
  [ "${#missing[@]}" -eq 0 ] && return 0
  printf 'ERROR: worktree フックの実行に必要なコマンドがありません: %s\n' "${missing[*]}" >&2
  printf '\n導入方法:\n' >&2
  for t in "${missing[@]}"; do
    case "$t" in
      jq) printf '  jq   : brew install jq\n' >&2 ;;
      bun) printf '  bun  : curl -fsSL https://bun.sh/install | bash\n' >&2 ;;
      lsof) printf '  lsof : macOS 標準のコマンドです。PATH を確認してください\n' >&2 ;;
      *) printf '  %s\n' "$t" >&2 ;;
    esac
  done
  printf '\n導入後、同じコマンドで再実行できます（冪等です）。\n' >&2
  exit 1
}
