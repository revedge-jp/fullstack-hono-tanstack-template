#!/usr/bin/env bash
set -euo pipefail

# Idempotent setup for: CI deployer SA, roles, WIF pool/provider, bindings, bucket IAM
#
# ⚠️ IMPORTANT: POOL_ID and PROVIDER_ID must be unique per repository.
#    Sharing the same pool/provider across multiple repositories will cause
#    the attribute-condition to be overwritten, breaking CI for other repos.
#
# Usage:
#   PROJECT_ID=xxxx ORG_REPO="<org>/<repo>" \
#     POOL_ID=github-myproject PROVIDER_ID=github-oidc-myproject \
#     ./bootstrap-wif.sh
#
# Required parameters:
#   PROJECT_ID, ORG_REPO, POOL_ID, PROVIDER_ID
#
# Optional overrides:
#   SA_ID=ci-deployer
#   BUCKET_STG=tfstate-<app>-stg BUCKET_PRD=tfstate-<app>-prd REGION=asia-northeast1
#   SKIP_BUCKET_IAM=1  # Skip bucket IAM permissions (for initial setup before buckets exist)
#
# Naming convention (recommended):
#   POOL_ID=github-{project-name}
#   PROVIDER_ID=github-oidc-{project-name}

PROJECT_ID=${PROJECT_ID:?"PROJECT_ID is required"}
ORG_REPO=${ORG_REPO:?"ORG_REPO is required (e.g. my-org/my-repo)"}
SA_ID=${SA_ID:-ci-deployer}
POOL_ID=${POOL_ID:?"POOL_ID is required (e.g., github-myproject). Must be unique per repository."}
PROVIDER_ID=${PROVIDER_ID:?"PROVIDER_ID is required (e.g., github-oidc-myproject). Must be unique per repository."}

SA_EMAIL="${SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')

echo "[1/6] ensure service account: ${SA_EMAIL}"
gcloud iam service-accounts describe "${SA_EMAIL}" --project "${PROJECT_ID}" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "${SA_ID}" --project "${PROJECT_ID}" --display-name "CI Deployer"

echo "[2/6] grant minimal roles to ${SA_EMAIL} (idempotent)"
ROLES=(
  roles/run.admin
  roles/artifactregistry.admin
  roles/secretmanager.admin
  roles/cloudsql.admin
  roles/serviceusage.serviceUsageAdmin
  roles/resourcemanager.projectIamAdmin
  roles/compute.networkAdmin
  roles/compute.loadBalancerAdmin
  roles/vpcaccess.admin
  roles/iam.serviceAccountAdmin
  roles/servicenetworking.networksAdmin
  # roles/iam.securityAdmin は削除: serviceAccountAdmin + projectIamAdmin でカバー
  roles/monitoring.editor                 # uptime check 管理に必要（alertPolicyEditor のスーパーセット）
  roles/logging.configWriter              # ログベースアラートに必要
  roles/compute.securityAdmin             # Cloud Armorに必要
)
for R in "${ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" --role="${R}" --condition=None --quiet >/dev/null
done

echo "[3/6] ensure WIF pool: ${POOL_ID}"
gcloud iam workload-identity-pools describe "${POOL_ID}" --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create "${POOL_ID}" --location=global --display-name="GitHub"

echo "[4/6] ensure WIF provider: ${PROVIDER_ID}"
gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
  --workload-identity-pool="${POOL_ID}" --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}" \
    --location=global --workload-identity-pool="${POOL_ID}" \
    --display-name="GitHub OIDC" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.actor=assertion.actor,attribute.aud=assertion.aud" \
    --attribute-condition="attribute.repository=='${ORG_REPO}' && (attribute.ref=='refs/heads/main' || attribute.ref.startsWith('refs/tags/v'))"

echo "[5/7] bind WIF to CI SA"
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${ORG_REPO}" \
  --role="roles/iam.workloadIdentityUser" --project "${PROJECT_ID}" --quiet >/dev/null

echo "[6/7] grant bucket IAM permissions"
REGION=${REGION:-asia-northeast1}
if [[ "${SKIP_BUCKET_IAM:-}" == "1" ]]; then
  echo "  ℹ️  SKIP_BUCKET_IAM=1 specified. Skipping bucket IAM bindings."
