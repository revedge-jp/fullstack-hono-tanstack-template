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
# (usecase.test.ts 等の co-located テスト。不足時だけ対応する contract テストも)だけを
# 実行するよう commandRunner.command を都度上書きした一時設定ファイルで Stryker を起動する
# (feature ごとの実行・再実行の詳細は後段のコメント)。
# feature 単位のテストで十分なのは、feature 間連携が ports + integrations/composition
# アダプタ経由に限定され(apps/api-service/AGENTS.md 参照)、ある feature の domain/application ロジックは
# 基本的にその feature 自身の co-located テスト/contract テストでのみ検証される
# という本リポジトリのアーキテクチャ前提に基づく。

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

BASE_REF="${MUTATION_DIFF_BASE:-origin/main}"

# shallow checkout（CI の actions/checkout は fetch-depth: 1）では origin/main の
# 履歴が手元にないため、merge-base 比較の前に明示的に取得する。
# ローカル実行時（既に main の履歴がある）は冗長だが害はない。
git fetch origin main --quiet 2>/dev/null || true

# 基準が無い・diff が失敗したときを「変更なし」と同じに扱わない（mutation testing が黙って飛ばされる）
if ! git rev-parse --verify --quiet "${BASE_REF}^{commit}" >/dev/null; then
  echo "❌ 比較の基準 ${BASE_REF} が見つかりません（MUTATION_DIFF_BASE を確かめてください）" >&2
  exit 1
fi
if ! DIFF_FILES=$(git diff --name-only "$BASE_REF"...HEAD -- 'apps/api-service/src/features'); then
  echo "❌ ${BASE_REF} との差分を取れませんでした" >&2
  exit 1
fi
# テストだけを変えた PR も対象にする。実装の差分だけを見ると、テストを弱めた・消した PR では対象が空になり、
# mutation testing がスキップされて CI が通る。変えたテストと同じディレクトリの実装をすべて対象に加える
# （同じ名前の実装だけだと、usecase.test.ts だけが検証する steps.ts・mappers.ts が外れる）
TESTED_FILES=$(printf '%s\n' "$DIFF_FILES" | grep -E '/(domain|application)/.*\.test\.ts$' |
  while IFS= read -r test_file; do
    test_dir="$(dirname "$test_file")"
    if [ -d "$test_dir" ]; then
      find "$test_dir" -maxdepth 1 -name '*.ts' ! -name '*.test.ts'
    fi
  done || true)
CHANGED_FILES=$(printf '%s\n%s\n' "$DIFF_FILES" "$TESTED_FILES" |
  grep -E '/(domain|application)/.*\.ts$' |
  grep -v '\.test\.ts$' |
  grep -vE '/application/(service|index|ports)\.ts$' | sort -u || true)

if [ -z "$CHANGED_FILES" ]; then
  echo "domain/application 層に対象の変更が無いため mutation testing をスキップします。"
  exit 0
fi

echo "差分スコープで mutation testing を実行します（対象ファイル）:"
echo "$CHANGED_FILES" | sed 's/^/  /'


