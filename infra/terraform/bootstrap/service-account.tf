resource "google_service_account" "deployer" {
  account_id   = var.deployer_sa_id
  display_name = "CI Deployer"

  depends_on = [google_project_service.bootstrap_apis]
}

locals {
  deployer_roles = [
    "roles/run.admin",
    "roles/artifactregistry.admin",
    "roles/secretmanager.admin", # Secret作成に必要。カスタムロールで代替検討可
    "roles/cloudsql.admin",      # 初回DB作成に必要。deletion_protectionで保護
    "roles/serviceusage.serviceUsageAdmin",
    "roles/resourcemanager.projectIamAdmin", # プロジェクトIAMバインディング作成に必須
    "roles/compute.networkAdmin",
    "roles/compute.loadBalancerAdmin",
    "roles/vpcaccess.admin",
    "roles/iam.serviceAccountAdmin",
    "roles/servicenetworking.networksAdmin",
    # roles/iam.securityAdmin は削除: serviceAccountAdmin + projectIamAdmin でカバー
    "roles/monitoring.editor",           # uptime check 管理に必要（alertPolicyEditor のスーパーセット）
    "roles/logging.configWriter",  # ログベースアラート(condition_matched_log)に必要
    "roles/compute.securityAdmin", # Cloud Armor セキュリティポリシー作成に必要
  ]
}

resource "google_project_iam_member" "deployer_roles" {
  for_each = toset(local.deployer_roles)

  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.deployer.email}"
}
