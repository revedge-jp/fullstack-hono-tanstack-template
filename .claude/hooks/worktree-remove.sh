#!/usr/bin/env bash
#
# Claude Code の WorktreeRemove フック。
# WorktreeCreate フックで作られた worktree の後始末を担当する。
# ここで失敗（非ゼロ終了）した場合、Claude Code は worktree を消さずに残す。
#
# stdin: {"session_id":..,"hook_event_name":"WorktreeRemove","worktree_path":"<絶対パス>"}

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./worktree-lib.sh
source "$SCRIPT_DIR/worktree-lib.sh"

require_tools jq git

exec 1>&2

payload="$(cat)"
WT_PATH="$(printf '%s' "$payload" | jq -r '.worktree_path // empty')"
[ -n "$WT_PATH" ] || die "WorktreeRemove ペイロードに worktree_path がありません"
# 相対パスは下の検査（カレントディレクトリ基準）と git worktree remove（main 基準）で指す場所が食い違い、
# 検査を飛ばして消しうる。Claude Code は常に絶対パスを渡す
case "$WT_PATH" in
  /*) ;;
  *) die "worktree_path は絶対パスで指定してください: $WT_PATH" ;;
esac

name="$(basename "$WT_PATH")"
# .env は下の git worktree remove で消えるので、ここで読む。読めなければ命名規則から求める
DB_NAME="$(db_name_for_worktree "$WT_PATH" "$name")"
HAS_ENV_DB_NAME=0
[ -n "$(db_name_from_env "$WT_PATH")" ] && HAS_ENV_DB_NAME=1

echo "=== worktree 削除: $name ===" >&2

# 旧方式（worktree ごとの専用 DB コンテナ + volume）の worktree は、ここで git worktree remove
# だけするとコンテナと volume が残骸になる。volume の削除はデータを失う操作なのでフックから
# 自動では行わず、手順を示して止める（止めれば Claude Code は worktree を残す）。
# `docker compose down -v` は **worktree のルートで** 実行する。main の compose ファイルを -f で
# 指すと main の .env が読まれ、main のコンテナと volume を消す。
if is_legacy_slot_worktree "$WT_PATH"; then
  die "この worktree は旧方式（専用 DB コンテナ）です。次の手順で片付けてください:
    (cd $WT_PATH && docker compose down -v)
    git -C $MAIN_ROOT worktree remove --force $WT_PATH"
fi

# 手で流したとき（Claude Code の ExitWorktree を経由しない呼び出し。ペイロードに hook_event_name が無い）の
# 安全装置。下の git worktree remove --force は未コミット・未追跡の変更も、どのブランチにも乗っていない
# コミット（detached HEAD・rebase の途中）も確認なしに消す。ExitWorktree は自分で変更の有無を確かめてから
# フックを呼ぶが、手で流すとその確認が無いので、ここで止める。確かめたうえで消すなら WORKTREE_REMOVE_FORCE=1
HOOK_EVENT="$(printf '%s' "$payload" | jq -r '.hook_event_name // empty')"
if [ -z "$HOOK_EVENT" ] && [ -d "$WT_PATH" ] && [ "${WORKTREE_REMOVE_FORCE:-}" != "1" ]; then
  # --untracked-files を明示する（status.showUntrackedFiles=no の設定があると未追跡を見落とす）。
  # git status 自体が失敗したら、確かめられないので消さない
  if ! dirty="$(git -C "$WT_PATH" -c core.quotepath=false status --porcelain --untracked-files=normal 2>&1)"; then
    die "worktree $WT_PATH の状態を確かめられないため削除しません（WORKTREE_REMOVE_FORCE=1 で上書き）: $dirty"
  fi
  unbranched=""
  if ! git -C "$WT_PATH" symbolic-ref -q HEAD >/dev/null 2>&1 &&
    [ -z "$(git -C "$WT_PATH" for-each-ref --contains HEAD refs/heads refs/remotes 2>/dev/null)" ]; then
    unbranched="$(git -C "$WT_PATH" rev-parse --short HEAD 2>/dev/null || echo HEAD)"
  fi
  if [ -n "$dirty" ] || [ -n "$unbranched" ]; then
    msg="worktree $WT_PATH に消えると戻せない変更があるため削除しません:"
    [ -n "$dirty" ] && msg="$msg
  未コミット・未追跡の変更:
$(printf '%s\n' "$dirty" | sed 's/^/    /')"
    [ -n "$unbranched" ] && msg="$msg
  どのブランチにも乗っていないコミット（detached HEAD / rebase の途中）: ${unbranched}
    残すなら: git -C $WT_PATH branch <branch> HEAD"
    die "$msg
  コミット・退避してから再実行するか、確かめたうえで消すなら WORKTREE_REMOVE_FORCE=1 を付けて再実行してください"
  fi
fi

# 1. まず worktree を削除する。順序が重要: ここで失敗すると Claude Code は worktree を残す。
#    先に DB を落としてポートを解放していると、生き残った worktree が DB なし・ポートは次の
#    worktree に再割り当て済み、という壊れた状態になる。
log "git worktree remove 実行中..."
if ! git -C "$MAIN_ROOT" worktree remove --force "$WT_PATH" >&2 2>&1; then
  if [ ! -d "$WT_PATH" ]; then
    log "ディレクトリは既にありません。worktree 登録を prune します"
    git -C "$MAIN_ROOT" worktree prune >&2
  else
    die "worktree を削除できませんでした: $WT_PATH"
  fi
fi

# 2. 専用データベースを削除（共有コンテナ自体には触らない）。Docker 停止中は諦める。
#    他の worktree の .env が同じ DB を指していれば消さない（以前の規則で作った worktree と名前が重なりうる）
if other="$(worktree_using_db "$DB_NAME" "$WT_PATH")"; then
  log "DB $DB_NAME は $other も使っているため削除しません"
elif docker info >/dev/null 2>&1; then
  drop_worktree_databases "$DB_NAME"
  legacy="$(legacy_db_name_for "$name")"
  if [ "$HAS_ENV_DB_NAME" = 0 ] && [ "$legacy" != "$DB_NAME" ] && ! worktree_using_db "$legacy" "$WT_PATH" >/dev/null; then
    log ".env が無かったため、以前の規則の DB 名 $legacy は確かめていません（残っていれば手動で DROP DATABASE）"
  fi
else
  log "Docker が起動していないため DB $DB_NAME は削除していません（残っていれば手動で DROP DATABASE）"
fi

# 3. ポート割り当てを解放
release_ports "$name"

# 4. ブランチは消さない（未 push の作業が残っている可能性があるため）
BRANCH="$(git -C "$MAIN_ROOT" for-each-ref --format='%(refname:short)' "refs/heads/claude/$name")"
if [ -n "$BRANCH" ]; then
  log "ブランチ $BRANCH は残しています（不要なら git branch -D ${BRANCH}）"
fi

echo "=== 削除完了: $name ===" >&2