# ミュータントは feature ごとに別々の Stryker 実行で検証する（その feature の差分ファイルを、
# その feature 配下のテストだけで検証する）。以前は全 feature のテストの和集合(+ 各 feature の
# contract テスト)を1回の Stryker 実行で全ミュータントに当てていたため、1ミュータントあたりの
# 所要時間が「変更した feature の数」に比例して伸びた。
#
# 速くするための3点と、それぞれがゲートを緩めない理由:
#   1. feature ごとに分ける — 別 feature のテストでしか殺されないミュータントが Survived に
#      倒れるだけ(厳しくなる側)。
#   2. `bun test --bail` — 最初の失敗で止まるだけで、Killed/Survived の判定(終了コードが
#      0 か否か)は変わらない。ミュータントの大半は Killed なので残りのテストを省ける。
#   3. contract テストは1回目に含めない — contract テストはファイルごとにアプリを組み立てる
#      ため feature の単体テストより遅い。合算スコアが break を割ったときだけ、contract テストを
#      足して該当グループを再実行し、その結果で判定する(contract テストでしか殺されない
#      ミュータントの取りこぼしはこれで戻る。別 feature のテストでしか殺されないものは 1. の
#      とおり Survived のままなので、以前ぎりぎり通っていた PR が落ちることはある)。
#
# break 閾値は各実行では無効化し、全グループの JSON レポートを合算したスコアで判定する。
# グループ単位で break を掛けると、ミュータントの少ない feature が数件の Survived で
# 閾値を割り、1回の実行で判定していた従来とゲートの意味が変わるため。
# （docs/architecture/adr-007-mutation-testing-diff-scope.md の追記）
FEATURES=$(echo "$CHANGED_FILES" | sed -E 's#^apps/api-service/src/features/([^/]+)/.*#\1#' | sort -u)

FULL_TEST_PATHS="src/features src/__tests__/contract"

# 1行1グループ: <名前> TAB <1回目のテストパス> TAB <再実行時のテストパス> TAB <mutate(カンマ区切り)>
TAB=$'\t'
GROUPS_SPEC=""
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
  HAS_UNIT_TESTS=""
  if [ -n "$(find "apps/api-service/src/features/$feature" -name '*.test.ts' -print -quit)" ]; then
    HAS_UNIT_TESTS=1
  fi
  CONTRACT_TEST="src/__tests__/contract/${feature}.contract.test.ts"
  if [ -f "apps/api-service/$CONTRACT_TEST" ]; then
    PRECISE_PATHS="src/features/$feature $CONTRACT_TEST"
  elif [ -n "$HAS_UNIT_TESTS" ]; then
    PRECISE_PATHS="src/features/$feature"
  else
    # テストが1本も無いと bun test が "No tests found" で失敗し Stryker の初回実行が落ちるため、
    # フルのテストコマンドへ倒す。
    PRECISE_PATHS="$FULL_TEST_PATHS"
  fi
  if [ -n "$HAS_UNIT_TESTS" ]; then
    QUICK_PATHS="src/features/$feature"
  else
    QUICK_PATHS="$PRECISE_PATHS"
  fi
  MUTATE=$(echo "$CHANGED_FILES" | grep "^apps/api-service/src/features/$feature/" |
    sed 's|^apps/api-service/||' | paste -sd, -)
  GROUPS_SPEC="$GROUPS_SPEC$feature$TAB$QUICK_PATHS$TAB$PRECISE_PATHS$TAB$MUTATE
"
done <<< "$FEATURES"

echo "feature ごとに実行します(1回目のテストコマンド):"
printf '%s' "$GROUPS_SPEC" | awk -F'\t' '{ printf "  [%s] bun test --bail %s\n", $1, $2 }'

cd apps/api-service

# Stryker には commandRunner.command を CLI から上書きするオプションが無い
# (--testFiles は command ランナー未対応)ため、ベース設定から一時設定ファイルを作る。
# Stryker は拡張子で config の形式を判定するので必ず ".json" で終える。BSD/macOS の
# mktemp は "XXXXXX.json" の拡張子を保持しないため、一時ディレクトリ内に固定名で置く。
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

run_group() {
  local group="$1" test_paths="$2" mutate="$3"
  echo ""
  echo "=== [$group] bun test --bail $test_paths ==="
  STRYKER_DIFF_TEST_COMMAND="bun test --bail $test_paths" \
    STRYKER_DIFF_TMP_CONFIG="$TMP_DIR/$group.config.json" \
    STRYKER_DIFF_JSON_REPORT="$TMP_DIR/$group.report.json" \
    bun -e '
      const fs = require("fs");
      const base = JSON.parse(fs.readFileSync("stryker.config.json", "utf8"));
      base.commandRunner = { command: process.env.STRYKER_DIFF_TEST_COMMAND };
      base.thresholds = { ...base.thresholds, break: null };
      base.reporters = ["clear-text", "json"];
      base.jsonReporter = { fileName: process.env.STRYKER_DIFF_JSON_REPORT };
      fs.writeFileSync(process.env.STRYKER_DIFF_TMP_CONFIG, JSON.stringify(base, null, 2));
    '
  rm -f "$TMP_DIR/$group.report.json"
  bunx stryker run "$TMP_DIR/$group.config.json" --mutate "$mutate"
}

