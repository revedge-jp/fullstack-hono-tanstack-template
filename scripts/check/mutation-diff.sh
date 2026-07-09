#!/usr/bin/env bash
set -euo pipefail

# mutation testing (stryker) を PR の差分ファイルだけに絞って実行する。
#
# 背景: stryker.config.json の mutate はリポジトリ全体の domain/application 層
# （feature が増えるほど増加）を対象にしており、1 行の変更でも毎回フルスキャンが走る。
# feature 数が増えるにつれ CI の実行時間が単調に伸び続けるため、PR サイズに比例する
# ようスコープを絞る（docs/architecture/adr-007-mutation-testing-diff-scope.md）。
#
# Stryker 組み込みの --incremental は使わない。testRunner=command（bun test）では
# テストとミュータントを対応付けられず、テストファイルの変更が過去の Survived/Killed
# 結果を無効化しない誤動作が実測されている（apps/api-service/stryker.config.json の
# _comment_incremental 参照）。本スクリプトは履歴キャッシュを持たず、毎回 git diff から
# 新規に対象ファイルを算出するため、その問題は起きない。

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

BASE_REF="${MUTATION_DIFF_BASE:-origin/main}"

# shallow checkout（CI の actions/checkout は fetch-depth: 1）では origin/main の
# 履歴が手元にないため、merge-base 比較の前に明示的に取得する。
# ローカル実行時（既に main の履歴がある）は冗長だが害はない。
git fetch origin main --quiet 2>/dev/null || true

CHANGED_FILES=$(git diff --name-only "$BASE_REF"...HEAD -- 'apps/api-service/src/features' 2>/dev/null |
  grep -E '/(domain|application)/.*\.ts$' |
  grep -v '\.test\.ts$' |
  grep -vE '/application/(service|index|ports)\.ts$' || true)

if [ -z "$CHANGED_FILES" ]; then
  echo "domain/application 層に対象の変更が無いため mutation testing をスキップします。"
  exit 0
fi

echo "差分スコープで mutation testing を実行します（対象ファイル）:"
echo "$CHANGED_FILES" | sed 's/^/  /'

# stryker.config.json の mutate パターンは apps/api-service 相対のため、
# --mutate に渡すパスもプレフィックスを除いた相対パスにする。
MUTATE_ARG=$(echo "$CHANGED_FILES" | sed 's|^apps/api-service/||' | paste -sd, -)

cd apps/api-service
bunx stryker run --mutate "$MUTATE_ARG"
