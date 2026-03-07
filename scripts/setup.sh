#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# AX SaaS Template - Integrated Setup Script
# =============================================================================
# This script automates the full initial setup:
#   Phase 0: Prerequisites check
#   Phase 1: Parameter collection
#   Phase 2: Config file generation
#   Phase 3: Bootstrap Terraform (SA, WIF, buckets, GitHub Secrets)
#   Phase 4: Main Terraform (infrastructure provisioning)
#   Phase 5: Completion summary
#
# Usage:
#   gcloud auth login
#   gcloud auth application-default login
#   ./setup.sh --env stg   # Setup STG environment
#   ./setup.sh --env prd   # Setup PRD environment
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BOOTSTRAP_DIR="${PROJECT_ROOT}/infra/terraform/bootstrap"
TERRAFORM_DIR="${PROJECT_ROOT}/infra/terraform"

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

# =============================================================================
# Argument Parsing
# =============================================================================
ENV=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV="$2"
      shift 2
      ;;
    *)
      error "Unknown argument: $1"
      echo "Usage: $0 --env <stg|prd>"
      exit 1
      ;;
  esac
done

if [[ -z "${ENV}" ]]; then
  error "--env is required"
  echo "Usage: $0 --env <stg|prd>"
  exit 1
fi

if [[ "${ENV}" != "stg" && "${ENV}" != "prd" ]]; then
  error "Invalid environment: ${ENV}. Must be 'stg' or 'prd'"
  exit 1
fi

ENV_UPPER=$(echo "${ENV}" | tr '[:lower:]' '[:upper:]')

# =============================================================================
# Phase 0: Prerequisites Check
# =============================================================================
phase0_prerequisites() {
  echo ""
  echo "============================================"
  echo " Phase 0: Prerequisites Check"
  echo "============================================"
  echo ""

  local missing=0

  for cmd in gcloud terraform docker gh; do
    if command -v "$cmd" &>/dev/null; then
      ok "$cmd found: $(command -v "$cmd")"
    else
      error "$cmd is not installed"
      missing=1
    fi
  done

  if [ $missing -ne 0 ]; then
    echo ""
    error "Please install missing tools and re-run this script."
    echo "  gcloud:    https://cloud.google.com/sdk/docs/install"
    echo "  terraform: https://developer.hashicorp.com/terraform/downloads"
    echo "  docker:    https://docs.docker.com/get-docker/"
    echo "  gh:        https://cli.github.com/"
    exit 1
  fi

  # Check gcloud auth
  if ! gcloud auth print-access-token &>/dev/null; then
    error "Not authenticated with gcloud. Run: gcloud auth login"
    exit 1
  fi
  ok "gcloud authenticated"

  # Check ADC
  if ! gcloud auth application-default print-access-token &>/dev/null; then
    error "Application Default Credentials not configured. Run: gcloud auth application-default login"
    exit 1
  fi
  ok "ADC configured"

  # Check gh auth
  if ! gh auth status &>/dev/null; then
    error "Not authenticated with gh. Run: gh auth login"
    exit 1
  fi
  ok "gh authenticated"

  echo ""
  ok "All prerequisites satisfied"
}

