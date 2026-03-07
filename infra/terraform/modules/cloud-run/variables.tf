variable "project_id" { type = string }
variable "region" { type = string }
variable "artifact_registry_location" { type = string }
variable "repository_id" { type = string }
variable "run_service_name_server" { type = string }
variable "run_service_name_client" { type = string }
variable "server_sa_email" { type = string }
variable "client_sa_email" { type = string }
variable "image_base_url" { type = string }
variable "database_url_secret_name" { type = string }
variable "connector_id" { type = string }
variable "app_env" { type = string }
variable "server_env" {
  type    = map(string)
  default = {}
}
variable "client_env" {
  type    = map(string)
  default = {}
}
variable "cors_origin" {
  type        = string
  default     = "*"
  description = "CORS_ORIGIN for the server (e.g. https://example.com). Defaults to * for internal-only services."
}
variable "cloudsql_ca_cert_secret_name" { type = string }
variable "deletion_protection" {
  type        = bool
  default     = true
  description = "Enable deletion protection for Cloud Run services"
}
variable "server_min_instance_count" {
  type        = number
  default     = 0
  description = "Minimum number of instances for server Cloud Run. Set to 1+ in production to avoid cold starts."
}
variable "server_max_instance_count" {
  type        = number
  default     = 4
  description = "Maximum number of instances for server Cloud Run."
}
variable "client_min_instance_count" {
  type        = number
  default     = 0
  description = "Minimum number of instances for client Cloud Run. Set to 1+ in production to avoid cold starts."
}
variable "client_max_instance_count" {
  type        = number
  default     = 4
  description = "Maximum number of instances for client Cloud Run."
}
variable "labels" {
  type    = map(string)
  default = {}
}
variable "server_access_policy_data" { type = string }
variable "noauth_policy_data" { type = string }
