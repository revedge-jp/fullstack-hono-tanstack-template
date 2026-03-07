output "server_sa_email" { value = google_service_account.server.email }
output "client_sa_email" { value = google_service_account.client.email }
output "migrate_sa_email" { value = google_service_account.migrate.email }
output "server_access_policy_data" { value = data.google_iam_policy.server_access.policy_data }
output "noauth_policy_data" { value = data.google_iam_policy.noauth.policy_data }
