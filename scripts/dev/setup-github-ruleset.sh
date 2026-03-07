#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# GitHub Ruleset & Repository Settings Setup
# =============================================================================
# main ブランチの保護ルールとリポジトリ設定を自動化します。
#
# 機能:
#   1. Prerequisites check (gh CLI 認証、リポジトリ検出)
#   2. Ruleset 作成/更新（冪等）
#   3. Repository settings (auto-delete branches, squash merge, auto merge)
#   4. 設定内容の確認表示
#
# 使い方:
#   bash scripts/dev/setup-github-ruleset.sh
#
# DRY_RUN モード:
#   DRY_RUN=1 bash scripts/dev/setup-github-ruleset.sh
#
# 参照: docs/deploy/github-ruleset.md
# =============================================================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

DRY_RUN="${DRY_RUN:-0}"
RULESET_NAME="main-branch-protection"

# =============================================================================
# Phase 1: Prerequisites Check
# =============================================================================
check_prerequisites() {
  info "Checking prerequisites..."

  if ! command -v gh &>/dev/null; then
    error "gh CLI is not installed. Install: https://cli.github.com/"
    exit 1
  fi

  if ! gh auth status &>/dev/null; then
    error "Not authenticated with gh. Run: gh auth login"
    exit 1
  fi
  ok "gh authenticated"

  # Detect repository
  REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null || echo "")
  if [[ -z "$REPO" ]]; then
    error "Could not detect repository. Run from a git repo with a GitHub remote."
    exit 1
  fi
  ok "Repository: ${REPO}"
}

# =============================================================================
# Phase 2: Ruleset Creation/Update (Idempotent)
# =============================================================================
setup_ruleset() {
  info "Setting up ruleset: ${RULESET_NAME}..."

  local PAYLOAD
  PAYLOAD=$(cat <<'RULESET_JSON'
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
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "CI Pipeline" }
        ]
      }
    }
  ],
  "bypass_actors": []
}
RULESET_JSON
)

  if [[ "$DRY_RUN" == "1" ]]; then
    warn "DRY_RUN mode - payload only:"
    echo "$PAYLOAD" | python3 -m json.tool 2>/dev/null || echo "$PAYLOAD"
    return
  fi

  # Check if ruleset already exists
  local RULESET_ID
  RULESET_ID=$(gh api "repos/${REPO}/rulesets" --jq ".[] | select(.name == \"${RULESET_NAME}\") | .id" 2>/dev/null || echo "")

  if [[ -n "$RULESET_ID" ]]; then
    info "Updating existing ruleset (ID: ${RULESET_ID})..."
    echo "$PAYLOAD" | gh api "repos/${REPO}/rulesets/${RULESET_ID}" --method PUT --input -
    ok "Ruleset updated"
  else
    info "Creating new ruleset..."
    echo "$PAYLOAD" | gh api "repos/${REPO}/rulesets" --method POST --input -
    ok "Ruleset created"
  fi
}

# =============================================================================
# Phase 3: Repository Settings
# =============================================================================
setup_repo_settings() {
  info "Configuring repository settings..."

  local SETTINGS_PAYLOAD
  SETTINGS_PAYLOAD=$(cat <<'SETTINGS_JSON'
{
  "delete_branch_on_merge": true,
  "allow_squash_merge": true,
  "squash_merge_commit_title": "PR_TITLE",
  "squash_merge_commit_message": "PR_BODY",
  "allow_merge_commit": true,
  "allow_rebase_merge": true,
  "allow_auto_merge": true
}
SETTINGS_JSON
)

  if [[ "$DRY_RUN" == "1" ]]; then
    warn "DRY_RUN mode - settings payload:"
    echo "$SETTINGS_PAYLOAD" | python3 -m json.tool 2>/dev/null || echo "$SETTINGS_PAYLOAD"
    return
  fi

  echo "$SETTINGS_PAYLOAD" | gh api "repos/${REPO}" --method PATCH --input -  >/dev/null
  ok "Repository settings configured"
}

# =============================================================================
# Phase 4: Verify Settings
# =============================================================================
verify_settings() {
  info "Verifying settings..."
  echo ""

  if [[ "$DRY_RUN" == "1" ]]; then
    warn "DRY_RUN mode - skipping verification"
    return
  fi

  echo "  Ruleset:"
  local RULESET_ID
  RULESET_ID=$(gh api "repos/${REPO}/rulesets" --jq ".[] | select(.name == \"${RULESET_NAME}\") | .id" 2>/dev/null || echo "")
  if [[ -n "$RULESET_ID" ]]; then
    gh api "repos/${REPO}/rulesets/${RULESET_ID}" --jq '.rules[] | "    - \(.type)\(if .parameters then " (\(.parameters | keys | join(", ")))" else "" end)"' 2>/dev/null || true
  fi

  echo ""
  echo "  Repository settings:"
  gh api "repos/${REPO}" --jq '"    delete_branch_on_merge: \(.delete_branch_on_merge)\n    allow_squash_merge: \(.allow_squash_merge)\n    allow_auto_merge: \(.allow_auto_merge)"' 2>/dev/null || true

  echo ""
  ok "Verification complete"
}

# =============================================================================
# Phase 5: Manual Setup Reminder
# =============================================================================
show_manual_steps() {
  echo ""
  echo "============================================"
  echo " Manual Setup Required"
  echo "============================================"
  echo ""
  echo "  The following settings must be configured manually via GitHub UI:"
  echo ""
  echo "  1. Secret scanning & push protection:"
  echo "     https://github.com/${REPO}/settings/security_analysis"
  echo "     - Enable: Secret scanning"
  echo "     - Enable: Push protection"
  echo ""
  echo "  2. Dependabot security updates:"
  echo "     https://github.com/${REPO}/settings/security_analysis"
  echo "     - Enable: Dependabot alerts"
  echo "     - Enable: Dependabot security updates"
  echo ""
}

# =============================================================================
# Main
# =============================================================================
main() {
  echo "============================================"
  echo " GitHub Ruleset & Repository Settings Setup"
  echo "============================================"
  echo ""

  if [[ "$DRY_RUN" == "1" ]]; then
    warn "Running in DRY_RUN mode (no changes will be made)"
    echo ""
  fi

  check_prerequisites
  setup_ruleset
  setup_repo_settings
  verify_settings
  show_manual_steps

  ok "Done!"
}

main "$@"