# =============================================================================
# Phase 1: Parameter Collection
# =============================================================================
phase1_collect_params() {
  echo ""
  echo "============================================"
  echo " Phase 1: Parameter Collection (${ENV_UPPER})"
  echo "============================================"
  echo ""

  # PROJECT_ID
  if [ -z "${PROJECT_ID:-}" ]; then
    CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")
    if [ -n "${CURRENT_PROJECT}" ]; then
      read -p "GCP Project ID for ${ENV} [${CURRENT_PROJECT}]: " PROJECT_ID
      PROJECT_ID=${PROJECT_ID:-${CURRENT_PROJECT}}
    else
      read -p "GCP Project ID for ${ENV}: " PROJECT_ID
    fi
  fi
  if [ -z "${PROJECT_ID}" ]; then
    error "PROJECT_ID is required"
    exit 1
  fi
  info "PROJECT_ID: ${PROJECT_ID}"

  # REGION
  if [ -z "${REGION:-}" ]; then
    read -p "GCP Region [asia-northeast1]: " REGION
    REGION=${REGION:-asia-northeast1}
  fi
  info "REGION: ${REGION}"

  # PREFIX
  if [ -z "${PREFIX:-}" ]; then
    read -p "Resource name prefix [ax]: " PREFIX
    PREFIX=${PREFIX:-ax}
  fi
  info "PREFIX: ${PREFIX}"

  # GITHUB_REPO (auto-detect from git remote)
  if [ -z "${GITHUB_REPO:-}" ]; then
    DETECTED_REPO=""
    if git remote get-url origin &>/dev/null; then
      REMOTE_URL=$(git remote get-url origin)
      # Parse org/repo from SSH or HTTPS URL
      DETECTED_REPO=$(echo "${REMOTE_URL}" | sed -E 's|.*github\.com[:/]([^/]+/[^/.]+)(\.git)?$|\1|')
    fi
    if [ -n "${DETECTED_REPO}" ]; then
      read -p "GitHub repository [${DETECTED_REPO}]: " GITHUB_REPO
      GITHUB_REPO=${GITHUB_REPO:-${DETECTED_REPO}}
    else
      read -p "GitHub repository (org/repo): " GITHUB_REPO
    fi
  fi
  if [ -z "${GITHUB_REPO}" ]; then
    error "GITHUB_REPO is required"
    exit 1
  fi
  info "GITHUB_REPO: ${GITHUB_REPO}"

  # WIF IDs (derived from prefix by default)
  WIF_POOL_ID=${WIF_POOL_ID:-"github-${PREFIX}"}
  WIF_PROVIDER_ID=${WIF_PROVIDER_ID:-"github-oidc-${PREFIX}"}
  info "WIF_POOL_ID: ${WIF_POOL_ID}"
  info "WIF_PROVIDER_ID: ${WIF_PROVIDER_ID}"

  # DB Password (auto-generate)
  if [ -z "${DB_PASSWORD:-}" ]; then
    DB_PASSWORD="$(openssl rand -base64 18 | head -c 20)@1Aa"
    info "DB_PASSWORD: (auto-generated)"
  fi

  echo ""
  echo "--------------------------------------------"
  echo "  ENVIRONMENT:     ${ENV_UPPER}"
  echo "  PROJECT_ID:      ${PROJECT_ID}"
  echo "  REGION:          ${REGION}"
  echo "  PREFIX:          ${PREFIX}"
  echo "  GITHUB_REPO:     ${GITHUB_REPO}"
  echo "  WIF_POOL_ID:     ${WIF_POOL_ID}"
  echo "  WIF_PROVIDER_ID: ${WIF_PROVIDER_ID}"
  echo "--------------------------------------------"
  echo ""
  read -p "Proceed with these settings? [Y/n]: " CONFIRM
  CONFIRM=${CONFIRM:-Y}
  if [[ ! "${CONFIRM}" =~ ^[Yy] ]]; then
    echo "Aborted."
    exit 0
  fi
}

# =============================================================================
# Phase 2: Config File Generation
# =============================================================================
phase2_generate_configs() {
  echo ""
  echo "============================================"
  echo " Phase 2: Config File Generation (${ENV_UPPER})"
  echo "============================================"
  echo ""

  # Bootstrap terraform.tfvars
  local BOOTSTRAP_TFVARS="${BOOTSTRAP_DIR}/terraform.tfvars"
  info "Generating ${BOOTSTRAP_TFVARS}..."
  cat > "${BOOTSTRAP_TFVARS}" <<EOF
project_id      = "${PROJECT_ID}"
region          = "${REGION}"
prefix          = "${PREFIX}"
github_repo     = "${GITHUB_REPO}"
wif_pool_id     = "${WIF_POOL_ID}"
wif_provider_id = "${WIF_PROVIDER_ID}"
environment     = "${ENV}"
EOF
  ok "Bootstrap terraform.tfvars created"

  # Determine app_env from environment
  local APP_ENV
  if [ "${ENV}" = "stg" ]; then
    APP_ENV="staging"
  else
    APP_ENV="production"
  fi

  # Main terraform.tfvars
  local MAIN_TFVARS="${TERRAFORM_DIR}/terraform.tfvars"
  info "Generating ${MAIN_TFVARS}..."
  cat > "${MAIN_TFVARS}" <<EOF
project_id = "${PROJECT_ID}"
region     = "${REGION}"
location   = "${REGION}"
prefix     = "${PREFIX}"

# Cloud SQL
db_user          = "appuser"
db_password      = "${DB_PASSWORD}"
db_database_name = "app"

# Environment variables (optional overrides)
server_env = {}
client_env = {}

# Application environment
app_env = "${APP_ENV}"
EOF
  ok "Main terraform.tfvars created"
}

