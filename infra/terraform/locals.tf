locals {
  repo_root = abspath("../../")

  common_labels = merge({
    managed_by  = "terraform"
    project     = var.prefix
    environment = var.app_env
  }, var.labels)

  # Resource Names (computed from prefix if not provided)
  # Note: VPC Access Connector name must be <= 25 characters (pattern: ^[a-z][-a-z0-9]{0,23}[a-z0-9]$)
  network_name   = var.network_name != null ? var.network_name : "${var.prefix}-vpc"
  subnet_name    = var.subnet_name != null ? var.subnet_name : "${var.prefix}-subnet"
  connector_name = var.connector_name != null ? var.connector_name : "${var.prefix}-vpc-c"

  db_instance_name = var.db_instance_name != null ? var.db_instance_name : "${var.prefix}-db"

  run_service_name_server = var.run_service_name_server != null ? var.run_service_name_server : "${var.prefix}-server"
  run_service_name_client = var.run_service_name_client != null ? var.run_service_name_client : "${var.prefix}-client"

  neg_name_client = var.neg_name_client != null ? var.neg_name_client : "${var.prefix}-client-neg"

  # Hardcoded names converted to prefix-based
  artifact_registry_repo_id = "${var.prefix}-repo"

  job_migrate_name = "${var.prefix}-db-migrate"

  private_service_range_name = "${var.prefix}-private-service-range"

  # IAM Service Accounts
  # Note: account_id must be 6-30 characters, so we use shortened suffixes
  sa_server_id  = "${var.prefix}-server-sa"
  sa_client_id  = "${var.prefix}-client-sa"
  sa_migrate_id = "${var.prefix}-mig-sa"

  # Secret Manager
  database_url_secret_id     = "${var.prefix}-database-url"
  cloudsql_ca_cert_secret_id = "${var.prefix}-cloudsql-server-ca"

  # Load Balancer Resources (server is internal-only, not exposed via LB)
  lb_ip_name            = "${var.prefix}-lb-ip"
  lb_ssl_cert_name      = "${var.prefix}-lb-ssl-cert"
  client_backend_name   = "${var.prefix}-client-backend"
  url_map_name          = "${var.prefix}-lb-url-map"
  http_proxy_name       = "${var.prefix}-lb-http-proxy"
  http_forwarding_name  = "${var.prefix}-lb-http-forwarding"
  https_proxy_name      = "${var.prefix}-lb-https-proxy"
  https_forwarding_name = "${var.prefix}-lb-https-forwarding"
}
