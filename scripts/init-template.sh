#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# テンプレート初期化スクリプト
#
# {{APP_NAME}} プレースホルダーをアプリ名に一括置換する。
# テンプレートから新しいプロジェクトを作ったら、最初に一度だけ実行する。
#
# 使い方:
#   ./scripts/init-template.sh <app-name>
#   例: ./scripts/init-template.sh my-app
#
# app-name の制約（Cloudflare Workers の name 制約に準拠）:
#   - 英小文字・数字・ハイフンのみ / 先頭末尾は英数字
#   - 54文字以内（"-staging" サフィックスを付けても Workers の上限 63 文字に収まる長さ）
# =============================================================================

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# このスクリプト自身が git grep に引っかからないよう、プレースホルダーは動的に組み立てる
PLACEHOLDER='{{'APP_NAME'}}'

# 置換対象外: プレースホルダーの「仕組み」そのものを説明・処理しているファイル
EXCLUDES=(
  ".github/workflows/ci.yml"      # CI がプレースホルダーを検出・置換するステップを含む
  "docs/dev/troubleshooting.md"   # プレースホルダー起因のエラーの説明
  "scripts/init-template.sh"      # 自分自身
)

usage() {
  echo "使い方: $0 <app-name>"
  echo "  例: $0 my-app"
  echo "  制約: 英小文字・数字・ハイフンのみ（先頭末尾は英数字）、54文字以内"
}

if [ $# -ne 1 ]; then
  usage
  exit 1
fi

APP_NAME="$1"

if ! printf '%s' "$APP_NAME" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'; then
  echo "エラー: app-name は英小文字・数字・ハイフンのみで、先頭末尾は英数字にしてください: $APP_NAME" >&2
  usage
  exit 1
fi

if [ "${#APP_NAME}" -gt 54 ]; then
  echo "エラー: app-name は54文字以内にしてください（staging サフィックス込みで Workers の name 上限に収めるため）: ${#APP_NAME}文字" >&2
  exit 1
fi

# 対象ファイルを収集（git 追跡ファイルのみ = node_modules 等は自動的に対象外）
# ※ mapfile は macOS 標準の bash 3.2 に無いため while-read で組む
TARGETS=()
while IFS= read -r f; do
  [ -z "$f" ] && continue
  skip=0
  for ex in "${EXCLUDES[@]}"; do
    if [ "$f" = "$ex" ]; then
      skip=1
      break
    fi
  done
  [ "$skip" = "0" ] && TARGETS+=("$f")
done < <(git grep -l "$PLACEHOLDER" 2>/dev/null || true)

if [ "${#TARGETS[@]}" -eq 0 ]; then
  echo "✅ 置換対象が見つかりません。すでに初期化済みのようです。"
  exit 0
fi

echo "アプリ名 '$APP_NAME' で以下のファイルを初期化します:"
for f in "${TARGETS[@]}"; do
  count=$(grep -c "$PLACEHOLDER" "$f" || true)
  echo "  • $f (${count}箇所)"
done

for f in "${TARGETS[@]}"; do
  # perl -pi: macOS / Linux 両対応のインプレース置換（sed -i は挙動が異なるため使わない）
  APP_NAME="$APP_NAME" PLACEHOLDER="$PLACEHOLDER" perl -pi -e 's/\Q$ENV{PLACEHOLDER}\E/$ENV{APP_NAME}/g' "$f"
done

echo ""
echo "✅ 初期化が完了しました。"
echo ""
echo "次のステップ:"
echo "  1. 変更内容を確認してコミット: git diff && git add -A && git commit -m 'chore: initialize template as $APP_NAME'"
echo "  2. README.md のタイトル・説明を自分のプロジェクト用に書き換える"
echo "  3. .env を作成する（README のクイックスタート参照）"
echo "  4. GitHub リポジトリの保護設定・Renovate を有効化: ./scripts/setup-github.sh"
echo "  5. CI/CD デプロイ用の Secrets と SMOKE_BASE_URL（Environments 変数）を設定する"
echo "     手順: docs/deploy/cloudflare-workers.md の「GitHub Secrets / Environments の設定」"
