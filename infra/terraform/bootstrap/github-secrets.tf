# Set GitHub Variables using gh CLI via null_resource
# These are non-sensitive configuration values (project IDs, resource names, etc.)
# This is idempotent - gh variable set overwrites existing values
#
# Note: DB_PASSWORD_STG/PRD are secrets and intentionally NOT set here. They must be
# configured manually before the first CI/CD deploy (see setup.sh Phase 5). Unset
# DB_PASSWORD causes deploy to fail explicitly, prompting the operator to set it.

resource "null_resource" "github_variables" {
  depends_on = [
    google_service_account.deployer,
    google_iam_workload_identity_pool_provider.github,
    google_storage_bucket.tfstate,
  ]

  triggers = {
    # Re-run if any key values change
    deployer_email = google_service_account.deployer.email
    wif_provider   = google_iam_workload_identity_pool_provider.github.name
    bucket         = google_storage_bucket.tfstate.name
    environment    = var.environment
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -euo pipefail

      REPO="${var.github_repo}"
      WIF_PROVIDER="${google_iam_workload_identity_pool_provider.github.name}"
      SA_EMAIL="${google_service_account.deployer.email}"
      ENV_SUFFIX="${upper(var.environment)}"

      echo "Setting GitHub Variables ($ENV_SUFFIX) for $REPO..."

      gh variable set "$${ENV_SUFFIX}_GCP_PROJECT_ID" --repo "$REPO" --body "${var.project_id}"
      gh variable set "$${ENV_SUFFIX}_WIF_PROVIDER" --repo "$REPO" --body "$WIF_PROVIDER"
      gh variable set "$${ENV_SUFFIX}_WIF_SA" --repo "$REPO" --body "$SA_EMAIL"
      gh variable set "$${ENV_SUFFIX}_TFSTATE_BUCKET" --repo "$REPO" --body "${google_storage_bucket.tfstate.name}"

      echo "GitHub Variables ($ENV_SUFFIX) configured successfully"
    EOT
  }
}
