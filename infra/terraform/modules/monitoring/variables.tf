variable "project_id" { type = string }
variable "prefix" { type = string }
variable "db_instance_name" { type = string }
variable "alert_notification_channels" {
  type    = list(string)
  default = []
}
variable "enable_iam_change_alert" {
  type        = bool
  default     = false
  description = "Enable IAM policy change detection alert. Requires roles/logging.configWriter on deployer SA."
}
variable "uptime_check_host" {
  type        = string
  default     = ""
  description = "Hostname for uptime check. Leave empty to disable."
}
variable "uptime_check_use_ssl" {
  type        = bool
  default     = false
  description = "Use HTTPS for uptime check."
}
