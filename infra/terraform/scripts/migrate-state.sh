#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Terraform State Migration Script
# =============================================================================
# フラット構成からモジュール構成への state 移行を行います。
#
# 使い方:
#   cd infra/terraform
#   terraform state pull > backup.json   # バックアップ
#   terraform init                        # モジュール登録
#   bash scripts/migrate-state.sh         # state 移行
#   terraform plan                        # "No changes" を確認
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "[INFO]  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# state にリソースが存在する場合のみ mv を実行
safe_mv() {
  local src="$1"
  local dst="$2"
  if terraform state list 2>/dev/null | grep -qF "$src"; then
    info "Moving: $src -> $dst"
    terraform state mv "$src" "$dst"
  else
    warn "Skipping (not in state): $src"
  fi
}

echo "============================================"
echo " Terraform State Migration"
echo " flat structure -> module structure"
echo "============================================"
echo ""

# ---- networking ----
info "=== networking ==="
safe_mv 'google_compute_network.vpc' \
        'module.networking.google_compute_network.vpc'
safe_mv 'google_compute_subnetwork.subnet' \
        'module.networking.google_compute_subnetwork.subnet'
safe_mv 'google_vpc_access_connector.connector' \
        'module.networking.google_vpc_access_connector.connector'
safe_mv 'google_service_networking_connection.private_vpc_connection' \
        'module.networking.google_service_networking_connection.private_vpc_connection'
safe_mv 'google_compute_global_address.private_service_range' \
        'module.networking.google_compute_global_address.private_service_range'

# ---- cloud-sql ----
info "=== cloud-sql ==="
safe_mv 'google_sql_database_instance.db' \
        'module.cloud_sql.google_sql_database_instance.db'
safe_mv 'google_sql_database.app' \
        'module.cloud_sql.google_sql_database.app'
safe_mv 'google_sql_user.app' \
        'module.cloud_sql.google_sql_user.app'
safe_mv 'google_secret_manager_secret.database_url' \
        'module.cloud_sql.google_secret_manager_secret.database_url'
safe_mv 'google_secret_manager_secret_version.database_url_v' \
        'module.cloud_sql.google_secret_manager_secret_version.database_url_v'

# ---- artifact-registry ----
info "=== artifact-registry ==="
safe_mv 'google_artifact_registry_repository.repo' \
        'module.artifact_registry.google_artifact_registry_repository.repo'

# ---- iam ----
info "=== iam ==="
safe_mv 'google_service_account.server' \
        'module.iam.google_service_account.server'
safe_mv 'google_service_account.client' \
        'module.iam.google_service_account.client'
safe_mv 'google_service_account.migrate' \
        'module.iam.google_service_account.migrate'
safe_mv 'google_project_iam_member.server_secret_access' \
        'module.iam.google_project_iam_member.server_secret_access'
safe_mv 'google_project_iam_member.client_secret_access' \
        'module.iam.google_project_iam_member.client_secret_access'
safe_mv 'google_project_iam_member.server_vpcaccess' \
        'module.iam.google_project_iam_member.server_vpcaccess'
safe_mv 'google_project_iam_member.client_vpcaccess' \
        'module.iam.google_project_iam_member.client_vpcaccess'
safe_mv 'google_project_iam_member.migrate_secret_access' \
        'module.iam.google_project_iam_member.migrate_secret_access'
safe_mv 'google_project_iam_member.migrate_vpcaccess' \
        'module.iam.google_project_iam_member.migrate_vpcaccess'
safe_mv 'google_service_account_iam_member.server_actas_by_run_agent' \
        'module.iam.google_service_account_iam_member.server_actas_by_run_agent'
safe_mv 'google_service_account_iam_member.client_actas_by_run_agent' \
        'module.iam.google_service_account_iam_member.client_actas_by_run_agent'
safe_mv 'google_service_account_iam_member.migrate_actas_by_run_agent' \
        'module.iam.google_service_account_iam_member.migrate_actas_by_run_agent'

# deployer (conditional - may not exist in state)
safe_mv 'google_service_account_iam_member.server_actas_by_deployer[0]' \
        'module.iam.google_service_account_iam_member.server_actas_by_deployer[0]'
safe_mv 'google_service_account_iam_member.client_actas_by_deployer[0]' \
        'module.iam.google_service_account_iam_member.client_actas_by_deployer[0]'
