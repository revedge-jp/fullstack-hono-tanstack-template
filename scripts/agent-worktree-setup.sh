#!/usr/bin/env bash
#
# 互換ラッパー。worktree のセットアップは Claude Code の WorktreeCreate フック
# （.claude/hooks/worktree-create.sh）が EnterWorktree 時に自動で行う。
# フックが発火しなかった・DB をスキップした（Docker 停止中、使い捨て名判定、共有コンテナの名前衝突）
# worktree を後から整えるために残している。フックと違い、名前に関わらず必ず DB も作る。
# 冪等なので何度実行してもよい。
#
# 使い方（.claude/worktrees/<name> 直下で実行すること）:
#   bash scripts/agent-worktree-setup.sh
#
# 旧方式（worktree ごとに postgres コンテナ2つ + volume を立てるスロット方式）は廃止した。
# 既にその方式で動いている worktree はそのまま使い続けられる。

set -euo pipefail

WORKTREE_ROOT="$(pwd)"
if [[ ! "$WORKTREE_ROOT" =~ /\.claude/worktrees/[^/]+$ ]]; then
  echo "❌ エラー: .claude/worktrees/<name> 直下（worktree のルート）で実行してください（現在地: ${WORKTREE_ROOT}）" >&2
  exit 1
fi

if [[ -f .env ]] && grep -qE '^POSTGRES_CONTAINER_NAME=.*_wt[0-9]+$' .env && ! grep -qE '^WORKTREE_SHARED_DB=1$' .env; then
  echo "ℹ️  この worktree は旧方式（専用 DB コンテナ）でセットアップ済みです。そのまま使えます。" >&2
  echo "   共有コンテナ方式へ移すなら、worktree のルートで docker compose down -v してから .env を消して再実行してください（専用コンテナのデータは失われます）。" >&2
  exit 0
fi

# フックは worktree 自身のコピーを使う（main チェックアウトがフック導入前のコミットに居ることがある。
# worktree-lib.sh は git-common-dir から main を解決するので、どこから実行しても main を誤認しない）。
NAME="$(basename "$WORKTREE_ROOT")"
printf '{"name":"%s"}\n' "$NAME" | CLAUDE_WORKTREE_FULL_SETUP=1 bash "$WORKTREE_ROOT/.claude/hooks/worktree-create.sh" >/dev/null
