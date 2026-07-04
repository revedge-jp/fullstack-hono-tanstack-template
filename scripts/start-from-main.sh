#!/usr/bin/env bash

# start-from-main.sh - Reset current branch to main for starting new development
# Usage: ./scripts/start-from-main.sh

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
  echo "🔄 ${CURRENT_BRANCH} を main と完全に同期します..."

  # Check for uncommitted changes
  if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
    echo "❌ エラー: ${CURRENT_BRANCH} に未コミットの変更があります"
    echo "   先に変更をコミットまたはスタッシュしてください"
    exit 1
  fi

  echo "📥 origin/main を取得中..."
  git fetch origin main --quiet

  # Check if branch has commits ahead of main
  COMMITS_AHEAD=$(git rev-list --count origin/main..HEAD)
  if [[ "${COMMITS_AHEAD}" -gt 0 ]]; then
    echo "❌ エラー: ${CURRENT_BRANCH} には ${COMMITS_AHEAD} 個の独自コミットがあります"
    echo "   このブランチで作業中の可能性があります"
    echo "   💡 本当にリセットする場合: git reset --hard origin/main"
    exit 1
  fi

  echo "🔧 origin/main にリセット中..."
  git reset --hard origin/main --quiet
fi

# Clean untracked files and directories (after sync to respect main's structure)
echo "🧹 未追跡ファイルと空ディレクトリをクリーンアップ中..."
git clean -fd --quiet

# Update dependencies
echo "📦 依存関係を更新中..."
LEFTHOOK=0 bun install --silent

# Database setup via root scripts
if [ -f "packages/database/package.json" ]; then
  echo "🗄️ データベースをセットアップ中..."

  echo "   🔄 データベースマイグレーションを実行中..."
  MIGRATE_OUTPUT=$(bun run db:migrate 2>&1 || true)
  if echo "${MIGRATE_OUTPUT}" | grep -q "Already in sync\|Migration.*applied"; then
    echo "   ✅ データベースは最新です"
  elif echo "${MIGRATE_OUTPUT}" | grep -qi "Can't reach database server"; then
    echo "   ❌ データベースサーバーに接続できません"
    echo "   💡 先にデータベースを起動してください: bun run db:up"
    echo "   その後、このスクリプトを再実行してください"
    exit 1
  else
    echo "   ⚠️ マイグレーションに失敗したか、新しいマイグレーションがありません（続行中...）"
  fi
fi

# Type checking
echo "🔍 タイプチェックを実行中..."
if bun run typecheck >/dev/null 2>&1; then
  echo "   ✅ タイプチェックが通りました"
else
  echo "   ⚠️ タイプチェックで問題が見つかりました（修正が必要かもしれません）"
fi

# Final status / hints
if [[ "${CURRENT_BRANCH}" != "main" ]]; then
  echo "✅ ${CURRENT_BRANCH} が main と完全に同期されました！"
  echo "💡 これから開発を始められます"
else
  echo "✅ mainブランチの更新が完了しました！"
fi