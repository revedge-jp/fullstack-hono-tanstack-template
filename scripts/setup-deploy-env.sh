#!/usr/bin/env bash
# CI/CD デプロイ用の GitHub Environment（secrets / variables）を対話式でセットアップする。
#
#   bash scripts/setup-deploy-env.sh staging
#   bash scripts/setup-deploy-env.sh production
#   bash scripts/setup-deploy-env.sh preview    # PR プレビュー環境（preview.yml が参照）
#
# 設計方針: デプロイ資格情報をローカルのファイルに保存しない。
# 値は 1Password 等の秘密管理ツールからその場でペーストし、このスクリプトは
# 入力を直接 GitHub（gh secret set / gh variable set）へ流すだけ。ディスクには何も残さない。
# secrets は書き込み専用（GitHub からも読み返せない）ため、再設定時は再入力になる。
#
# 空 Enter でその項目をスキップできる（後から個別に gh secret set / gh variable set で追加可能）。
set -euo pipefail

STAGE="${1:-}"
if [ "$STAGE" != "staging" ] && [ "$STAGE" != "production" ] && [ "$STAGE" != "preview" ]; then
  echo "使い方: bash scripts/setup-deploy-env.sh <staging|production|preview>" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "エラー: gh CLI が必要です（https://cli.github.com/）" >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "エラー: gh CLI が未認証です。gh auth login を実行してください" >&2
  exit 1
fi

REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
echo ""
echo "リポジトリ:   $REPO"
echo "Environment: $STAGE"
echo ""
printf "この Environment に secrets/variables を設定します。続行しますか？ [y/N] "
read -r confirm
case "$confirm" in
  y | Y | yes) ;;
  *)
    echo "中止しました"
    exit 0
    ;;
esac

echo ""
echo "==> Environment '$STAGE' を作成（既存ならそのまま）..."
gh api -X PUT "repos/$REPO/environments/$STAGE" --silent

# item: "名前|kind|説明" （kind: secret = 隠し入力 / var = 通常入力）
# bash 3.2（macOS 標準）互換のため連想配列は使わない
ITEMS="APP_NAME|var|Worker / Hyperdrive / DB の命名ベース。init-template.sh のアプリ名と同じ値。全 stage 共通
PLANETSCALE_ORGANIZATION|var|PlanetScale の組織名。全 stage 共通
WORKERS_SUBDOMAIN|var|CF アカウントの workers.dev サブドメイン（bunx wrangler whoami で確認可）。カスタムドメイン運用でも preview 環境が使うため設定推奨
APP_ORIGIN|var|カスタムドメインの公開 URL（例: https://app.example.com）。workers.dev 運用なら空 Enter でスキップ
SMOKE_BASE_URL|var|デプロイ直後の smoke チェック先 URL（例: https://<app>-staging.<subdomain>.workers.dev）。空だと smoke は skip される
CLOUDFLARE_API_TOKEN|secret|CF API トークン（権限: Workers Scripts:Edit + Hyperdrive:Edit）。stage 間で同じ値を使い回してよい
CLOUDFLARE_ACCOUNT_ID|secret|CF アカウント ID（bunx wrangler whoami で確認可）
PLANETSCALE_SERVICE_TOKEN_ID|secret|PlanetScale サービストークンの ID（org: create_databases + 全 DB read/write/delete 権限、無期限）。stage 間で共有可
PLANETSCALE_SERVICE_TOKEN|secret|同サービストークンの secret
ALCHEMY_STATE_TOKEN|secret|Alchemy state store の認証トークン。CF アカウント内の全プロジェクト・全 stage で【同一の値】にすること
ALCHEMY_PASSWORD|secret|Alchemy state 内 secrets の暗号化パスワード。プロジェクトごとに固有の値を推奨
BETTER_AUTH_SECRET|secret|Better Auth のセッション署名鍵（openssl rand -base64 32 で生成）。【stage ごとに別の値】にすること
GOOGLE_CLIENT_ID|secret|Google OAuth クライアント ID。staging / production で別クライアント推奨
GOOGLE_CLIENT_SECRET|secret|同クライアントの secret"

echo ""
echo "各項目を入力してください（1Password 等からペースト推奨）。空 Enter でスキップ。"
echo "secret はエコーバックされません（画面に表示されない）。"

set_items=""
skipped_items=""

# アイテムリストは fd 3 から読む（stdin はユーザー入力用に空けておく）
while IFS='|' read -r name kind desc <&3; do
  [ -z "$name" ] && continue
  # preview 環境では不要な項目を飛ばす（URL は PR ごとに動的、カスタムドメインなし）
  if [ "$STAGE" = "preview" ]; then
    case "$name" in
      APP_ORIGIN | SMOKE_BASE_URL) continue ;;
    esac
  fi
  echo ""
  # ${} 必須: bash 3.2 は $name の直後の全角文字を変数名の一部として解釈してしまう
  echo "── ${name}（${kind}）"
  echo "   $desc"
  value=""
  if [ "$kind" = "secret" ]; then
    printf "   値: "
    read -rs value
    echo ""
  else
    current=$(gh variable get "$name" --env "$STAGE" -R "$REPO" 2>/dev/null || true)
    if [ -n "$current" ]; then
      printf "   値（現在: %s。空 Enter で維持）: " "$current"
    else
      printf "   値: "
    fi
    read -r value
    if [ -z "$value" ] && [ -n "$current" ]; then
      echo "   → 現在値を維持"
      continue
    fi
  fi
  if [ -z "$value" ]; then
    echo "   → スキップ"
    skipped_items="$skipped_items $name"
    continue
  fi
  if [ "$kind" = "secret" ]; then
    printf '%s' "$value" | gh secret set "$name" --env "$STAGE" -R "$REPO"
  else
    gh variable set "$name" --env "$STAGE" -R "$REPO" --body "$value"
  fi
  echo "   ✅ 設定しました"
  set_items="$set_items $name"
done 3<<EOF
$ITEMS
EOF

echo ""
echo "================================================"
echo "完了: $REPO の Environment '$STAGE'"
if [ -n "$set_items" ]; then
  echo "  設定済み:$set_items"
fi
if [ -n "$skipped_items" ]; then
  echo "  ⚠️ スキップ:$skipped_items"
  echo "  スキップした項目が残っていると deploy job は notice を出して skip されます。"
  echo "  後から追加: gh secret set <NAME> --env $STAGE / gh variable set <NAME> --env $STAGE"
fi
echo ""
if [ "$STAGE" = "staging" ]; then
  echo "次: main への push で staging が自動デプロイされます（DB も自動作成）。"
  echo "    production も使う場合: bash scripts/setup-deploy-env.sh production"
  echo "    PR プレビューも使う場合: bash scripts/setup-deploy-env.sh preview"
elif [ "$STAGE" = "preview" ]; then
  echo "次: PR に preview ラベルを付けると PR ごとのプレビュー環境がデプロイされます。"
else
  echo "次: v*.*.* タグの push で production が自動デプロイされます。"
fi
