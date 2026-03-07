resource "google_storage_bucket" "tfstate" {
  name     = "tfstate-${var.prefix}-${var.environment}"
  location = var.region
  project  = var.project_id

  versioning {
    enabled = true
  }

  uniform_bucket_level_access = true

  depends_on = [google_project_service.bootstrap_apis]
}

# Grant deployer SA access to the tfstate bucket
resource "google_storage_bucket_iam_member" "deployer_object_admin" {
  bucket = google_storage_bucket.tfstate.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_storage_bucket_iam_member" "deployer_bucket_viewer" {
  bucket = google_storage_bucket.tfstate.name
  role   = "roles/storage.legacyBucketReader"
  member = "serviceAccount:${google_service_account.deployer.email}"
}
