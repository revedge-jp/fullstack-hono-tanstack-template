variable "project_id" { type = string }

variable "region" {
  type    = string
  default = "asia-northeast1"
}

variable "location" {
  type    = string
  default = "asia-northeast1"
}

variable "artifact_registry_location" {
  type    = string
  default = "asia-northeast1"
}

variable "prefix" {
  type        = string
  default     = "ax"
  description = "Resource name prefix. All resources will be named with this prefix."

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,19}$", var.prefix))
    error_message = "prefix must be 2-20 characters, lowercase alphanumeric and hyphens only, starting with a letter"
  }
}

variable "network_name" {
  type    = string
  default = null
}

variable "subnet_name" {
  type    = string
  default = null
}

variable "connector_name" {
  type    = string
  default = null
}

variable "db_instance_name" {
  type    = string
  default = null
}

variable "db_database_name" {
  type    = string
  default = "app"
}

variable "db_user" {
  type    = string
  default = "appuser"
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "run_service_name_server" {
  type    = string
  default = null
}

variable "run_service_name_client" {
  type    = string
  default = null
}

variable "neg_name_client" {
  type    = string
  default = null
}

variable "server_env" {
  type        = map(string)
  default     = {}
  description = "Environment variables for server Cloud Run (overrides)"
}

variable "client_env" {
  type        = map(string)
  default     = {}
  description = "Environment variables for client Cloud Run (overrides)"
}

variable "deployer_service_account" {
  type        = string
  default     = ""
  description = "Service account email used to run Terraform (granted iam.serviceAccountUser on runtime SAs)"
}

variable "load_balancer_domain" {
  type        = string
  default     = ""
  description = "Custom domain for load balancer (required if enable_ssl is true)"
}

variable "enable_ssl" {
  type        = bool
  default     = false
  description = "Enable HTTPS with managed SSL certificate"
}

# ----------------------------------------------------------------------------
# Cloud Run 設定
# ----------------------------------------------------------------------------
variable "cloud_run_deletion_protection" {
  type        = bool
  default     = true
  description = "Enable deletion protection for Cloud Run services"
}

variable "cloud_run_server_min_instances" {
  type        = number
  default     = 0
  description = "Minimum number of instances for server Cloud Run. Set to 1+ in production to avoid cold starts."
}

variable "cloud_run_server_max_instances" {
  type        = number
  default     = 4
  description = "Maximum number of instances for server Cloud Run."
}

variable "cloud_run_client_min_instances" {
  type        = number
  default     = 0
  description = "Minimum number of instances for client Cloud Run. Set to 1+ in production to avoid cold starts."
}

variable "cloud_run_client_max_instances" {
  type        = number
  default     = 4
  description = "Maximum number of instances for client Cloud Run."
}

# ----------------------------------------------------------------------------
# Cloud Armor (WAF) 設定
# ----------------------------------------------------------------------------
variable "enable_cloud_armor" {
  type        = bool
  default     = true
  description = "Enable Cloud Armor security policy (WAF + rate limiting). Cloud Armor Standard is free."
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

# ----------------------------------------------------------------------------
# Cloud SQL 設定（本番環境では適切な値に変更してください）
# ----------------------------------------------------------------------------
variable "db_tier" {
  type        = string
  default     = "db-f1-micro"
  description = "Cloud SQL instance tier (e.g., db-f1-micro for dev, db-n1-standard-1 for prod)"
}

variable "db_availability_type" {
  type        = string
  default     = "ZONAL"
  description = "Cloud SQL availability type: ZONAL (single zone) or REGIONAL (high availability)"

  validation {
    condition     = contains(["ZONAL", "REGIONAL"], var.db_availability_type)
    error_message = "db_availability_type must be either ZONAL or REGIONAL"
  }
}

variable "db_backup_enabled" {
  type        = bool
  default     = false
  description = "Enable automated backups for Cloud SQL (recommended for production)"
}

variable "db_backup_start_time" {
  type        = string
  default     = "03:00"
  description = "Start time for backup window in UTC (HH:MM format)"
}

variable "db_point_in_time_recovery_enabled" {
  type        = bool
  default     = false
  description = "Enable point-in-time recovery for Cloud SQL (requires backup to be enabled)"
}

variable "db_disk_type" {
  type        = string
  default     = "PD_HDD"
  description = "Cloud SQL disk type: PD_HDD or PD_SSD"

  validation {
    condition     = contains(["PD_HDD", "PD_SSD"], var.db_disk_type)
    error_message = "db_disk_type must be either PD_HDD or PD_SSD"
  }
}

variable "db_disk_size" {
  type        = number
  default     = 10
  description = "Cloud SQL disk size in GB"
}

# ----------------------------------------------------------------------------
# Identity Platform（Google認証）設定
# ----------------------------------------------------------------------------
variable "google_oauth_client_id" {
  type        = string
  default     = ""
  description = "Google OAuth 2.0 Client ID for Identity Platform"
}

variable "google_oauth_client_secret" {
  type        = string
  sensitive   = true
  default     = ""
  description = "Google OAuth 2.0 Client Secret for Identity Platform"
}

# ----------------------------------------------------------------------------
# アプリケーション環境設定
# ----------------------------------------------------------------------------
variable "app_env" {
  description = "Application environment (development, staging, production)"
  type        = string
  default     = "production"
  validation {
    condition     = contains(["development", "staging", "production"], var.app_env)
    error_message = "app_env must be one of: development, staging, production"
  }
}

# ----------------------------------------------------------------------------
# ラベル設定
# ----------------------------------------------------------------------------
variable "labels" {
  type        = map(string)
  default     = {}
  description = "Additional labels to apply to all resources"
}

# ----------------------------------------------------------------------------
# Cloud SQL メンテナンスウィンドウ / Query Insights 設定
# ----------------------------------------------------------------------------
variable "db_maintenance_window_day" {
  type        = number
  default     = 1
  description = "Day of week for maintenance window (1=Monday, 7=Sunday)"
}

variable "db_maintenance_window_hour" {
  type        = number
  default     = 2
  description = "Hour of day (UTC) for maintenance window start (0-23)"
}

variable "db_maintenance_window_update_track" {
  type        = string
  default     = "stable"
  description = "Update track for maintenance window: stable or canary"
}

variable "db_query_insights_enabled" {
  type        = bool
  default     = true
  description = "Enable Query Insights for Cloud SQL"
}

# ----------------------------------------------------------------------------
# Uptime Check 設定
# ----------------------------------------------------------------------------
variable "uptime_check_host" {
  type        = string
  default     = ""
  description = "Hostname for uptime check (e.g., example.com). Leave empty to disable uptime check."
}

# ----------------------------------------------------------------------------
# Monitoring 設定
# ----------------------------------------------------------------------------
variable "enable_monitoring" {
  type        = bool
  default     = true
  description = "Enable Cloud Monitoring alert policies"
}

variable "alert_notification_channels" {
  type        = list(string)
  default     = []
  description = "List of notification channel IDs for alerts (e.g., email, Slack)"
}

variable "enable_iam_change_alert" {
  type        = bool
  default     = true
  description = "Enable IAM policy change detection alert. Requires roles/logging.configWriter on deployer SA."
}

