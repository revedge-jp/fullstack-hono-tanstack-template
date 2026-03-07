output "deployer_sa_email" {
  value       = google_service_account.deployer.email
  description = "CI/CD deployer service account email"
}

output "wif_provider" {
  value       = google_iam_workload_identity_pool_provider.github.name
  description = "Full WIF provider resource name"
}

output "tfstate_bucket" {
  value       = google_storage_bucket.tfstate.name
  description = "Terraform state bucket name for this environment"
}
