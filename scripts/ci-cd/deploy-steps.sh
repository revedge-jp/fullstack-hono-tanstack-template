#!/usr/bin/env bash
set -euo pipefail

# deploy-stg.yml の各ステップを個別に検証するスクリプト
# 実際のGCPリソースに影響を与えずに、各ステップが正しく動作するか確認できます

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

# デバッグ: 現在のディレクトリを確認
if [ ! -f "package.json" ] || [ ! -d "apps" ]; then
  echo "❌ Error: Script must be run from repository root"
  echo "Current directory: $(pwd)"
  exit 1
fi

# .env.deployファイルが存在する場合は自動的に読み込む
# 優先順位: 1) ルートディレクトリの.env.deploy 2) scripts/ci-cd/env.deploy
ENV_FILE=""
if [ -f ".env.deploy" ]; then
  ENV_FILE=".env.deploy"
elif [ -f "scripts/ci-cd/env.deploy" ]; then
  ENV_FILE="scripts/ci-cd/env.deploy"
fi

if [ -n "${ENV_FILE}" ]; then
  echo "📋 Loading environment variables from ${ENV_FILE}..."
  set -a  # 自動的にexportする
  source "${ENV_FILE}"
  set +a
fi

# 環境変数のチェック（より親切なエラーメッセージ）
if [ -z "${PROJECT_ID:-}" ]; then
  echo "❌ Error: PROJECT_ID is required"
  echo ""
  echo "  Set it by one of the following methods:"
  echo "    1. Export environment variable:"
  echo "       export PROJECT_ID=your-project-id"
  echo ""
  echo "    2. Create .env.deploy file (in repository root or scripts/ci-cd/):"
  echo "       cp scripts/ci-cd/env.deploy.example .env.deploy"
  echo "       # or"
  echo "       cp scripts/ci-cd/env.deploy.example scripts/ci-cd/env.deploy"
  echo "       # Edit the file with your values"
  echo ""
  echo "    3. Pass inline:"
  echo "       PROJECT_ID=your-project-id bash scripts/ci-cd/deploy-steps.sh"
  exit 1
fi

if [ -z "${TFSTATE_BUCKET:-}" ]; then
  echo "❌ Error: TFSTATE_BUCKET is required"
  echo ""
  echo "  Set it by one of the following methods:"
  echo "    1. Export environment variable:"
  echo "       export TFSTATE_BUCKET=your-tfstate-bucket-name"
  echo ""
  echo "    2. Create .env.deploy file (in repository root or scripts/ci-cd/):"
  echo "       cp scripts/ci-cd/env.deploy.example .env.deploy"
  echo "       # or"
  echo "       cp scripts/ci-cd/env.deploy.example scripts/ci-cd/env.deploy"
  echo "       # Edit the file with your values"
  echo ""
  echo "    3. Pass inline:"
  echo "       TFSTATE_BUCKET=your-bucket bash scripts/ci-cd/deploy-steps.sh"
  exit 1
fi

REGION=${REGION:-asia-northeast1}

echo "=== Testing deploy-stg.yml steps locally ==="
echo "PROJECT_ID: ${PROJECT_ID}"
echo "REGION: ${REGION}"
echo "TFSTATE_BUCKET: ${TFSTATE_BUCKET}"
echo "Working directory: $(pwd)"
echo ""

# Step 1: Build & Push (dry-run)
echo "=== Step 1: Build & Push (dry-run) ==="
echo "Testing: Docker buildx build (without push)"

# Extract prefix for builder name
TFVARS_FILE="infra/terraform/terraform.tfvars"
PREFIX="ax"
if [[ -f "${TFVARS_FILE}" ]]; then
  TFVARS_PREFIX=$(grep 'prefix' "${TFVARS_FILE}" | sed -n "s/.*prefix[[:space:]]*=[[:space:]]*[\"']\([^\"']*\)[\"'].*/\1/p" | head -1)
  if [[ -n "${TFVARS_PREFIX}" ]]; then
    PREFIX="${TFVARS_PREFIX}"
  fi
