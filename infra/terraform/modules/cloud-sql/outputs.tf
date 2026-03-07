output "instance_name" { value = google_sql_database_instance.db.name }
output "database_url_secret_name" {
  value      = google_secret_manager_secret.database_url.name
  depends_on = [google_secret_manager_secret_version.database_url_v]
}
output "cloudsql_ca_cert_secret_name" {
  value      = google_secret_manager_secret.cloudsql_ca_cert.name
  depends_on = [google_secret_manager_secret_version.cloudsql_ca_cert_v]
}
