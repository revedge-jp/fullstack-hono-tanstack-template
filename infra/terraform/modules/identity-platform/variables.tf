variable "project_id" { type = string }
variable "google_oauth_client_id" { type = string }
variable "google_oauth_client_secret" {
  type      = string
  sensitive = true
}
variable "load_balancer_domain" { type = string }
variable "app_env" {
  type        = string
  default     = "production"
  description = "Application environment. localhost is only authorized in non-production environments."
}