# =============================================================================
# Phase 3: Bootstrap Terraform
# =============================================================================
phase3_bootstrap() {
  echo ""
  echo "============================================"
  echo " Phase 3: Bootstrap Terraform (${ENV_UPPER})"
  echo "============================================"
  echo "  (SA, WIF, GCS bucket, GitHub Variables)"
  echo ""

  cd "${BOOTSTRAP_DIR}"

  info "terraform init (state: terraform-${ENV}.tfstate)..."
  terraform init -reconfigure -backend-config="path=terraform-${ENV}.tfstate"

  info "terraform plan..."
  terraform plan

  info "terraform apply..."
  terraform apply -auto-approve

  # Capture outputs for later use
  DEPLOYER_SA=$(terraform output -raw deployer_sa_email)
  WIF_PROVIDER_FULL=$(terraform output -raw wif_provider)

  ok "Bootstrap complete"
  info "  Deployer SA:   ${DEPLOYER_SA}"
  info "  WIF Provider:  ${WIF_PROVIDER_FULL}"

  cd "${SCRIPT_DIR}"
}

# =============================================================================
# Phase 4: Main Terraform
# =============================================================================
phase4_main_terraform() {
  echo ""
  echo "============================================"
  echo " Phase 4: Main Terraform (${ENV_UPPER})"
  echo "============================================"
  echo ""

  # Set the deployer SA in main tfvars
  local MAIN_TFVARS="${TERRAFORM_DIR}/terraform.tfvars"
  if ! grep -q 'deployer_service_account' "${MAIN_TFVARS}"; then
    echo "" >> "${MAIN_TFVARS}"
    echo "deployer_service_account = \"${DEPLOYER_SA}\"" >> "${MAIN_TFVARS}"
    ok "Added deployer_service_account to terraform.tfvars"
  fi

  # Use the staged apply script with GCS backend
  local TFSTATE_BUCKET="tfstate-${PREFIX}-${ENV}"

  cd "${TERRAFORM_DIR}"

  info "Running staged infrastructure apply..."
  TF_BACKEND_BUCKET="${TFSTATE_BUCKET}" \
  TF_BACKEND_PREFIX="${ENV}/terraform.tfstate" \
  PROJECT_ID="${PROJECT_ID}" \
  REGION="${REGION}" \
  PREFIX="${PREFIX}" \
    bash scripts/infra-apply-staged.sh

  ok "Main infrastructure provisioned"

  cd "${SCRIPT_DIR}"
}

# =============================================================================
# Phase 5: Completion Summary
# =============================================================================
phase5_summary() {
  echo ""
  echo "============================================"
  echo " Setup Complete! (${ENV_UPPER})"
  echo "============================================"
  echo ""
  echo "  Environment: ${ENV_UPPER}"
  echo "  Project:     ${PROJECT_ID}"
  echo "  Region:      ${REGION}"
  echo "  Prefix:      ${PREFIX}"
  echo "  Repository:  ${GITHUB_REPO}"
  echo ""
  echo "  Next steps:"
  echo "    0. Set DB password for CI/CD (required before first deploy):"
  echo "       gh secret set ${ENV_UPPER}_DB_PASSWORD --repo ${GITHUB_REPO} --body \"<db_password from infra/terraform/terraform.tfvars>\""
  echo "    1. Verify deployment: cd infra/terraform && bash scripts/verify.sh"
  echo "    2. Access your app at the Load Balancer IP:"
  echo "       cd infra/terraform && terraform output load_balancer_ip"
  echo "    3. (Optional) Set up custom domain and SSL:"
  echo "       See infra/terraform/docs/domain-setup.md"
  echo ""

  if [ "${ENV}" = "stg" ]; then
    echo "  To set up the PRD environment:"
    echo "    ./scripts/setup.sh --env prd"
    echo ""
  fi

  echo "  To deploy via CI/CD:"
  echo "    - Push to main branch to trigger deploy-stg"
  echo "    - Create a tag (v*) to trigger deploy-prod"
  echo ""
  ok "Done!"
}

# =============================================================================
# Main
# =============================================================================
main() {
  echo "============================================"
  echo " AX SaaS Template - Setup (${ENV_UPPER})"
  echo "============================================"

  phase0_prerequisites
  phase1_collect_params
  phase2_generate_configs
  phase3_bootstrap
  phase4_main_terraform
  phase5_summary
}

main
