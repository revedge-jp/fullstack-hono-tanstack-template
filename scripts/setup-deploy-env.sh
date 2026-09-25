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
if [ "$STAGE" = "preview" ]; then
  # preview は PR のブランチから動くのでデプロイ元を制限できない。production に届く値を置かないことで守る
  gh api -X PUT "repos/$REPO/environments/$STAGE" --silent
else
  # staging / production のデプロイ元を main に限る。制限の無い Environment の secrets は、それを参照する
  # どのジョブにも渡る（同じリポジトリの PR がワークフローを足して environment: production を参照すれば、
  # マージ前に読める）。deploy.yml は workflow_run で main 上のジョブとして動くので、main に限っても止まらない。
  #
  # Environment の PUT は保護設定をまるごと置き換える（送らなかった承認者・待機時間は消える）ので、既存の
  # Environment は現在の設定を読んで引き継ぐ。読めない理由が「存在しない」以外なら、消さないよう中断する
  # 出力は tojson で文字列にする（オブジェクトのままだと CLICOLOR_FORCE / GH_FORCE_TTY 下で色コードが混ざり、JSON が壊れる）。
  # can_admins_bypass は既定（true）と違うときだけ送る（使えないプランでフィールドごと拒否されないように）
  env_err_file=$(mktemp)
  trap 'rm -f "$env_err_file"' EXIT
  if env_body=$(gh api "repos/$REPO/environments/$STAGE" --jq '
    (.protection_rules // []) as $rules
    | ([$rules[] | select(.type == "required_reviewers")] | first) as $review
    | ([$rules[] | select(.type == "wait_timer")] | first) as $wait
    | {deployment_branch_policy: {protected_branches: false, custom_branch_policies: true}}
      + (if .can_admins_bypass == false then {can_admins_bypass: false} else {} end)
      + (if $wait == null then {} else {wait_timer: $wait.wait_timer} end)
      + (if $review == null then {} else {
          prevent_self_review: ($review.prevent_self_review // false),
          reviewers: [$review.reviewers[] | {type: .type, id: .reviewer.id}]
        } end)
    | tojson' 2>"$env_err_file"); then
    :
  elif grep -q 'HTTP 404' "$env_err_file"; then
    env_body='{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
  else
    echo "エラー: Environment '${STAGE}' の現在の設定を読めませんでした（既存の保護設定を消さないよう中断します）: $(cat "$env_err_file")" >&2
    exit 1
  fi
  if printf '%s' "$env_body" | gh api -X PUT "repos/$REPO/environments/$STAGE" --silent --input -; then
    branch_policy_failed="    再実行してください: bash scripts/setup-deploy-env.sh ${STAGE}（デプロイ元の許可が 0 件のままだと ${STAGE} へのデプロイはすべて拒否されます）"
    if ! policies=$(gh api "repos/$REPO/environments/$STAGE/deployment-branch-policies" \
      --jq '.branch_policies[] | "\(.type // "branch")\t\(.name)"'); then
      echo "エラー: デプロイ元の許可一覧を読めませんでした" >&2
      echo "$branch_policy_failed" >&2
      exit 1
    fi
    if ! printf '%s\n' "$policies" | grep -qx "$(printf 'branch\tmain')"; then
      if ! gh api -X POST "repos/$REPO/environments/$STAGE/deployment-branch-policies" \
        -f name=main -f type=branch --silent; then
        echo "エラー: デプロイ元に main を追加できませんでした" >&2
        echo "$branch_policy_failed" >&2
        exit 1
      fi
    fi
    # 既にある main 以外の許可は意図して足したものかもしれないので消さない。残っている限り「main に限った」とは言わない
    others=$(printf '%s\n' "$policies" | grep -vx "$(printf 'branch\tmain')" | grep . || true)
    if [ -z "$others" ]; then
      echo "    デプロイ元を main に限りました"
    else
      echo "⚠️  デプロイ元に main を許可しましたが、main 以外の許可も残っています（種別・名前）:"
      printf '%s\n' "$others" | sed 's/^/      /'
      echo "   不要なら Settings → Environments → ${STAGE} → Deployment branches and tags で削除してください"
    fi
  else
    # private リポジトリの Free プラン等、デプロイ元の制限が使えない場合。既にある Environment には触らない
    # （本文なしの PUT は既存の制限を消しうるので、一時的な失敗で制限を外さない）
    echo "⚠️  デプロイ元を main に限れませんでした（プランの制限か一時的な失敗）。"
    echo "   制限が無いと、PR がワークフローを足せば ${STAGE} の secrets を読めます（docs/dev/alchemy-iac.md「state と資格情報の権限境界」）"
    if ! gh api "repos/$REPO/environments/$STAGE" --silent 2>/dev/null; then
      gh api -X PUT "repos/$REPO/environments/$STAGE" --silent
    fi
  fi
fi

# item: "名前|kind|説明" （kind: secret = 隠し入力 / var = 通常入力）
# bash 3.2（macOS 標準）互換のため連想配列は使わない
ITEMS="APP_NAME|var|Worker / Hyperdrive / DB の命名ベース。init-template.sh のアプリ名と同じ値。全 stage 共通
PLANETSCALE_ORGANIZATION|var|PlanetScale の組織名。preview は staging と同じ組織（staging DB のブランチを使うため）。production は別の組織を推奨（docs/dev/alchemy-iac.md「state と資格情報の権限境界」）
WORKERS_SUBDOMAIN|var|CF アカウントの workers.dev サブドメイン（bunx wrangler whoami で確認可）。カスタムドメイン運用でも preview 環境が使うため設定推奨
CUSTOM_DOMAIN|var|Worker に割り当てるカスタムドメインのホスト名（例: app.example.com。zone が CF アカウントにあること）。DNS/TLS/公開 URL は Alchemy が自動設定。workers.dev 運用なら空 Enter でスキップ
EDGE_RATE_LIMIT_RPM|var|エッジ（WAF）での /api/* レート制限（IP ごとの分間リクエスト数、例: 300）。CUSTOM_DOMAIN 必須。zone の http_ratelimit フェーズを専有するため zone を共有する場合は 1 stage のみで設定（管理外の既存ルールを検知した場合、deploy は上書きせず中断する）。不要なら空 Enter
SMOKE_BASE_URL|var|デプロイ直後の smoke チェック先 URL（例: https://<app>-staging.<subdomain>.workers.dev）。空だと smoke は skip される
CLOUDFLARE_API_TOKEN|secret|CF API トークン（権限: Workers Scripts:Edit + Hyperdrive:Edit。CUSTOM_DOMAIN 利用時は対象 zone の Zone:Read + DNS:Edit、EDGE_RATE_LIMIT_RPM 利用時は Zone WAF:Edit、LOGPUSH_DESTINATION 利用時は Logs:Edit も追加）。同じ CF アカウントの staging / production では同じ値を使い回してよい（production を別アカウントに置くならそのアカウント用に、preview は専用に発行）。発行時のトークン名は「<APP_NAME>-deploy」推奨（例: my-app-deploy。preview 用は my-app-preview）
CLOUDFLARE_ACCOUNT_ID|secret|CF アカウント ID（bunx wrangler whoami で確認可）
PLANETSCALE_SERVICE_TOKEN_ID|secret|PlanetScale サービストークンの ID（org: create_databases + DB read/write/delete 権限、無期限）。【Environment ごとに別に発行】し、production 用は production にだけ置く。staging / preview のトークンが production の DB に届かないよう、production は別の PlanetScale org に置くのが確実（docs/dev/alchemy-iac.md「state と資格情報の権限境界」）。発行時のトークン名は「<APP_NAME>-<stage>」推奨（例: my-app-production）
PLANETSCALE_SERVICE_TOKEN|secret|同サービストークンの secret
ALCHEMY_STATE_TOKEN|secret|Alchemy state store の認証トークン。同じ CF アカウント内の全プロジェクト・全 stage で【同一の値】にし、別アカウントには別の値を使う（このトークンで同じアカウントの全 state を読み書きできる。docs/dev/alchemy-iac.md「state と資格情報の権限境界」）
ALCHEMY_PASSWORD|secret|Alchemy state 内 secrets の暗号化パスワード。プロジェクトごとに固有の値を推奨（openssl rand -base64 32 で生成）。既に deploy した stage の値は変えない（state 内の secrets を復号できずデプロイが止まる）
BETTER_AUTH_SECRET|secret|Better Auth のセッション署名鍵（openssl rand -base64 32 で生成）。【stage ごとに別の値】にすること
GOOGLE_CLIENT_ID|secret|Google OAuth クライアント ID。staging / production で別クライアント推奨。作成時のクライアント名は「<APP_NAME>-<stage>」推奨（例: my-app-staging）
GOOGLE_CLIENT_SECRET|secret|同クライアントの secret
LOGPUSH_DESTINATION|secret|Worker trace ログの Logpush 宛先 URI（例: r2://bucket/path?account-id=...&access-key-id=...&secret-access-key=...）。Workers Paid プラン必須。不要なら空 Enter でスキップ"

echo ""
echo "各項目を入力してください（1Password 等からペースト推奨）。空 Enter でスキップ。"
echo "secret はエコーバックされません（画面に表示されない）。"

set_items=""
skipped_items=""

if [ "$STAGE" = "preview" ]; then
  echo ""
  echo "⚠️  preview は PR のコード（bun install / build / migrate）をこの Environment の資格情報で実行します。"
  echo "   CLOUDFLARE_API_TOKEN / PLANETSCALE_SERVICE_TOKEN は production と共有せず、preview 専用に発行してください"
  echo "   （.claude/rules/agent-permissions.md の Rule of Two。PR を書くエージェントに本番を消せる資格情報を渡さない）"
  echo "   ALCHEMY_STATE_TOKEN と CF トークンは同じアカウントの全プロジェクト・全 stage に届くため、preview を使う"
  echo "   CF アカウントにはどのプロジェクトの production も置かず、production に届くトークンを preview に渡さないでください"
  echo "   （docs/dev/alchemy-iac.md「state と資格情報の権限境界」）"
fi

# アイテムリストは fd 3 から読む（stdin はユーザー入力用に空けておく）
while IFS='|' read -r name kind desc <&3; do
  [ -z "$name" ] && continue
  # preview 環境では不要な項目を飛ばす（URL は PR ごとに動的、カスタムドメインなし）
  if [ "$STAGE" = "preview" ]; then
    case "$name" in
      CUSTOM_DOMAIN | EDGE_RATE_LIMIT_RPM | SMOKE_BASE_URL | LOGPUSH_DESTINATION) continue ;;
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
