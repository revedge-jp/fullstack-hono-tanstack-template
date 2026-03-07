#!/bin/bash
set -euo pipefail

# push 前の統合チェック
# 環境変数:
#  - CI=true or CI_MODE=1 : 簡素(機械可読寄り)出力
#  - NO_COLOR: 色無し
#  - TURBO_FILTER : turbo の filter（例: '...[origin/main]'）
#  - SKIP_LINT, SKIP_TYPECHECK, SKIP_TEST, SKIP_ARCH, SKIP_FILENAME, SKIP_PROCESS_ENV, SKIP_DEPRECATED : 各ステップをスキップ
#  - SKIP_FSD, SKIP_DEPS, SKIP_DC, SKIP_GUARDS, SKIP_KNIP : アーキテクチャ個別スキップ（SKIP_ARCH=1 のときは無視）

if [ "${CI:-}" = "true" ] || [ "${CI_MODE:-0}" = "1" ]; then PRETTY=0; else PRETTY=1; fi
if [ -n "${NO_COLOR:-}" ] || [ "$PRETTY" = "0" ] || [ ! -t 1 ]; then
  RED=""; GREEN=""; YELLOW=""; BLUE=""; NC="";
else
  RED="\033[31m"; GREEN="\033[32m"; YELLOW="\033[33m"; BLUE="\033[34m"; NC="\033[0m";
fi

# 変更影響駆動の既定フィルタ（未指定時は main との差分）
: "${TURBO_FILTER:=...[origin/main]}"

# FAST=1 のとき、重いチェックはデフォルトでスキップ（手動で上書き可能）
if [ "${FAST:-0}" = "1" ]; then
  : "${SKIP_KNIP:=1}"
  : "${SKIP_DEPS:=1}"
  : "${SKIP_DC:=1}"
fi

emoji() { [ "$PRETTY" = "1" ] && printf "%s " "$1" || true; }
heading() { emoji "🔍"; printf "%b%s%b\n" "$BLUE" "$1" "$NC"; }
ok() { emoji "✅"; printf "%b%s%b\n" "$GREEN" "$1" "$NC"; }
warn() { emoji "⚠️"; printf "%b%s%b\n" "$YELLOW" "$1" "$NC"; }
err() { emoji "❌"; printf "%b%s%b\n" "$RED" "$1" "$NC"; }

ROOT_DIR="$(cd -- "$(dirname "$0")/../.." >/dev/null 2>&1 ; pwd -P)"
cd "$ROOT_DIR"

FAIL=0

heading "品質チェック (lint/type/test/arch/filename/process.env/deprecated)"

# --- 全チェックを単一並列グループで実行 ---
PIDS=()
STEP_RESULTS=$(mktemp -d)

run_step_bg() {
  local name="$1"; shift
  local result_file="$STEP_RESULTS/$name"
  (
    local OUT ERR
    OUT=$(mktemp) ; ERR=$(mktemp)
    if "$@" >"$OUT" 2>"$ERR"; then
      echo "ok" > "$result_file.status"
      cp "$OUT" "$result_file.out"
    else
      echo "fail" > "$result_file.status"
      cp "$OUT" "$result_file.out"
      cp "$ERR" "$result_file.err"
    fi
    rm -f "$OUT" "$ERR"
  ) &
  PIDS+=($!)
}

# Lint（変更影響に限定）
if [ "${SKIP_LINT:-}" != "1" ]; then
  run_step_bg "Lint" bunx turbo run lint --filter="${TURBO_FILTER}"
fi

# Typecheck（変更影響に限定）
if [ "${SKIP_TYPECHECK:-}" != "1" ]; then
  run_step_bg "Typecheck" bunx turbo run typecheck --filter="${TURBO_FILTER}"
fi

# Tests（常時フル実行。DB migrate deploy を含む）
if [ "${SKIP_TEST:-}" != "1" ]; then
  run_step_bg "Tests" bash -lc "dotenv -e .env -- sh -c 'cd packages/database && DATABASE_URL=\"\$TEST_DATABASE_URL\" bunx prisma migrate deploy && cd ../../ && DATABASE_URL=\"\$TEST_DATABASE_URL\" bunx turbo run test --filter=\"${TURBO_FILTER}\" --continue'"
