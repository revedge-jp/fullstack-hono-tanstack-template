resource "google_sql_database_instance" "db" {
  name             = var.db_instance_name
  region           = var.region
  database_version = "POSTGRES_18"

  # ============================================================================
  # GCP側の削除保護（Terraform外からの削除も防ぐ）
  # ============================================================================
  # gcloudコマンドやGCPコンソールからの直接削除を防止。
  # 本当に削除が必要な場合は、まずこのフラグをfalseにしてapplyする必要がある。
  # ============================================================================
  deletion_protection = true

  settings {
    tier              = var.db_tier
    availability_type = var.db_availability_type
    edition           = "ENTERPRISE"

    ip_configuration {
      ipv4_enabled    = false
      private_network = var.vpc_id
      # SSL/TLS接続を強制（暗号化されていない接続を拒否）
      ssl_mode = "ENCRYPTED_ONLY"
    }

    disk_type = var.db_disk_type
    disk_size = var.db_disk_size

    # パスワードポリシー（セキュリティ推奨設定）
    password_validation_policy {
      min_length                  = 12
      complexity                  = "COMPLEXITY_DEFAULT"
      disallow_username_substring = true
      enable_password_policy      = true
    }

    backup_configuration {
      enabled                        = var.db_backup_enabled
      start_time                     = var.db_backup_start_time
      point_in_time_recovery_enabled = var.db_point_in_time_recovery_enabled
      # バックアップ保持期間（デフォルト7日）
      transaction_log_retention_days = var.db_backup_enabled ? 7 : null
      backup_retention_settings {
        retained_backups = var.db_backup_enabled ? 7 : 0
      }
    }

    maintenance_window {
      day          = var.db_maintenance_window_day
      hour         = var.db_maintenance_window_hour
      update_track = var.db_maintenance_window_update_track
    }

    # 監査ログ（pgaudit）を有効化
    database_flags {
      name  = "cloudsql.enable_pgaudit"
      value = "on"
    }

    insights_config {
      query_insights_enabled  = var.db_query_insights_enabled
      record_application_tags = var.db_query_insights_enabled
      record_client_address   = false
    }

    user_labels = var.labels
  }

  lifecycle {
    # Terraform経由の削除を防止
    prevent_destroy = true
  }
}

resource "google_sql_database" "app" {
  name     = var.db_database_name
  instance = google_sql_database_instance.db.name

  lifecycle {
    # データベースは誤削除を防止（データ損失リスクを回避）
    prevent_destroy = true
  }
}

resource "google_sql_user" "app" {
  name     = var.db_user
  instance = google_sql_database_instance.db.name
  password = var.db_password

  lifecycle {
    # ============================================================================
    # CLOUD SQL ユーザーパスワードの管理方針
    # ============================================================================
    # このパスワードは Terraform ではなく secret-sync-db-url.sh で管理します。
    #
    # 理由:
    # 1. Cloud SQL API では現在のパスワードを取得できない
    # 2. 既存リソースをインポートした場合、password = null になる
    # 3. ignore_changes がないと、null から更新しようとしてエラーになる
    # 4. パスワード変更時は Secret Manager と同時更新が必要
    #
    # 運用フロー:
    # - 初回: Terraform が初期パスワードを設定
    # - 以降: CI/CD の secret-sync-db-url.sh が database-url シークレットと同期
    #
    # 参照: docs/deploy/deployment.md#5-db-パスワード運用
    # ============================================================================
    ignore_changes = [password]
  }
}

# ============================================================================
# Cloud SQL サーバー CA 証明書
# ============================================================================
# Cloud Run からの SSL 接続で証明書検証（verify-ca）を行うために、
# サーバー CA 証明書を Secret Manager に格納し、ボリュームマウントで提供する。
# ============================================================================
data "google_sql_ca_certs" "db" {
  instance = google_sql_database_instance.db.name
}

locals {
  latest_ca_cert_expiration = reverse(sort([
    for cert in data.google_sql_ca_certs.db.certs : cert.expiration_time
  ]))[0]
  latest_ca_cert = [
    for cert in data.google_sql_ca_certs.db.certs : cert.cert
    if cert.expiration_time == local.latest_ca_cert_expiration
  ][0]
}

resource "google_secret_manager_secret" "cloudsql_ca_cert" {
  secret_id = var.cloudsql_ca_cert_secret_id
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "cloudsql_ca_cert_v" {
  secret      = google_secret_manager_secret.cloudsql_ca_cert.id
  secret_data = local.latest_ca_cert
}

resource "google_secret_manager_secret" "database_url" {
  secret_id = var.database_url_secret_id
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "database_url_v" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = "postgresql://${var.db_user}:${var.db_password}@${google_sql_database_instance.db.private_ip_address}:5432/${var.db_database_name}?schema=public&sslmode=require&uselibpqcompat=true&sslrootcert=/secrets/cloudsql/server-ca.pem"

  depends_on = [google_sql_user.app]

  lifecycle {
    # ============================================================================
    # DATABASE-URL シークレットの管理方針
    # ============================================================================
    # このシークレットは Terraform ではなく secret-sync-db-url.sh で管理します。
    #
    # 理由:
    # 1. Cloud SQL のプライベートIPはインスタンス作成後にしか確定しない
    # 2. パスワード変更時は Cloud SQL ユーザーとシークレットの同時更新が必要
    # 3. URL エンコーディングの一貫性を保証するため
    #
    # 運用フロー:
    # - 初回: Terraform が初期値を作成
    # - 以降: CI/CD の secret-sync-db-url.sh が Cloud SQL パスワードと同期
    #
    # パスワード変更手順:
    # 1. GitHub Secret (DB_PASSWORD_STG) を更新、または
    # 2. terraform.tfvars の db_password を更新
    # 3. CI/CD を実行（または手動で secret-sync-db-url.sh を実行）
    #
    # 参照: docs/deploy/deployment.md#5-db-パスワード運用
    # ============================================================================
    ignore_changes = [secret_data]
  }
}
