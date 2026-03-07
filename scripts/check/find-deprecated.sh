#!/bin/bash
set -euo pipefail

# 既知の非推奨パターンを検索（typecheck 由来の deprecated は check-all の Typecheck ステップに委ねる）
FAIL=0

echo "1. 既知の非推奨パターンを検索"
echo "----------------------------------------"

echo "ZodIssue の使用:"
if find apps packages \
  \( -path '*/node_modules/*' -o -path '*/dist/*' -o -path '*/.next/*' \) -prune -o \
  -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | \
  xargs -0 grep -nE 'ZodIssue|z\.ZodIssue' >/dev/null 2>&1; then
  echo "  ⚠️  ZodIssue の使用が見つかりました"
  find apps packages \
    \( -path '*/node_modules/*' -o -path '*/dist/*' -o -path '*/.next/*' \) -prune -o \
    -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | \
    xargs -0 grep -nE 'ZodIssue|z\.ZodIssue' || true
  FAIL=1
else
  echo "  ✅ 見つかりませんでした"
fi

echo ""
echo "Zod v4の非推奨メソッド (.email(), .url(), .datetime()):"
if find apps packages \
  \( -path '*/node_modules/*' -o -path '*/dist/*' -o -path '*/.next/*' \) -prune -o \
  -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | \
  xargs -0 grep -nE 'z\.string\(\)\.email\(\)|z\.string\(\)\.url\(\)|z\.string\(\)\.datetime\(\)' >/dev/null 2>&1; then
  echo "  ⚠️  非推奨メソッドが見つかりました"
  find apps packages \
    \( -path '*/node_modules/*' -o -path '*/dist/*' -o -path '*/.next/*' \) -prune -o \
    -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | \
    xargs -0 grep -nE 'z\.string\(\)\.email\(\)|z\.string\(\)\.url\(\)|z\.string\(\)\.datetime\(\)' || true
  FAIL=1
else
  echo "  ✅ 見つかりませんでした"
fi

echo ""
echo "Honoの非推奨API (routePath):"
if find apps packages \
  \( -path '*/node_modules/*' -o -path '*/dist/*' -o -path '*/.next/*' \) -prune -o \
  -type f \( -name '*.ts' -o -name '*.tsx' \) ! -name 'instrumentation.ts' -print0 | \
  xargs -0 grep -nE 'c\.req\.routePath' >/dev/null 2>&1; then
  echo "  ⚠️  routePath の使用が見つかりました"
  find apps packages \
    \( -path '*/node_modules/*' -o -path '*/dist/*' -o -path '*/.next/*' \) -prune -o \
    -type f \( -name '*.ts' -o -name '*.tsx' \) ! -name 'instrumentation.ts' -print0 | \
    xargs -0 grep -nE 'c\.req\.routePath' || true
  FAIL=1
else
  echo "  ✅ 見つかりませんでした"
fi

echo ""
echo "2. @deprecated JSDocタグの検索"
echo "----------------------------------------"
if find apps packages \
  \( -path '*/node_modules/*' -o -path '*/dist/*' -o -path '*/.next/*' \) -prune -o \
  -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | \
  xargs -0 grep -nE '@deprecated' >/dev/null 2>&1; then
  echo "  ⚠️  @deprecated タグが見つかりました（情報のみ）"
  find apps packages \
    \( -path '*/node_modules/*' -o -path '*/dist/*' -o -path '*/.next/*' \) -prune -o \
    -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | \
    xargs -0 grep -nE '@deprecated' || true
else
  echo "  ✅ 見つかりませんでした"
fi

echo ""
if [ "$FAIL" = "0" ]; then
  echo "✅ 検索完了: 非推奨コードは見つかりませんでした"
  exit 0
else
  echo "⚠️  検索完了: 非推奨コードが見つかりました"
  exit 1
fi
