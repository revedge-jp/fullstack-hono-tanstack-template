#!/bin/bash
set -euo pipefail

# Options:
#  - CI=true or CI_MODE=1 : 簡素(機械可読寄り)出力
#  - NO_COLOR: 色無し
#  - SKIP_FSD=1 / SKIP_DEPS=1 / SKIP_DC=1 / SKIP_GUARDS=1 / SKIP_KNIP=1 / SKIP_DUP=1 / SKIP_SELFTEST=1 : 各チェックをスキップ

if [ "${CI:-}" = "true" ] || [ "${CI_MODE:-0}" = "1" ]; then PRETTY=0; else PRETTY=1; fi
if [ -n "${NO_COLOR:-}" ] || [ "$PRETTY" = "0" ] || [ ! -t 1 ]; then
  RED=""; GREEN=""; YELLOW=""; BLUE=""; NC="";
else
  RED="\033[31m"; GREEN="\033[32m"; YELLOW="\033[33m"; BLUE="\033[34m"; NC="\033[0m";
fi

# FAST=1 のとき、重いチェックはデフォルトでスキップ（手動で上書き可能）
if [ "${FAST:-0}" = "1" ]; then
  : "${SKIP_KNIP:=1}"
  : "${SKIP_DEPS:=1}"
  : "${SKIP_DC:=1}"
  : "${SKIP_DUP:=1}"
  : "${SKIP_SELFTEST:=1}"
fi

emoji() { [ "$PRETTY" = "1" ] && printf "%s " "$1" || true; }
heading() { emoji "🔍"; printf "%b%s%b\n" "$BLUE" "$1" "$NC"; }
ok() { emoji "✅"; printf "%b%s%b\n" "$GREEN" "$1" "$NC"; }
warn() { emoji "⚠️"; printf "%b%s%b\n" "$YELLOW" "$1" "$NC"; }
err() { emoji "❌"; printf "%b%s%b\n" "$RED" "$1" "$NC"; }

ROOT_DIR="$(cd -- "$(dirname "$0")/../.." >/dev/null 2>&1 ; pwd -P)"
cd "$ROOT_DIR"

heading "アーキテクチャ / FSD チェック開始..."

FAIL=0

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

# 1) FSD (steiger)
if [ "${SKIP_FSD:-0}" != "1" ]; then
  run_step_bg "FSD" bun run arch:fsd
else
  warn "FSD チェックは SKIP_FSD=1 によりスキップ"
fi

# 2) 依存 (madge)
if [ "${SKIP_DEPS:-0}" != "1" ]; then
  run_step_bg "Deps" bun run arch:deps
else
  warn "依存チェックは SKIP_DEPS=1 によりスキップ"
fi

# 3) 依存規約 (dependency-cruiser)
if [ "${SKIP_DC:-0}" != "1" ]; then
  run_step_bg "DC" bun run arch:dc
else
  warn "依存規約チェックは SKIP_DC=1 によりスキップ"
fi

# 4) ガード (構文/配置)
if [ "${SKIP_GUARDS:-0}" != "1" ]; then
  run_step_bg "Guards" bash scripts/check/arch-guards.sh
else
  warn "ガードチェックは SKIP_GUARDS=1 によりスキップ"
fi

# 5) 未使用 (knip)
if [ "${SKIP_KNIP:-0}" != "1" ]; then
  run_step_bg "Knip" bun run arch:knip
else
  warn "未使用チェックは SKIP_KNIP=1 によりスキップ"
fi

# 6) 重複 (jscpd)
if [ "${SKIP_DUP:-0}" != "1" ]; then
  run_step_bg "Dup" bun run dup:check
else
  warn "重複チェックは SKIP_DUP=1 によりスキップ"
fi

# バックグラウンドジョブの完了を待機
for pid in "${PIDS[@]}"; do
  wait "$pid" || true
done

# 7) ガード自己テスト（fixture を一時作成して既存ガードを発火させるため、
#    Guards と並列に走らせると同じ fixture パスを奪い合いフレーキーになる。
#    並列バッチが完全に終わってから単独で実行する）
if [ "${SKIP_SELFTEST:-0}" != "1" ]; then
  SELFTEST_OUT=$(mktemp); SELFTEST_ERR=$(mktemp)
  if bash scripts/check/arch-guards.selftest.sh >"$SELFTEST_OUT" 2>"$SELFTEST_ERR"; then
    echo "ok" > "$STEP_RESULTS/Selftest.status"
  else
    echo "fail" > "$STEP_RESULTS/Selftest.status"
  fi
  cp "$SELFTEST_OUT" "$STEP_RESULTS/Selftest.out"
  cp "$SELFTEST_ERR" "$STEP_RESULTS/Selftest.err"
  rm -f "$SELFTEST_OUT" "$SELFTEST_ERR"
else
  warn "ガード自己テストは SKIP_SELFTEST=1 によりスキップ"
fi

# 結果を表示（失敗時の詳細表示）
show_fail_detail() {
  local name="$1"
  local out_file="$STEP_RESULTS/$name.out"
  local err_file="$STEP_RESULTS/$name.err"
  case "$name" in
    Guards)
      if grep -q "違反:" "$out_file" 2>/dev/null; then
        grep -A 30 "違反:" "$out_file" | while IFS= read -r line; do
          if [[ "$line" =~ ^違反: ]]; then
            echo "  • $line"
          elif [[ "$line" =~ ^[[:space:]]*• ]]; then
            echo "  $line"
          else
            echo "  $line"
          fi
        done
      else
        tail -n 100 "$out_file" | sed -e 's/^/  • /'
      fi
      ;;
    Deps)
      tail -n 50 "$out_file" | sed -e 's/^/  • /'
      ;;
    Selftest)
      { grep -F "❌" "$out_file" || true; } | sed -e 's/^/  • /'
      ;;
    *)
      { grep -E "(ERROR|Error|error|✖|failed|violation)" "$out_file" || true; } | head -n 10 | sed -e 's/^/  • /'
      ;;
  esac
  { tail -n 20 "$err_file" || true; } | sed -e 's/^/  • /'
}

STEP_LABELS="FSD:FSD (steiger)
Deps:依存(循環/孤立)
DC:依存規約(dependency-cruiser)
Guards:構文/配置ガード
Knip:未使用(knip)
Dup:重複(jscpd)
Selftest:ガード自己テスト"

for name in FSD Deps DC Guards Knip Dup Selftest; do
  status_file="$STEP_RESULTS/$name.status"
  [ -f "$status_file" ] || continue
  status=$(cat "$status_file")
  label=$(echo "$STEP_LABELS" | grep "^$name:" | cut -d: -f2-)
  [ -n "$label" ] || label="$name"
  if [ "$status" = "ok" ]; then
    ok "$label: OK"
    if [ "$PRETTY" = "1" ] && [ -f "$STEP_RESULTS/$name.out" ]; then
      tail -n 3 "$STEP_RESULTS/$name.out" | sed -e 's/^/  • /'
    fi
  else
    err "$label: ERROR"
    show_fail_detail "$name"
    FAIL=1
  fi
done

rm -rf "$STEP_RESULTS"

if [ "$FAIL" = "0" ]; then
  ok "すべてのアーキテクチャチェックに成功しました"
  exit 0
else
  err "アーキテクチャチェックに失敗しました"
  exit 1
fi