# Stryker のスコア定義に合わせる: (Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage)。
# CompileError / RuntimeError / Ignored は分母に入れない。break を割ったら exit 1。
check_aggregate_score() {
  STRYKER_DIFF_TMP_DIR="$TMP_DIR" \
    STRYKER_DIFF_GROUP_COUNT="$(printf '%s' "$GROUPS_SPEC" | grep -c .)" \
    bun -e '
      const fs = require("fs");
      const path = require("path");
      const dir = process.env.STRYKER_DIFF_TMP_DIR;
      const breakAt = JSON.parse(fs.readFileSync("stryker.config.json", "utf8")).thresholds.break;
      const reports = fs.readdirSync(dir).filter((name) => name.endsWith(".report.json"));
      if (reports.length !== Number(process.env.STRYKER_DIFF_GROUP_COUNT)) {
        console.error(`❌ JSON レポートが ${reports.length} 件しかありません(グループ数 ${process.env.STRYKER_DIFF_GROUP_COUNT})。`);
        process.exit(2);
      }
      let detected = 0;
      let undetected = 0;
      for (const name of reports) {
        const report = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
        let groupDetected = 0;
        let groupUndetected = 0;
        for (const file of Object.values(report.files)) {
          for (const mutant of file.mutants) {
            if (mutant.status === "Killed" || mutant.status === "Timeout") groupDetected++;
            if (mutant.status === "Survived" || mutant.status === "NoCoverage") groupUndetected++;
          }
        }
        const total = groupDetected + groupUndetected;
        const score = total === 0 ? 100 : (groupDetected / total) * 100;
        console.log(`  [${name.replace(".report.json", "")}] ${score.toFixed(2)}% (${groupDetected}/${total})`);
        detected += groupDetected;
        undetected += groupUndetected;
      }
      const total = detected + undetected;
      const score = total === 0 ? 100 : (detected / total) * 100;
      console.log(`合算スコア: ${score.toFixed(2)}% (${detected}/${total}) — break ${breakAt}`);
      if (typeof breakAt === "number" && score < breakAt) process.exit(1);
    '
}

while IFS="$TAB" read -r group quick_paths _precise_paths mutate; do
  [ -z "$group" ] && continue
  run_group "$group" "$quick_paths" "$mutate"
done <<< "$GROUPS_SPEC"

echo ""
echo "--- 1回目の結果 ---"
SCORE_STATUS=0
check_aggregate_score || SCORE_STATUS=$?
if [ "$SCORE_STATUS" -eq 0 ]; then
  exit 0
fi
if [ "$SCORE_STATUS" -ne 1 ]; then
  exit "$SCORE_STATUS"
fi

echo ""
echo "合算スコアが break を下回ったため、contract テストを足して該当グループを再実行します。"
RERUN_COUNT=0
while IFS="$TAB" read -r group quick_paths precise_paths mutate; do
  [ -z "$group" ] && continue
  [ "$quick_paths" = "$precise_paths" ] && continue
  run_group "$group" "$precise_paths" "$mutate"
  RERUN_COUNT=$((RERUN_COUNT + 1))
done <<< "$GROUPS_SPEC"

echo ""
echo "--- 再実行後の結果（再実行したグループ: ${RERUN_COUNT}）---"
if ! check_aggregate_score; then
  echo "❌ 合算スコアが break 閾値を下回りました。Survived のミュータントは上の各グループの出力を参照。" >&2
  exit 1
fi
