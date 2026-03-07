variable "project_id" { type = string }
variable "sa_server_id" { type = string }
variable "sa_client_id" { type = string }
variable "sa_migrate_id" { type = string }
variable "deployer_service_account" {
  type    = string
  default = ""
}
