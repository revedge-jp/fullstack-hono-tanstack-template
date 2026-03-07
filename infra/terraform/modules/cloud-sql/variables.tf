variable "region" { type = string }
variable "db_instance_name" { type = string }
variable "db_database_name" { type = string }
variable "db_user" { type = string }
variable "db_password" {
  type      = string
  sensitive = true
}
variable "db_tier" { type = string }
variable "db_availability_type" { type = string }
variable "db_disk_type" { type = string }
variable "db_disk_size" { type = number }
variable "db_backup_enabled" { type = bool }
variable "db_backup_start_time" { type = string }
variable "db_point_in_time_recovery_enabled" { type = bool }
variable "db_maintenance_window_day" {
  type    = number
  default = 1
}
variable "db_maintenance_window_hour" {
  type    = number
  default = 2
}
variable "db_maintenance_window_update_track" {
  type    = string
  default = "stable"
}
variable "db_query_insights_enabled" {
  type    = bool
  default = true
}
variable "labels" {
  type    = map(string)
  default = {}
}
variable "vpc_id" { type = string }
variable "database_url_secret_id" { type = string }
variable "cloudsql_ca_cert_secret_id" { type = string }