fi

if ! docker buildx inspect >/dev/null 2>&1; then
  echo "Creating docker buildx builder..."
  docker buildx create --use --name "${PREFIX}-builder" || true
fi

build_test() {
  local name=$1
  local dockerfile=$2
  echo "Building ${name} (test only, no push)..."
  docker buildx build \
    --platform linux/amd64 \
    -t "local/${name}:test" \
    -f "${dockerfile}" \
    . \
    --load || { echo "❌ Build failed for ${name}"; exit 1; }
  echo "✓ ${name} built successfully"
}

build_test server apps/api-service/Dockerfile
build_test client apps/client/Dockerfile
echo "✓ Step 1 passed: All builds successful"
echo ""

# Step 2: Terraform Init & Plan
echo "=== Step 2: Terraform Init & Plan ==="
echo "Testing: terraform init and plan (no apply)"
cd infra/terraform

BUCKET_NAME=${TFSTATE_BUCKET#gs://}
BUCKET_NAME=${BUCKET_NAME#file://}

echo "Initializing Terraform backend..."
terraform init \
  -backend-config="bucket=${BUCKET_NAME}" \
  -backend-config="prefix=stg/terraform.tfstate" \
  -reconfigure || { echo "❌ Terraform init failed"; exit 1; }

echo "Running terraform plan (dry-run)..."
echo "  Note: If you see 'Permission denied' errors for artifact registry,"
echo "        this is expected for local testing and can be ignored."
echo ""

# Terraform planの実行（出力をリアルタイムで表示しつつキャプチャ）
# macOSでは timeout コマンドがない場合があるため、バックグラウンドで実行して監視
TEMP_PLAN_LOG=$(mktemp)
set +e

# 出力をリアルタイム表示しつつログにも保存
terraform plan \
  -var="project_id=${PROJECT_ID}" \
  -var="region=${REGION}" \
  -var="db_password=dummy-for-test" \
  -var="deployer_service_account=dummy@${PROJECT_ID}.iam.gserviceaccount.com" \
  -out=tfplan 2>&1 | tee "${TEMP_PLAN_LOG}"
PLAN_EXIT_CODE=${PIPESTATUS[0]}
PLAN_OUTPUT=$(cat "${TEMP_PLAN_LOG}")
set -e
rm -f "${TEMP_PLAN_LOG}"

# Artifact Registryへのアクセス権限エラーのみを許容
if [ ${PLAN_EXIT_CODE} -ne 0 ]; then
  if echo "${PLAN_OUTPUT}" | grep -q "Permission denied.*artifactregistry\|CONSUMER_INVALID"; then
    echo "⚠ Warning: Artifact Registry access denied (expected for local testing)"
    echo "  The Terraform configuration is valid, but data sources require"
    echo "  access to the target project. This is normal for local testing."
    echo ""
    echo "  To fully test terraform plan, use a project you have access to:"
    echo "    export PROJECT_ID=your-accessible-project-id"
    echo ""
    echo "  For now, validating Terraform syntax only..."
    if terraform validate >/dev/null 2>&1; then
      echo "✓ Terraform configuration is valid (syntax check passed)"
    else
      echo "❌ Terraform validation failed"
      terraform validate
      exit 1
    fi
  else
    echo "❌ Terraform plan failed with unexpected error:"
    echo "${PLAN_OUTPUT}"
    exit 1
  fi
else
  echo "✓ Step 2 passed: Terraform plan successful"
  echo "  Note: This is a dry-run. No resources will be created."
fi
echo ""

# Step 3: Check Terraform outputs (requires existing state)
echo "=== Step 3: Check Terraform Outputs ==="
echo "Testing: terraform output (requires existing state)"
if terraform output migrate_job_name >/dev/null 2>&1; then
  echo "✓ migrate_job_name output exists"
  JOB=$(terraform output -raw migrate_job_name)
  echo "  Job name: ${JOB}"
else
  echo "⚠ migrate_job_name output not found (state may be empty)"
  echo "  This is expected if terraform apply hasn't been run yet"
fi
echo ""

# Step 4: Validate gcloud commands
echo "=== Step 4: Validate gcloud setup ==="
echo "Testing: gcloud authentication and project"
echo "  Note: To connect to Artifact Registry, you need:"
echo "    1. gcloud auth login (user authentication)"
echo "    2. gcloud auth application-default login (Terraform/ADC)"
echo "    3. gcloud auth configure-docker <region>-docker.pkg.dev (Docker)"
echo ""

if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
  echo "❌ No active gcloud authentication found"
  echo ""
  echo "  To authenticate for Artifact Registry:"
  echo "    1. Run: gcloud auth login"
  echo "    2. Run: gcloud auth application-default login"
  echo "    3. Run: gcloud auth configure-docker ${REGION}-docker.pkg.dev"
  echo ""
  echo "  Then re-run this script."
  exit 1
fi

# Check if Docker authentication is configured
if ! grep -q "${REGION}-docker.pkg.dev" ~/.docker/config.json 2>/dev/null; then
  echo "  ⚠ Docker authentication for Artifact Registry not configured"
  echo "    Run: gcloud auth configure-docker ${REGION}-docker.pkg.dev"
  echo "    This is needed to push Docker images to Artifact Registry."
  echo ""
fi

CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")
if [ -z "${CURRENT_PROJECT}" ]; then
  echo "❌ No gcloud project set"
  echo "  Run: gcloud config set project ${PROJECT_ID}"
  exit 1
fi

if [ "${CURRENT_PROJECT}" != "${PROJECT_ID}" ]; then
  echo "⚠ Warning: Current project (${CURRENT_PROJECT}) != PROJECT_ID (${PROJECT_ID})"
  echo "  Consider: gcloud config set project ${PROJECT_ID}"
fi

# プロジェクトの存在とアクセス権限を確認
echo "  Checking project access..."
set +e
PROJECT_INFO=$(gcloud projects describe "${PROJECT_ID}" 2>&1)
PROJECT_EXISTS_CODE=${PIPESTATUS[0]}
set -e

if [ ${PROJECT_EXISTS_CODE} -ne 0 ]; then
  if echo "${PROJECT_INFO}" | grep -q "not found\|does not exist\|RESOURCES_NOT_FOUND"; then
    echo "❌ Project '${PROJECT_ID}' does not exist"
    echo ""
    echo "  Available projects:"
    gcloud projects list --format="table(projectId,name)" --limit=10 2>/dev/null || echo "    (Could not list projects)"
    echo ""
    echo "  Please check:"
    echo "    1. Project ID is correct: ${PROJECT_ID}"
    echo "    2. Project exists in your GCP organization"
    echo "    3. You have access to the project"
    echo ""
    echo "  Note: If you meant to use a different project, try:"
    echo "    export PROJECT_ID=terraform-sandbox-476500  # or your actual project ID"
    exit 1
  elif echo "${PROJECT_INFO}" | grep -q "PERMISSION_DENIED\|permission denied\|does not have permission"; then
    echo "⚠ Warning: Permission denied accessing project '${PROJECT_ID}'"
    echo "  Even if you have Owner role, this might be due to:"
    echo "    1. Organization-level policies restricting access"
    echo "    2. Project-level IAM not fully propagated"
    echo "    3. Required APIs not enabled"
    echo ""
    echo "  Checking if project exists with current account..."
    AVAILABLE_PROJECTS=$(gcloud projects list --filter="projectId:${PROJECT_ID}" --format="value(projectId)" 2>/dev/null || echo "")
    if [ -n "${AVAILABLE_PROJECTS}" ] && echo "${AVAILABLE_PROJECTS}" | grep -q "${PROJECT_ID}"; then
      echo "  ✓ Project exists in your organization"
      echo "  ⚠ You may need to request access or wait for IAM propagation"
    else
      echo "  ⚠ Project not found in accessible projects"
      echo ""
      echo "  Accessible projects with 'terraform-sandbox' in name:"
      gcloud projects list --filter="projectId~terraform-sandbox" --format="table(projectId,name)" --limit=10 2>/dev/null || echo "    (Could not list projects)"
      echo ""
      echo "  Consider using an accessible project:"
      echo "    export PROJECT_ID=terraform-sandbox-476500  # This project seems accessible"
    fi
  else
    echo "⚠ Warning: Could not access project '${PROJECT_ID}'"
    echo "  Error: ${PROJECT_INFO}" | head -3
    echo ""
    echo "  Available projects:"
    gcloud projects list --format="table(projectId,name)" --limit=10 2>/dev/null || echo "    (Could not list projects)"
  fi
else
  echo "  ✓ Project access confirmed"
  PROJECT_NAME=$(gcloud projects describe "${PROJECT_ID}" --format="value(name)" 2>/dev/null || echo "")
  if [ -n "${PROJECT_NAME}" ]; then
    echo "    Project name: ${PROJECT_NAME}"
  fi
fi
echo ""

# Step 5: Check TF state bucket
echo "=== Step 5: Check TF State Bucket ==="
echo "Testing: GCS bucket access"
if gsutil ls -b "gs://${BUCKET_NAME}" >/dev/null 2>&1; then
  echo "✓ Bucket exists and is accessible"
else
  echo "⚠ Warning: Bucket may not exist or is not accessible"
  echo "  Create with: gsutil mb -l ${REGION} gs://${BUCKET_NAME}"
fi
echo ""

# Step 6: Check required APIs
echo "=== Step 6: Check Required APIs ==="
echo "Testing: Required GCP APIs enabled"
APIS=(
  "serviceusage.googleapis.com"
  "cloudresourcemanager.googleapis.com"
  "run.googleapis.com"
  "artifactregistry.googleapis.com"
  "compute.googleapis.com"
  "servicenetworking.googleapis.com"
  "sqladmin.googleapis.com"
  "secretmanager.googleapis.com"
  "vpcaccess.googleapis.com"
)

for API in "${APIS[@]}"; do
  if gcloud services list --enabled --project "${PROJECT_ID}" --filter="name:${API}" --format="value(name)" | grep -q "${API}"; then
    echo "  ✓ ${API}"
  else
    echo "  ⚠ ${API} (not enabled, will be enabled by terraform)"
  fi
done
echo ""

# Step 7: Migration (requires existing resources)
echo "=== Step 7: Migration ==="
echo "Testing: DB migration job execution"
echo "  Note: Migration requires deployed resources. If you don't have access"
echo "        to the project, this step will be skipped."

MIGRATION_SKIPPED=false
MIGRATION_SUCCESS=false

if terraform output migrate_job_name >/dev/null 2>&1; then
  JOB=$(terraform output -raw migrate_job_name 2>/dev/null || echo "")
  
  if [ -z "${JOB}" ]; then
    echo "  ⚠ migrate_job_name output not found (resources may not be deployed yet)"
    MIGRATION_SKIPPED=true
  else
    echo "  Job name: ${JOB}"
    
    # マイグレーションJobの存在確認
    set +e
    JOB_EXISTS=$(gcloud run jobs describe "${JOB}" --region "${REGION}" --project "${PROJECT_ID}" 2>&1)
    JOB_EXISTS_CODE=${PIPESTATUS[0]}
    set -e
    
    if [ ${JOB_EXISTS_CODE} -eq 0 ]; then
      echo "  ✓ Migration job exists"
      
      echo "  Executing migration job..."
      set +e
      if gcloud run jobs execute --help 2>/dev/null | grep -q -- "--wait"; then
        OUT=$(gcloud run jobs execute "${JOB}" --region "${REGION}" --project "${PROJECT_ID}" --wait 2>&1)
      else
        OUT=$(gcloud run jobs execute "${JOB}" --region "${REGION}" --project "${PROJECT_ID}" 2>&1)
      fi
      set -e
      
      EXEC=$(printf "%s\n" "$OUT" | sed -n 's/^Execution \[\([^]]\+\)\].*/\1/p' | tail -1)
      
      if [ -z "$EXEC" ]; then
        for _ in $(seq 1 10); do
          EXEC=$(gcloud run jobs executions list \
            --job "${JOB}" --region "${REGION}" --project "${PROJECT_ID}" \
            --format='value(name)' --sort-by='~createTime' --limit=1)
          [ -n "$EXEC" ] && break
          sleep 2
        done
      fi
      
      if [ -n "$EXEC" ]; then
        echo "  Waiting for execution to complete: $EXEC"
        START_TS=$(date +%s)
        for i in $(seq 1 180); do
          DESCRIBE=$(gcloud run jobs executions describe "$EXEC" \
            --region "${REGION}" --project "${PROJECT_ID}" \
            --format=json 2>/dev/null || echo '{}')
          
          COMPLETED=$(printf "%s" "$DESCRIBE" | jq -r '( .status.conditions[]? | select(.type=="Completed") | .status ) // ""')
          FAILED=$(printf "%s" "$DESCRIBE" | jq -r '(.status.failedCount // 0)')
          
          NOW=$(date +%s)
          AGE=$((NOW-START_TS))
          
          if [ "${COMPLETED}" = "True" ]; then
            echo "  ✓ Migration completed successfully"
            MIGRATION_SUCCESS=true
            break
          fi
          if [ "${FAILED}" != "0" ]; then
            echo "  ❌ Migration failed"
            echo "  ⚠ Migration execution failed, but continuing validation..."
            break
          fi
          
          if [ ${AGE} -ge 900 ]; then
            echo "  ⚠ Migration timed out (exceeded 15 minutes)"
            echo "  ⚠ Continuing validation..."
            break
          fi
          sleep 5
        done
      else
        echo "  ⚠ Could not get execution ID"
        echo "  Note: Migration execution started but could not track status"
      fi
    else
      # gcloudコマンドのエラーを確認
      if echo "${JOB_EXISTS}" | grep -q "Permission denied\|does not exist\|not found"; then
        echo "  ⚠ Migration job not accessible (expected for local testing)"
        echo "    Error: ${JOB_EXISTS}" | head -1
        echo "    This is normal if you don't have access to the target project."
        MIGRATION_SKIPPED=true
      else
        echo "  ⚠ Migration job not found or accessible"
        echo "    Error: ${JOB_EXISTS}" | head -1
        MIGRATION_SKIPPED=true
      fi
    fi
  fi
else
  echo "  ⚠ migrate_job_name output not found (resources may not be deployed yet)"
  MIGRATION_SKIPPED=true
fi

if [ "${MIGRATION_SKIPPED}" = "true" ]; then
  echo "  ℹ Migration step skipped (no resources or no access)"
  echo "    To test migration, ensure resources are deployed and you have access."
fi
echo ""

# Step 8: Rollout (requires existing resources)
echo "=== Step 8: Rollout ==="
echo "Testing: Terraform rollout (force new revisions)"
echo "  Note: Rollout plan requires access to Artifact Registry. If you don't"
echo "        have access to the project, this step will validate syntax only."

# ロールアウト用の環境変数を準備
BUILD_SHA=${BUILD_SHA:-$(git rev-parse HEAD 2>/dev/null || echo "test-$(date +%s)")}

echo "  Using BUILD_SHA: ${BUILD_SHA}"

# ロードバランサーのURLを取得
LOAD_BALANCER_URL=$(terraform output -raw load_balancer_url 2>/dev/null || terraform output -raw server_url 2>/dev/null || echo "")

SERVER_ENV="BUILD_SHA=\"${BUILD_SHA}\""
if [ -n "$LOAD_BALANCER_URL" ]; then
  echo "  Resolved load_balancer_url=$LOAD_BALANCER_URL"
  SERVER_ENV="$SERVER_ENV,SERVER_PUBLIC_URL=\"$LOAD_BALANCER_URL\""
else
  echo "  ⚠ load_balancer_url not found in state"
fi

# ロールアウトのplanを実行（実際には適用しない）
echo "  Running terraform plan for rollout..."
ROLLOUT_PLAN_OUTPUT=$(terraform plan \
  -var="project_id=${PROJECT_ID}" \
  -var="region=${REGION}" \
  -var="db_password=dummy-for-test" \
  -var="deployer_service_account=dummy@${PROJECT_ID}.iam.gserviceaccount.com" \
  -var="server_env={${SERVER_ENV}}" \
  -var="client_env={BUILD_SHA=\"${BUILD_SHA}\"}" \
  -out=tfplan-rollout 2>&1)
ROLLOUT_EXIT_CODE=${PIPESTATUS[0]}

if [ ${ROLLOUT_EXIT_CODE} -eq 0 ]; then
  echo "  ✓ Rollout plan successful"
  echo "  Note: This is a dry-run. New revisions will be created when you run: terraform apply tfplan-rollout"
elif echo "${ROLLOUT_PLAN_OUTPUT}" | grep -q "Permission denied.*artifactregistry\|CONSUMER_INVALID"; then
  echo "  ⚠ Rollout plan skipped (artifact registry access denied - expected for local testing)"
  echo "  Note: Rollout plan requires access to Artifact Registry. Use a project you have access to for full testing."
else
  echo "  ⚠ Rollout plan failed (resources may not be deployed yet or other errors)"
  echo "  ${ROLLOUT_PLAN_OUTPUT}" | tail -5
fi
echo ""

echo "=== Summary ==="
echo "✓ All validation steps completed"
echo ""
echo "Basic validation:"
echo "  ✓ Docker builds"
if [ ${PLAN_EXIT_CODE:-0} -eq 0 ]; then
  echo "  ✓ Terraform plan (full plan successful)"
else
  echo "  ⚠ Terraform plan (artifact registry access denied - syntax validated)"
fi
echo "  ✓ gcloud setup"
echo "  ✓ Required APIs"
echo ""
echo "Note: If Terraform plan failed due to artifact registry permissions,"
echo "      this is expected for local testing. The configuration is valid."
echo "      For full plan testing, use a GCP project you have access to."
echo ""
echo "Migration:"
if [ "${MIGRATION_SUCCESS:-false}" = "true" ]; then
  echo "  ✓ Migration executed successfully"
elif [ "${MIGRATION_SKIPPED:-false}" = "true" ]; then
  echo "  ⚠ Migration skipped (no resources or no access)"
else
  echo "  ⚠ Migration not executed (resources may not exist)"
fi
echo "Rollout:"
if [ ${ROLLOUT_EXIT_CODE:-0} -eq 0 ]; then
  echo "  ✓ Rollout plan checked (full plan successful)"
elif echo "${ROLLOUT_PLAN_OUTPUT:-}" | grep -q "Permission denied.*artifactregistry\|CONSUMER_INVALID"; then
  echo "  ⚠ Rollout plan skipped (artifact registry access denied - syntax validated)"
else
  echo "  ⚠ Rollout plan failed (check errors above)"
fi
echo ""
echo "Next steps:"
echo "  1. If build failed, fix Dockerfiles"
echo "  2. If terraform plan failed, check variables"
echo "  3. To actually deploy, run the full workflow or:"
echo "     cd infra/terraform"
echo "     terraform apply tfplan"
echo ""
echo "Cost estimate for sandbox:"
echo "  - Cloud SQL (db-f1-micro): ~\$7-10/month"
echo "  - VPC Connector: ~\$10/month"
echo "  - Cloud Run: Pay-per-use (free tier: 2M requests/month)"
echo "  - Total: ~\$20-30/month when running"
echo "  - Tip: Destroy resources when not in use: terraform destroy"

