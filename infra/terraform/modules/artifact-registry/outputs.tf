output "repository_id" { value = google_artifact_registry_repository.repo.repository_id }
output "location" { value = google_artifact_registry_repository.repo.location }
output "image_base_url" {
  value = "${google_artifact_registry_repository.repo.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.repo.repository_id}"
}