elif [[ -z "${BUCKET_STG:-}" && -z "${BUCKET_PRD:-}" ]]; then
  echo "  ❌ Error: BUCKET_STG and BUCKET_PRD are required for bucket IAM permissions." >&2
  echo "  💡 To grant bucket permissions, run:" >&2
  echo "     BUCKET_STG=<bucket-name> BUCKET_PRD=<bucket-name> $0" >&2
  echo "  💡 To skip bucket IAM permissions (e.g., before buckets exist), run:" >&2
  echo "     SKIP_BUCKET_IAM=1 $0" >&2
  exit 1
fi
if [[ "${SKIP_BUCKET_IAM:-}" != "1" && (-n "${BUCKET_STG:-}" || -n "${BUCKET_PRD:-}") ]]; then
  if [[ -n "${BUCKET_STG:-}" ]]; then
    echo "  Granting permissions to gs://${BUCKET_STG}..."
    # バケットの存在確認
    if ! gcloud storage buckets describe "gs://${BUCKET_STG}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
      echo "  ⚠️  Warning: Bucket gs://${BUCKET_STG} does not exist. Skipping IAM bindings."
    else
      gcloud storage buckets add-iam-policy-binding "gs://${BUCKET_STG}" \
        --member="serviceAccount:${SA_EMAIL}" \
        --role="roles/storage.objectAdmin" \
        --project "${PROJECT_ID}" \
        --quiet || echo "  ⚠️  Warning: Failed to grant roles/storage.objectAdmin (may already exist)"
      gcloud storage buckets add-iam-policy-binding "gs://${BUCKET_STG}" \
        --member="serviceAccount:${SA_EMAIL}" \
        --role="roles/storage.bucketViewer" \
        --project "${PROJECT_ID}" \
        --quiet || echo "  ⚠️  Warning: Failed to grant roles/storage.bucketViewer (may already exist)"
      gcloud storage buckets add-iam-policy-binding "gs://${BUCKET_STG}" \
        --member="serviceAccount:${SA_EMAIL}" \
        --role="roles/storage.legacyBucketReader" \
        --project "${PROJECT_ID}" \
        --quiet || echo "  ⚠️  Warning: Failed to grant roles/storage.legacyBucketReader (may already exist)"
      echo "  ✓ Permissions granted to gs://${BUCKET_STG}"
    fi
  fi
  if [[ -n "${BUCKET_PRD:-}" ]]; then
    echo "  Granting permissions to gs://${BUCKET_PRD}..."
    # バケットの存在確認
    if ! gcloud storage buckets describe "gs://${BUCKET_PRD}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
      echo "  ⚠️  Warning: Bucket gs://${BUCKET_PRD} does not exist. Skipping IAM bindings."
    else
      gcloud storage buckets add-iam-policy-binding "gs://${BUCKET_PRD}" \
        --member="serviceAccount:${SA_EMAIL}" \
        --role="roles/storage.objectAdmin" \
        --project "${PROJECT_ID}" \
        --quiet || echo "  ⚠️  Warning: Failed to grant roles/storage.objectAdmin (may already exist)"
      gcloud storage buckets add-iam-policy-binding "gs://${BUCKET_PRD}" \
        --member="serviceAccount:${SA_EMAIL}" \
        --role="roles/storage.bucketViewer" \
        --project "${PROJECT_ID}" \
        --quiet || echo "  ⚠️  Warning: Failed to grant roles/storage.bucketViewer (may already exist)"
      gcloud storage buckets add-iam-policy-binding "gs://${BUCKET_PRD}" \
        --member="serviceAccount:${SA_EMAIL}" \
        --role="roles/storage.legacyBucketReader" \
        --project "${PROJECT_ID}" \
        --quiet || echo "  ⚠️  Warning: Failed to grant roles/storage.legacyBucketReader (may already exist)"
      echo "  ✓ Permissions granted to gs://${BUCKET_PRD}"
    fi
  fi
fi

echo "[7/7] done"
echo "SA_EMAIL=${SA_EMAIL}"
echo "WIF_PROVIDER=projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"


