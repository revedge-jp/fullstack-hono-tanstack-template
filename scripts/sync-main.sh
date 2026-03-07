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

# Database setup via root scripts
if [ -f "packages/database/package.json" ]; then
  echo "🗄️ データベースをセットアップ中..."

  echo "   🔧 Prismaクライアントを生成中..."
  if bun run db:generate >/dev/null 2>&1; then
    echo "   ✅ Prismaクライアントが生成されました"
  else
    echo "   ⚠️ Prisma generateに失敗しました（続行中...）"
  fi

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
  echo "✅ ${CURRENT_BRANCH} の main 追従が完了しました！"
  if git rev-parse --verify --quiet "refs/remotes/origin/${CURRENT_BRANCH}" >/dev/null; then
    echo "ℹ️ リモートも更新する場合: git push --force-with-lease"
  else
    echo "ℹ️ 初回のリモート作成: git push -u origin ${CURRENT_BRANCH}"
  fi
else
  echo "✅ mainブランチの更新が完了しました！"
fi