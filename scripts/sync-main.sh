#!/usr/bin/env bash

# sync-main.sh - Sync current branch with main for this monorepo
# Usage: ./scripts/sync-main.sh

set -euo pipefail

CURRENT_BRANCH=$(git branch --show-current)

if [[ -z "${CURRENT_BRANCH}" ]]; then
  echo "❌ エラー: 現在のブランチ名を取得できません"
  exit 1
fi

if [[ "${CURRENT_BRANCH}" == "main" ]]; then
  echo "🔄 mainブランチを更新中..."

  # Check for uncommitted changes on main
  if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
    echo "❌ エラー: mainブランチに未コミットの変更があります"
    echo "   先に変更をコミットまたはスタッシュしてください"
    exit 1
  fi

  echo "📥 最新のmainブランチを取得中..."
  git fetch origin main --quiet
  echo "🔧 fast-forward pull を実行中..."
  git pull --ff-only origin main --quiet
else
  echo "🔄 ${CURRENT_BRANCH} を main に追従させます..."

  # Check for uncommitted changes
  if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
    echo "❌ エラー: ${CURRENT_BRANCH} に未コミットの変更があります"
    echo "   先に変更をコミットまたはスタッシュしてください"
    exit 1
  fi

  echo "📥 origin/main を取得中..."
  git fetch origin main --quiet

  SYNC_STRATEGY=${SYNC_STRATEGY:-rebase}
  if [[ "${SYNC_STRATEGY}" == "merge" ]]; then
    echo "🔧 merge (no-ff) を実行中..."
    if ! git merge --no-ff origin/main; then
      echo "❌ マージコンフリクトが発生しました。解決後に再実行してください"
      exit 1
    fi
  else
    echo "🔧 rebase を実行中... (変更: export SYNC_STRATEGY=merge で切替可)"
    if ! git rebase origin/main; then
      echo "❌ リベースコンフリクトが発生しました"
      echo "   中断: git rebase --abort"
      echo "   再実行: ./scripts/sync-main.sh"
      exit 1
    fi
  fi
fi

# Clean untracked files and directories (after sync to respect main's structure)
echo "🧹 未追跡ファイルと空ディレクトリをクリーンアップ中..."
git clean -fd --quiet

# Update dependencies
echo "📦 依存関係を更新中..."
LEFTHOOK=0 bun install --silent

# Database setup（.env プリフライト + マイグレーション。失敗は握り潰さない）
# shellcheck source=./lib/db-setup.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/db-setup.sh"
setup_database

# Type checking
echo "🔍 タイプチェックを実行中..."
TYPECHECK_LOG="$(mktemp)"
if bun run typecheck >"$TYPECHECK_LOG" 2>&1; then
  echo "   ✅ タイプチェックが通りました"
else
  # 出力を捨てると、どのファイルで落ちたかを調べるためにもう一度実行することになる
  echo "   ⚠️ タイプチェックで問題が見つかりました（末尾 40 行。全文は bun run typecheck）:"
  tail -n 40 "$TYPECHECK_LOG" | sed 's/^/      /'
fi
rm -f "$TYPECHECK_LOG"

# Final status / hints
if [[ "${CURRENT_BRANCH}" != "main" ]]; then
  echo "✅ ${CURRENT_BRANCH} の main 追従が完了しました！"
  if git rev-parse --verify --quiet "refs/remotes/origin/${CURRENT_BRANCH}" >/dev/null; then
    echo "ℹ️ リモートも更新する場合: git push --force-with-lease"
  else
    echo "ℹ️ 初回のリモート作成: git push -u origin ${CURRENT_BRANCH}"
  fi
else
  echo "✅ mainブランチの更新が完了しました！"
fi