fi

# Filename check
if [ "${SKIP_FILENAME:-}" != "1" ]; then
  run_step_bg "Filename" node scripts/check/check-kebab-case.mjs
fi

# Architecture 個別チェック（SKIP_ARCH=1 のときはすべてスキップ）
if [ "${SKIP_ARCH:-}" != "1" ]; then
  if [ "${SKIP_FSD:-0}" != "1" ]; then
    run_step_bg "FSD" bun run arch:fsd
  fi
  if [ "${SKIP_DEPS:-0}" != "1" ]; then
    run_step_bg "Deps" bun run arch:deps
  fi
  if [ "${SKIP_DC:-0}" != "1" ]; then
    run_step_bg "DC" bun run arch:dc
  fi
  if [ "${SKIP_GUARDS:-0}" != "1" ]; then
    run_step_bg "Guards" bash scripts/check/arch-guards.sh
  fi
  if [ "${SKIP_KNIP:-0}" != "1" ]; then
    run_step_bg "Knip" bun run arch:knip
  fi
fi

# process.env 直接参照チェック（api-service アプリケーションコードのみ）
if [ "${SKIP_PROCESS_ENV:-}" != "1" ]; then
  run_step_bg "ProcessEnv" bash -c 'grep -rn "process\.env\." apps/api-service/src/ --include="*.ts" --exclude="*.test.ts" --exclude-dir="__tests__" --exclude="config.ts" 2>/dev/null; r=$?; [ $r -eq 1 ] && exit 0; exit 1'
fi

# 非推奨コードの検索（パターン検索のみ。typecheck は Group 1 に委ねる）
if [ "${SKIP_DEPRECATED:-}" != "1" ]; then
  run_step_bg "Deprecated" bash scripts/check/find-deprecated.sh
fi

# バックグラウンドジョブの完了を待機
for pid in "${PIDS[@]}"; do
  wait "$pid" || true
done

# 結果を表示（Deprecated は警告のみで FAIL にしない）
WARN_ONLY_STEPS="Deprecated"
for name in Lint Typecheck Tests Filename FSD Deps DC Guards Knip ProcessEnv Deprecated; do
  status_file="$STEP_RESULTS/$name.status"
  [ -f "$status_file" ] || continue
  status=$(cat "$status_file")
  if [ "$status" = "ok" ]; then
    ok "$name: OK"
    if [ "$PRETTY" = "1" ] && [ -f "$STEP_RESULTS/$name.out" ]; then
      tail -n 3 "$STEP_RESULTS/$name.out" | sed -e 's/^/  • /'
    fi
  else
    if echo "$WARN_ONLY_STEPS" | grep -qw "$name"; then
      warn "$name: 警告"
      if [ "$PRETTY" = "1" ]; then
        if [ -f "$STEP_RESULTS/$name.out" ]; then
          { grep -E "(ERROR|Error|error|✖|failed|violation|TS[0-9]+|⚠️|deprecated|非推奨)" "$STEP_RESULTS/$name.out" || true; } | head -n 10 | sed -e 's/^/  • /'
        fi
        if [ -f "$STEP_RESULTS/$name.err" ]; then
          { tail -n 20 "$STEP_RESULTS/$name.err" || true; } | sed -e 's/^/  • /'
        fi
      fi
    else
      err "$name: ERROR"
      if [ "$PRETTY" = "1" ]; then
        if [ -f "$STEP_RESULTS/$name.out" ]; then
          { grep -E "(ERROR|Error|error|✖|failed|violation|TS[0-9]+|process\.env)" "$STEP_RESULTS/$name.out" || cat "$STEP_RESULTS/$name.out"; } | head -n 20 | sed -e 's/^/  • /'
        fi
        if [ -f "$STEP_RESULTS/$name.err" ]; then
          { tail -n 20 "$STEP_RESULTS/$name.err" || true; } | sed -e 's/^/  • /'
        fi
      fi
      FAIL=1
    fi
  fi
done

# 一時ディレクトリの掃除
rm -rf "$STEP_RESULTS"

if [ "$FAIL" = "0" ]; then
  ok "push 前チェックに成功しました"
  exit 0
else
  err "push 前チェックで失敗が見つかりました"
  exit 1
fi
