variable "region" { type = string }
variable "client_service_name" { type = string }
variable "enable_ssl" { type = bool }
variable "load_balancer_domain" { type = string }
variable "neg_name_client" { type = string }
variable "client_backend_name" { type = string }
variable "url_map_name" { type = string }
variable "http_proxy_name" { type = string }
variable "http_forwarding_name" { type = string }
variable "https_proxy_name" { type = string }
variable "https_forwarding_name" { type = string }
variable "lb_ip_name" { type = string }
variable "lb_ssl_cert_name" { type = string }
variable "enable_cloud_armor" {
  type        = bool
  default     = false
  description = "Enable Cloud Armor security policy (WAF + rate limiting)"
}
variable "cloud_armor_rate_limit_count" {
  type        = number
  default     = 100
  description = "Maximum requests per interval per IP before rate limiting"
}
variable "cloud_armor_rate_limit_interval" {
  type        = number
  default     = 60
  description = "Rate limit interval in seconds"
}
