# =============================================================================
# Root module - モジュール呼び出し集約
# =============================================================================

module "networking" {
  source = "./modules/networking"

  region                     = var.region
  network_name               = local.network_name
  subnet_name                = local.subnet_name
  connector_name             = local.connector_name
  private_service_range_name = local.private_service_range_name

  depends_on = [google_project_service.apis]
}

module "cloud_sql" {
  source = "./modules/cloud-sql"

  region                             = var.region
  db_instance_name                   = local.db_instance_name
  db_database_name                   = var.db_database_name
  db_user                            = var.db_user
  db_password                        = var.db_password
  db_tier                            = var.db_tier
  db_availability_type               = var.db_availability_type
  db_disk_type                       = var.db_disk_type
  db_disk_size                       = var.db_disk_size
  db_backup_enabled                  = var.db_backup_enabled
  db_backup_start_time               = var.db_backup_start_time
  db_point_in_time_recovery_enabled  = var.db_point_in_time_recovery_enabled
  db_maintenance_window_day          = var.db_maintenance_window_day
  db_maintenance_window_hour         = var.db_maintenance_window_hour
  db_maintenance_window_update_track = var.db_maintenance_window_update_track
  db_query_insights_enabled          = var.db_query_insights_enabled
  vpc_id                             = module.networking.vpc_id
  database_url_secret_id             = local.database_url_secret_id
  cloudsql_ca_cert_secret_id         = local.cloudsql_ca_cert_secret_id
  labels                             = local.common_labels

  depends_on = [module.networking]
}

module "artifact_registry" {
  source = "./modules/artifact-registry"

  project_id    = var.project_id
  location      = var.artifact_registry_location
  repository_id = local.artifact_registry_repo_id

  depends_on = [google_project_service.apis]
}

module "iam" {
  source = "./modules/iam"

  project_id               = var.project_id
  sa_server_id             = local.sa_server_id
  sa_client_id             = local.sa_client_id
  sa_migrate_id            = local.sa_migrate_id
  deployer_service_account = var.deployer_service_account
}

module "cloud_run" {
  source = "./modules/cloud-run"

  project_id                   = var.project_id
  region                       = var.region
  artifact_registry_location   = var.artifact_registry_location
  repository_id                = module.artifact_registry.repository_id
  run_service_name_server      = local.run_service_name_server
  run_service_name_client      = local.run_service_name_client
  server_sa_email              = module.iam.server_sa_email
  client_sa_email              = module.iam.client_sa_email
  image_base_url               = module.artifact_registry.image_base_url
  database_url_secret_name     = module.cloud_sql.database_url_secret_name
  cloudsql_ca_cert_secret_name = module.cloud_sql.cloudsql_ca_cert_secret_name
  connector_id                 = module.networking.connector_id
  app_env                      = var.app_env
  cors_origin                  = var.load_balancer_domain != "" ? "https://${var.load_balancer_domain}" : "http://${module.load_balancer.lb_ip_address}"
  server_env                   = var.server_env
  client_env                   = var.client_env
  deletion_protection          = var.cloud_run_deletion_protection
  server_min_instance_count    = var.cloud_run_server_min_instances
  server_max_instance_count    = var.cloud_run_server_max_instances
  client_min_instance_count    = var.cloud_run_client_min_instances
  client_max_instance_count    = var.cloud_run_client_max_instances
  labels                       = local.common_labels
  server_access_policy_data    = module.iam.server_access_policy_data
  noauth_policy_data           = module.iam.noauth_policy_data
}

module "cloud_run_job" {
  source = "./modules/cloud-run-job"

  project_id                   = var.project_id
  region                       = var.region
  job_name                     = local.job_migrate_name
  migrate_sa_email             = module.iam.migrate_sa_email
  image_base_url               = module.artifact_registry.image_base_url
  database_url_secret_name     = module.cloud_sql.database_url_secret_name
  cloudsql_ca_cert_secret_name = module.cloud_sql.cloudsql_ca_cert_secret_name
  connector_id                 = module.networking.connector_id
}

module "load_balancer" {
  source = "./modules/load-balancer"

  region                          = var.region
  client_service_name             = module.cloud_run.client_name
  enable_ssl                      = var.enable_ssl
  load_balancer_domain            = var.load_balancer_domain
  neg_name_client                 = local.neg_name_client
  client_backend_name             = local.client_backend_name
  url_map_name                    = local.url_map_name
  http_proxy_name                 = local.http_proxy_name
  http_forwarding_name            = local.http_forwarding_name
  https_proxy_name                = local.https_proxy_name
  https_forwarding_name           = local.https_forwarding_name
  lb_ip_name                      = local.lb_ip_name
  lb_ssl_cert_name                = local.lb_ssl_cert_name
  enable_cloud_armor              = var.enable_cloud_armor
  cloud_armor_rate_limit_count    = var.cloud_armor_rate_limit_count
  cloud_armor_rate_limit_interval = var.cloud_armor_rate_limit_interval
}

module "identity_platform" {
  source = "./modules/identity-platform"
  count  = var.google_oauth_client_id != "" ? 1 : 0

  project_id                 = var.project_id
  google_oauth_client_id     = var.google_oauth_client_id
  google_oauth_client_secret = var.google_oauth_client_secret
  load_balancer_domain       = var.load_balancer_domain
  app_env                    = var.app_env
}

module "monitoring" {
  source = "./modules/monitoring"
  count  = var.enable_monitoring ? 1 : 0

  project_id                  = var.project_id
  prefix                      = var.prefix
  db_instance_name            = local.db_instance_name
  alert_notification_channels = var.alert_notification_channels
  enable_iam_change_alert     = var.enable_iam_change_alert
  uptime_check_host           = var.uptime_check_host
  uptime_check_use_ssl        = var.enable_ssl
}