safe_mv 'google_service_account_iam_member.migrate_actas_by_deployer[0]' \
        'module.iam.google_service_account_iam_member.migrate_actas_by_deployer[0]'
safe_mv 'google_project_iam_member.deployer_secret_access[0]' \
        'module.iam.google_project_iam_member.deployer_secret_access[0]'

# ---- cloud-run ----
info "=== cloud-run ==="
safe_mv 'google_cloud_run_v2_service.server' \
        'module.cloud_run.google_cloud_run_v2_service.server'
safe_mv 'google_cloud_run_v2_service.client' \
        'module.cloud_run.google_cloud_run_v2_service.client'
safe_mv 'google_cloud_run_v2_service_iam_policy.server_access' \
        'module.cloud_run.google_cloud_run_v2_service_iam_policy.server_access'
safe_mv 'google_cloud_run_v2_service_iam_policy.client_noauth' \
        'module.cloud_run.google_cloud_run_v2_service_iam_policy.client_noauth'

# ---- cloud-run-job ----
info "=== cloud-run-job ==="
safe_mv 'google_cloud_run_v2_job.db_migrate' \
        'module.cloud_run_job.google_cloud_run_v2_job.db_migrate'

# ---- load-balancer ----
info "=== load-balancer ==="
safe_mv 'google_compute_global_address.lb_ip' \
        'module.load_balancer.google_compute_global_address.lb_ip'
safe_mv 'google_compute_region_network_endpoint_group.client_neg' \
        'module.load_balancer.google_compute_region_network_endpoint_group.client_neg'
safe_mv 'google_compute_backend_service.client_backend' \
        'module.load_balancer.google_compute_backend_service.client_backend'
safe_mv 'google_compute_url_map.main' \
        'module.load_balancer.google_compute_url_map.main'
safe_mv 'google_compute_target_http_proxy.main' \
        'module.load_balancer.google_compute_target_http_proxy.main'
safe_mv 'google_compute_global_forwarding_rule.http' \
        'module.load_balancer.google_compute_global_forwarding_rule.http'

# SSL resources (conditional)
safe_mv 'google_compute_managed_ssl_certificate.main[0]' \
        'module.load_balancer.google_compute_managed_ssl_certificate.main[0]'
safe_mv 'google_compute_target_https_proxy.main[0]' \
        'module.load_balancer.google_compute_target_https_proxy.main[0]'
safe_mv 'google_compute_global_forwarding_rule.https[0]' \
        'module.load_balancer.google_compute_global_forwarding_rule.https[0]'

# ---- identity-platform ----
# count がリソースレベル → モジュールレベルに移動
# Before: google_project_service.identity_platform[0]
# After:  module.identity_platform[0].google_project_service.identity_platform
info "=== identity-platform ==="
safe_mv 'google_project_service.identity_platform[0]' \
        'module.identity_platform[0].google_project_service.identity_platform'
safe_mv 'google_identity_platform_config.default[0]' \
        'module.identity_platform[0].google_identity_platform_config.default'
safe_mv 'google_identity_platform_default_supported_idp_config.google[0]' \
        'module.identity_platform[0].google_identity_platform_default_supported_idp_config.google'

# ---- monitoring ----
# count がリソースレベル → モジュールレベルに移動
# Before: google_monitoring_alert_policy.cloud_run_error_rate[0]
# After:  module.monitoring[0].google_monitoring_alert_policy.cloud_run_error_rate
info "=== monitoring ==="
safe_mv 'google_monitoring_alert_policy.cloud_run_error_rate[0]' \
        'module.monitoring[0].google_monitoring_alert_policy.cloud_run_error_rate'
safe_mv 'google_monitoring_alert_policy.cloud_run_instance_count[0]' \
        'module.monitoring[0].google_monitoring_alert_policy.cloud_run_instance_count'
safe_mv 'google_monitoring_alert_policy.cloud_sql_connections[0]' \
        'module.monitoring[0].google_monitoring_alert_policy.cloud_sql_connections'
safe_mv 'google_monitoring_alert_policy.cloud_sql_cpu[0]' \
        'module.monitoring[0].google_monitoring_alert_policy.cloud_sql_cpu'

echo ""
ok "State migration complete!"
echo ""
info "Next: run 'terraform plan' to verify zero diff"
