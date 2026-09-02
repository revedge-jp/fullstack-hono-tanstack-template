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
#
# --mutate で対象ファイルを絞っても、stryker.config.json の commandRunner.command は
# 固定で「bun test src/features src/__tests__/contract」(api-service の feature テスト
# +contract テスト全量)になっており、ミュータント1個ごとに毎回この全量スイートを実行
# していた（Stryker の command テストランナーは --testFiles による絞り込みに未対応 —
# node_modules/@stryker-mutator/core の CommandTestRunner が明示的にエラーを投げる)。
# そこで、差分ファイルから影響を受ける feature 名を求め、その feature 配下のテスト
# (usecase.test.ts 等の co-located テスト + 対応する contract テスト)だけを実行する
# よう commandRunner.command を都度上書きした一時設定ファイルで Stryker を起動する。
# feature 単位のテストで十分なのは、feature 間連携が ports + integrations/composition
# アダプタ経由に限定され(AGENTS.md 参照)、ある feature の domain/application ロジックは
# 基本的にその feature 自身の co-located テスト/contract テストでのみ検証される
# という本リポジトリのアーキテクチャ前提に基づく。

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

# 差分ファイルから影響を受ける feature 名(src/features/<feature>/...)を一意に求め、
# その feature 配下のテストディレクトリ + 対応する contract テストファイル(存在する場合)
# だけをテスト対象にする。
FEATURES=$(echo "$CHANGED_FILES" | sed -E 's#^apps/api-service/src/features/([^/]+)/.*#\1#' | sort -u)

TEST_PATHS=""
while IFS= read -r feature; do
  [ -z "$feature" ] && continue
  # feature 名(= features/ 直下のディレクトリ名)は後段で Stryker の commandRunner.command に
  # 連結され、Stryker はそれを child_process.exec(/bin/sh -c) で実行する。ディレクトリ名は
  # kebab-case のはずなので、想定外の文字(空白・`$`・`(`・`;` 等)が混じったら即座に止める。
  # 細工したディレクトリ名を含む PR 経由の CI 上コマンド実行を防ぐ(check-kebab-case.mjs が
  # ディレクトリ名を検証する二重防御と対。監査由来)。
  # check-kebab-case.mjs の kebabCasePattern(^[a-z0-9]+(?:-[a-z0-9]+)*$)と同じ形を
  # POSIX case の glob で表現する(文字種だけでなく、先頭/末尾のハイフン・連続ハイフンも
  # 拒否しないと二重防御の片方だけが緩くなる)。
  case "$feature" in
    *[!a-z0-9-]* | -* | *- | *--*)
      echo "不正な feature ディレクトリ名を検出しました: '$feature'" >&2
      exit 1
      ;;
  esac
  TEST_PATHS="$TEST_PATHS src/features/$feature"
  CONTRACT_TEST="src/__tests__/contract/${feature}.contract.test.ts"
  if [ -f "apps/api-service/$CONTRACT_TEST" ]; then
    TEST_PATHS="$TEST_PATHS $CONTRACT_TEST"
  fi
done <<< "$FEATURES"

echo "対象 feature: $(echo "$FEATURES" | paste -sd, -)"
echo "テストコマンドを絞り込みます: bun test$TEST_PATHS"

cd apps/api-service

# stryker.config.json の commandRunner.command は固定文字列のため、Stryker には
# CLI からの直接上書きオプションが無い(--testFiles は command ランナー未対応)。
# ベース設定を読み込み、commandRunner.command だけを差し替えた一時設定ファイルで
# 起動する(mutate 等それ以外の設定はベースをそのまま引き継ぐ)。
# Stryker は拡張子で config ファイルの形式を判定するため、必ず ".json" で終わる
# パスにする必要がある。mktemp の XXXXXX 置換ルールは GNU/BSD で挙動が異なり
# (BSD/macOS の mktemp は XXXXXX の後ろの文字列をテンプレートの一部として保持
# せず末尾にランダム文字列を追加する)、"XXXXXX.json" のような直接指定では
# 拡張子が壊れる。両OSで安全に ".json" 終わりにするため、一時ディレクトリを
# 作ってその中に固定名で置く。
TMP_DIR="$(mktemp -d)"
TMP_CONFIG="$TMP_DIR/stryker-diff.config.json"
trap 'rm -rf "$TMP_DIR"' EXIT

STRYKER_DIFF_TEST_COMMAND="bun test$TEST_PATHS" \
  STRYKER_DIFF_TMP_CONFIG="$TMP_CONFIG" \
  bun -e '
    const fs = require("fs");
    const base = JSON.parse(fs.readFileSync("stryker.config.json", "utf8"));
    base.commandRunner = { command: process.env.STRYKER_DIFF_TEST_COMMAND };
    fs.writeFileSync(process.env.STRYKER_DIFF_TMP_CONFIG, JSON.stringify(base, null, 2));
  '

bunx stryker run "$TMP_CONFIG" --mutate "$MUTATE_ARG"
