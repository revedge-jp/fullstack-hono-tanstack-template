resource "google_service_account" "server" {
  account_id   = var.sa_server_id
  display_name = "ax server Cloud Run"
}

# Client (Next.js) 用のSA
resource "google_service_account" "client" {
  account_id   = var.sa_client_id
  display_name = "ax client Cloud Run"
}

# Cloud Run Job (DB migrate) 用のSA
resource "google_service_account" "migrate" {
  account_id   = var.sa_migrate_id
  display_name = "ax migrate job"
}

# Cloud Run サービス間認証（多層防御）
# - Network: ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY" で外部ブロック
# - IAM: client SA のみ run.invoker を付与（VPC内でも SA 認証必須）
data "google_iam_policy" "server_access" {
  binding {
    role    = "roles/run.invoker"
    members = [google_service_account.client.member]
  }
}

# Cloud Run public access (client用)
data "google_iam_policy" "noauth" {
  binding {
    role    = "roles/run.invoker"
    members = ["allUsers"]
  }
}

# Allow Cloud Run SAs to access Secret Manager
resource "google_project_iam_member" "server_secret_access" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = google_service_account.server.member
}

# NOTE: client SA does not need secretAccessor — it does not access Secret Manager directly.
# Secrets are accessed via the server SA or mounted as volumes in Cloud Run.

# Allow using Serverless VPC Access connector
resource "google_project_iam_member" "server_vpcaccess" {
  project = var.project_id
  role    = "roles/vpcaccess.user"
  member  = google_service_account.server.member
}

resource "google_project_iam_member" "client_vpcaccess" {
  project = var.project_id
  role    = "roles/vpcaccess.user"
  member  = google_service_account.client.member
}

resource "google_project_iam_member" "migrate_secret_access" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = google_service_account.migrate.member
}

resource "google_project_iam_member" "migrate_vpcaccess" {
  project = var.project_id
  role    = "roles/vpcaccess.user"
  member  = google_service_account.migrate.member
}


# Cloud Run Service Agent に Service Account User を付与（各実行用SAを起動できるようにする）
data "google_project" "project" {
  project_id = var.project_id
}

locals {
  cloud_run_service_agent = "serviceAccount:service-${data.google_project.project.number}@serverless-robot-prod.iam.gserviceaccount.com"
  deployer_member         = var.deployer_service_account != "" ? "serviceAccount:${var.deployer_service_account}" : ""
}

resource "google_service_account_iam_member" "server_actas_by_run_agent" {
  service_account_id = google_service_account.server.name
  role               = "roles/iam.serviceAccountUser"
  member             = local.cloud_run_service_agent
}

resource "google_service_account_iam_member" "client_actas_by_run_agent" {
  service_account_id = google_service_account.client.name
  role               = "roles/iam.serviceAccountUser"
  member             = local.cloud_run_service_agent
}

resource "google_service_account_iam_member" "migrate_actas_by_run_agent" {
  service_account_id = google_service_account.migrate.name
  role               = "roles/iam.serviceAccountUser"
  member             = local.cloud_run_service_agent
}

# ----------------------------------------------------------------------------
# デプロイヤSA（CI用）の権限設計
# ----------------------------------------------------------------------------
# デプロイヤSAの権限は2種類に分類される：
#
# 1. プロジェクトレベル権限（bootstrap-wif.shで管理）
#    - Terraformを実行するための前提条件となる権限
#    - 例: run.admin, secretmanager.admin, monitoring.alertPolicyEditor など
#    - 理由: Terraformの外で事前に設定しないと鶏と卵問題が発生する
#
# 2. リソースレベル権限（このファイルで管理）
#    - Terraformで作成されるリソース（実行用SA）への権限
#    - 例: 各実行用SAへの iam.serviceAccountUser
#    - 理由: 実行用SAはTerraformで作成されるため、事前に設定できない
#
# 権限の追加・変更時は、上記の分類に従って適切な場所で管理すること。
# ----------------------------------------------------------------------------

# Terraform 実行SA（デプロイヤ）に各実行用SAの actAs を付与
# これはリソースレベル権限のため、Terraformで管理する

resource "google_service_account_iam_member" "server_actas_by_deployer" {
  count              = var.deployer_service_account != "" ? 1 : 0
  service_account_id = google_service_account.server.name
  role               = "roles/iam.serviceAccountUser"
  member             = local.deployer_member
}

resource "google_service_account_iam_member" "client_actas_by_deployer" {
  count              = var.deployer_service_account != "" ? 1 : 0
  service_account_id = google_service_account.client.name
  role               = "roles/iam.serviceAccountUser"
  member             = local.deployer_member
}

resource "google_service_account_iam_member" "migrate_actas_by_deployer" {
  count              = var.deployer_service_account != "" ? 1 : 0
  service_account_id = google_service_account.migrate.name
  role               = "roles/iam.serviceAccountUser"
  member             = local.deployer_member
}

# Allow deployer SA (CI) to access Secret Manager (for reading database-url)
resource "google_project_iam_member" "deployer_secret_access" {
  count   = var.deployer_service_account != "" ? 1 : 0
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = local.deployer_member
}
