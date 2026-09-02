#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# GitHub リポジトリセットアップスクリプト
#
# テンプレートから作った新しいリポジトリに対して、以下を一括適用する:
#   1. Branch Ruleset "main-branch-protection"（作成 or 更新、冪等）
#   2. リポジトリ設定（マージ後ブランチ自動削除・auto-merge 等）
#   3. セキュリティ設定（脆弱性アラート・Dependabot security updates・secret scanning）
#   4. Renovate App の導入状況チェック（App のインストール自体はブラウザ承認が必要なため
#      スクリプト化できない — 未導入なら URL を案内する）
#
# 前提: gh CLI がインストール済みで `gh auth login` 済みであること。
# 設定内容の詳細・チーム開発向けの変更方法は docs/deploy/github-ruleset.md を参照。
#
# 使い方:
#   ./scripts/setup-github.sh
# =============================================================================

if ! command -v gh > /dev/null 2>&1; then
  echo "エラー: gh CLI が見つかりません。https://cli.github.com/ からインストールしてください。" >&2
  exit 1
fi

if ! gh auth status > /dev/null 2>&1; then
  echo "エラー: gh CLI が未認証です。'gh auth login' を実行してください。" >&2
  exit 1
fi

REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')
echo "対象リポジトリ: $REPO"
echo ""

# -----------------------------------------------------------------------------
# 1. Branch Ruleset（main-branch-protection）
#    一人開発向けの既定値（レビュー0名）。チーム開発時の変更方法は
#    docs/deploy/github-ruleset.md を参照。
# -----------------------------------------------------------------------------
echo "=== 1/4 Branch Ruleset (main-branch-protection) ==="

# merge queue を使う。「マージ前にブランチを最新化」(strict_required_status_checks_policy)は
# 並行 PR があるたびに最新化 → CI 再実行の連鎖を生むので使わず、キューが「main に積んだ状態」で
# CI Pipeline を 1 回走らせてからマージする。CI 側は .github/workflows/ci.yml の `merge_group:`
# トリガーが対応する。詳細は docs/deploy/github-ruleset.md の「merge queue」節。

RULESET_JSON=$(cat << 'EOF'
{
  "name": "main-branch-protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "CI Pipeline" }
        ]
      }
    },
    {
      "type": "merge_queue",
      "parameters": {
        "merge_method": "SQUASH",
        "grouping_strategy": "ALLGREEN",
        "min_entries_to_merge": 1,
        "max_entries_to_merge": 5,
        "min_entries_to_merge_wait_minutes": 0,
        "max_entries_to_build": 5,
        "check_response_timeout_minutes": 60
      }
    }
  ],
  "bypass_actors": []
}
EOF
)

# Ruleset は「public リポジトリ」または「GitHub Pro / Team / Enterprise」でのみ使える。
# private + Free プランでは 403 になるため、その場合は案内を出して他のステップを続行する。
if ! gh api "repos/${REPO}/rulesets" > /tmp/setup-github-rulesets.json 2>/dev/null; then
  echo "⚠️  Ruleset を設定できません（private リポジトリでは GitHub Pro 以上のプランが必要です）。"
  echo "    リポジトリを public にするか、プランをアップグレードした後に再実行してください。"
  echo "    それまでは main への直接 push を手動運用で避けてください。"
else
  RULESET_ID=$(jq -r '.[] | select(.name == "main-branch-protection") | .id' /tmp/setup-github-rulesets.json 2>/dev/null || true)

  if [ -n "$RULESET_ID" ]; then
    printf '%s' "$RULESET_JSON" | gh api "repos/${REPO}/rulesets/${RULESET_ID}" --method PUT --input - > /dev/null
    echo "✅ 既存の Ruleset (id: $RULESET_ID) を更新しました"
  else
    printf '%s' "$RULESET_JSON" | gh api "repos/${REPO}/rulesets" --method POST --input - > /dev/null
    echo "✅ Ruleset を作成しました"
  fi
fi
rm -f /tmp/setup-github-rulesets.json

# -----------------------------------------------------------------------------
# 2. リポジトリ設定
# -----------------------------------------------------------------------------
echo ""
echo "=== 2/4 リポジトリ設定（マージ挙動） ==="

RESULT=$(gh api "repos/${REPO}" --method PATCH \
  -F delete_branch_on_merge=true \
  -F allow_squash_merge=true \
  -F allow_merge_commit=true \
  -F allow_rebase_merge=true \
  -F allow_auto_merge=true \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=PR_BODY \
  --jq '{delete_branch_on_merge, allow_auto_merge}')
echo "✅ マージ後ブランチ自動削除 / squash・merge・rebase を有効化しました"
# auto-merge は Ruleset と同じく public リポジトリ or 有料プランが必要で、
# 対象外の場合 API はエラーを返さず黙って無視する。実際の値で判定して案内する。
if printf '%s' "$RESULT" | grep -q '"allow_auto_merge":true'; then
  echo "✅ Auto-merge を有効化しました"
else
  echo "⚠️  Auto-merge は有効化されませんでした（private リポジトリでは GitHub Pro 以上が必要）"
fi

# -----------------------------------------------------------------------------
# 3. セキュリティ設定
#    secret scanning は private リポジトリでは GitHub Advanced Security が必要なため、
#    失敗しても警告に留める（public リポジトリでは無料で有効化できる）
# -----------------------------------------------------------------------------
echo ""
echo "=== 3/4 セキュリティ設定 ==="

gh api "repos/${REPO}/vulnerability-alerts" --method PUT > /dev/null 2>&1 \
  && echo "✅ Vulnerability alerts を有効化しました" \
  || echo "⚠️  Vulnerability alerts の有効化に失敗しました（権限を確認してください）"

gh api "repos/${REPO}/automated-security-fixes" --method PUT > /dev/null 2>&1 \
  && echo "✅ Dependabot security updates を有効化しました" \
  || echo "⚠️  Dependabot security updates の有効化に失敗しました（権限を確認してください）"

if gh api "repos/${REPO}" --method PATCH --input - > /dev/null 2>&1 << 'EOF'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
EOF
then
  echo "✅ Secret scanning + push protection を有効化しました"
else
  echo "⚠️  Secret scanning の有効化に失敗しました"
  echo "    private リポジトリでは GitHub Advanced Security の契約が必要です。"
  echo "    Web UI: https://github.com/${REPO}/settings/security_analysis"
fi

# -----------------------------------------------------------------------------
# 4. Renovate
#    GitHub App のインストールはブラウザでの承認が必須のため自動化できない。
#    導入済みかを間接的に検出し（Dependency Dashboard issue / renovate の PR）、
#    未導入なら案内を出す。
# -----------------------------------------------------------------------------
echo ""
echo "=== 4/4 Renovate ==="

RENOVATE_SIGNS=$(gh api "search/issues?q=repo:${REPO}+author:app/renovate" --jq '.total_count' 2>/dev/null || echo "0")

if [ "${RENOVATE_SIGNS:-0}" -gt 0 ]; then
  echo "✅ Renovate はすでに動作しています（renovate による issue/PR を検出）"
else
  echo "ℹ️  Renovate の動作痕跡が見つかりません。未導入の場合は以下からインストールしてください:"
  echo "    https://github.com/apps/renovate"
  echo "    「Install」→ 対象リポジトリ（${REPO}）を選択して承認"
  echo "    導入後、Renovate が onboarding PR を作成します（設定は renovate.json に定義済み）"
fi

echo ""
echo "🎉 セットアップ完了。設定の確認方法・チーム開発向けの変更は docs/deploy/github-ruleset.md を参照してください。"
