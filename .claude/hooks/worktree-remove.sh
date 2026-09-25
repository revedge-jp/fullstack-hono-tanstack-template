#!/usr/bin/env bash
#
# Claude Code の WorktreeRemove フック。
# 移植元: kikagaku/kikagaku-training-portal#1292 → revedge-jp/chiryonavi#1218 / #1222。
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

name="$(basename "$WT_PATH")"
DB_NAME="$(db_name_for "$name")"

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
if docker info >/dev/null 2>&1; then
  drop_worktree_databases "$DB_NAME"
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
