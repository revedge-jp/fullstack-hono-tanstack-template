# ============================================================================
# Cloud Monitoring - 基本的なアラート設定
# ============================================================================
# このモジュールでは、本番運用に最低限必要な監視・アラート設定を定義します。
# アラート通知先（メール、Slack等）は別途設定が必要です。
#
# 注意: このモジュールは count で制御される（enable_monitoring = true の場合のみ有効）

# ----------------------------------------------------------------------------
# Cloud Run エラーレート監視
# ----------------------------------------------------------------------------
# Cloud Run サービスで 5xx エラーが発生した場合にアラート
resource "google_monitoring_alert_policy" "cloud_run_error_rate" {
  display_name = "${var.prefix} - Cloud Run Error Rate"
  combiner     = "OR"

  conditions {
    display_name = "Cloud Run 5xx Error Rate"

    condition_threshold {
      filter = <<-EOT
        resource.type = "cloud_run_revision"
        AND resource.labels.service_name = monitoring.regex.full_match("${var.prefix}-(server|client)")
        AND metric.type = "run.googleapis.com/request_count"
        AND metric.labels.response_code_class = "5xx"
      EOT

      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 10

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.labels.service_name"]
      }
    }
  }

  # 通知先が設定されている場合のみ通知
  notification_channels = var.alert_notification_channels

  alert_strategy {
    auto_close = "604800s" # 7日後に自動クローズ
  }

  documentation {
    content   = <<-EOT
      ## Cloud Run 5xx エラーレートアラート

      Cloud Run サービスで 5xx エラーが閾値を超えました。

      ### 確認手順
      1. Cloud Run コンソールでエラーログを確認
      2. 直近のデプロイ履歴を確認
      3. 依存サービス（Cloud SQL, Secret Manager等）の状態を確認

      ### 対応
      - エラーの原因を特定し、必要に応じてロールバック
      - 根本原因を解決後、再デプロイ
    EOT
    mime_type = "text/markdown"
  }

  user_labels = {
    environment = var.prefix
    severity    = "high"
  }
}

# ----------------------------------------------------------------------------
# Cloud Run インスタンス数監視
# ----------------------------------------------------------------------------
# インスタンス数が0になった場合（コールドスタート検知）にアラート
resource "google_monitoring_alert_policy" "cloud_run_instance_count" {
  display_name = "${var.prefix} - Cloud Run Instance Count"
  combiner     = "OR"

  conditions {
    display_name = "Cloud Run No Active Instances"

    condition_threshold {
      filter = <<-EOT
        resource.type = "cloud_run_revision"
        AND resource.labels.service_name = monitoring.regex.full_match("${var.prefix}-(server|client)")
        AND metric.type = "run.googleapis.com/container/instance_count"
      EOT

      duration        = "600s" # 10分間インスタンスが0
      comparison      = "COMPARISON_LT"
      threshold_value = 1

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MEAN"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.labels.service_name"]
      }
    }
  }

  notification_channels = var.alert_notification_channels

  alert_strategy {
    auto_close = "86400s" # 1日後に自動クローズ
  }

  documentation {
    content   = <<-EOT
      ## Cloud Run インスタンス数アラート

      Cloud Run サービスのアクティブインスタンスが0になりました。
      次のリクエストでコールドスタートが発生します。

      ### 注意
      - ステージング環境では正常な場合もあります（トラフィックが少ない場合）
      - 本番環境では最小インスタンス数の設定を検討してください
    EOT
    mime_type = "text/markdown"
  }

  user_labels = {
    environment = var.prefix
    severity    = "low"
  }
}

# ----------------------------------------------------------------------------
# Cloud SQL 接続数監視
# ----------------------------------------------------------------------------
resource "google_monitoring_alert_policy" "cloud_sql_connections" {
  display_name = "${var.prefix} - Cloud SQL Connection Count"
  combiner     = "OR"

  conditions {
    display_name = "Cloud SQL High Connection Count"

    condition_threshold {
      filter = <<-EOT
        resource.type = "cloudsql_database"
        AND resource.labels.database_id = "${var.project_id}:${var.db_instance_name}"
        AND metric.type = "cloudsql.googleapis.com/database/network/connections"
      EOT

      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 80 # db-f1-micro の最大接続数は約100

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = var.alert_notification_channels

  alert_strategy {
    auto_close = "86400s"
  }

  documentation {
    content   = <<-EOT
      ## Cloud SQL 接続数アラート

      Cloud SQL への接続数が閾値を超えました。
      接続数が上限に達すると、新しい接続がタイムアウトします。

      ### 確認手順
      1. Cloud SQL コンソールで接続数の推移を確認
      2. アプリケーションの接続プール設定を確認
      3. 不要な接続がリークしていないか確認

      ### 対応
      - 接続プールサイズの調整
      - Cloud SQL インスタンスのスケールアップを検討
    EOT
    mime_type = "text/markdown"
  }

  user_labels = {
    environment = var.prefix
    severity    = "medium"
  }
}

# ----------------------------------------------------------------------------
# Cloud SQL CPU 使用率監視
# ----------------------------------------------------------------------------
resource "google_monitoring_alert_policy" "cloud_sql_cpu" {
  display_name = "${var.prefix} - Cloud SQL CPU Usage"
  combiner     = "OR"

  conditions {
    display_name = "Cloud SQL High CPU Usage"

    condition_threshold {
      filter = <<-EOT
        resource.type = "cloudsql_database"
        AND resource.labels.database_id = "${var.project_id}:${var.db_instance_name}"
        AND metric.type = "cloudsql.googleapis.com/database/cpu/utilization"
      EOT

      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8 # 80%

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = var.alert_notification_channels

  alert_strategy {
    auto_close = "86400s"
  }

  documentation {
    content   = <<-EOT
      ## Cloud SQL CPU 使用率アラート

      Cloud SQL の CPU 使用率が 80% を超えました。

      ### 確認手順
      1. 重いクエリが実行されていないか確認
      2. インデックスが適切に設定されているか確認
      3. 不要なバッチ処理が実行中でないか確認

      ### 対応
      - クエリの最適化
      - Cloud SQL インスタンスのスケールアップを検討
    EOT
    mime_type = "text/markdown"
  }

  user_labels = {
    environment = var.prefix
    severity    = "medium"
  }
}

# ----------------------------------------------------------------------------
# Cloud SQL ディスク使用率監視
# ----------------------------------------------------------------------------
resource "google_monitoring_alert_policy" "cloud_sql_disk" {
  display_name = "${var.prefix} - Cloud SQL Disk Usage"
  combiner     = "OR"

  conditions {
    display_name = "Cloud SQL High Disk Usage"

    condition_threshold {
      filter = <<-EOT
        resource.type = "cloudsql_database"
        AND resource.labels.database_id = "${var.project_id}:${var.db_instance_name}"
        AND metric.type = "cloudsql.googleapis.com/database/disk/utilization"
      EOT

      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8 # 80%

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = var.alert_notification_channels

  alert_strategy {
    auto_close = "86400s"
  }

  documentation {
    content   = <<-EOT
      ## Cloud SQL ディスク使用率アラート

      Cloud SQL のディスク使用率が 80% を超えました。

      ### 確認手順
      1. Cloud SQL コンソールでディスク使用量の推移を確認
      2. 不要なデータやログが蓄積していないか確認

      ### 対応
      - ディスクサイズの拡張（`db_disk_size` 変数を更新して terraform apply）
      - 不要なデータのクリーンアップ
    EOT
    mime_type = "text/markdown"
  }

  user_labels = {
    environment = var.prefix
    severity    = "high"
  }
}

# ----------------------------------------------------------------------------
# Cloud SQL メモリ使用率監視
# ----------------------------------------------------------------------------
resource "google_monitoring_alert_policy" "cloud_sql_memory" {
  display_name = "${var.prefix} - Cloud SQL Memory Usage"
  combiner     = "OR"

  conditions {
    display_name = "Cloud SQL High Memory Usage"

    condition_threshold {
      filter = <<-EOT
        resource.type = "cloudsql_database"
        AND resource.labels.database_id = "${var.project_id}:${var.db_instance_name}"
        AND metric.type = "cloudsql.googleapis.com/database/memory/utilization"
      EOT

      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8 # 80%

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = var.alert_notification_channels

  alert_strategy {
    auto_close = "86400s"
  }

  documentation {
    content   = <<-EOT
      ## Cloud SQL メモリ使用率アラート

      Cloud SQL のメモリ使用率が 80% を超えました。

      ### 確認手順
      1. 重いクエリや大量のコネクションが発生していないか確認
      2. Query Insights でメモリを消費するクエリを特定

      ### 対応
      - クエリの最適化
      - Cloud SQL インスタンスのスケールアップを検討
    EOT
    mime_type = "text/markdown"
  }

  user_labels = {
    environment = var.prefix
    severity    = "medium"
  }
}

# ----------------------------------------------------------------------------
# アップタイムチェック（ホスト設定時のみ）
# ----------------------------------------------------------------------------
resource "google_monitoring_uptime_check_config" "main" {
  count        = var.uptime_check_host != "" ? 1 : 0
  display_name = "${var.prefix} - Uptime Check"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path         = "/"
    port         = var.uptime_check_use_ssl ? 443 : 80
    use_ssl      = var.uptime_check_use_ssl
    validate_ssl = var.uptime_check_use_ssl
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = var.uptime_check_host
    }
  }
}

resource "google_monitoring_alert_policy" "uptime" {
  count        = var.uptime_check_host != "" ? 1 : 0
  display_name = "${var.prefix} - Uptime Alert"
  combiner     = "OR"

  conditions {
    display_name = "Uptime Check Failed"

    condition_threshold {
      filter = <<-EOT
        resource.type = "uptime_url"
        AND metric.type = "monitoring.googleapis.com/uptime_check/check_passed"
        AND metric.labels.check_id = "${one(google_monitoring_uptime_check_config.main[*].uptime_check_id)}"
      EOT

      duration        = "60s"
      comparison      = "COMPARISON_GT"
      threshold_value = 1

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.labels.host"]
      }
    }
  }

  notification_channels = var.alert_notification_channels

  alert_strategy {
    auto_close = "86400s"
  }

  documentation {
    content   = <<-EOT
      ## アップタイムアラート

      サイト (${var.uptime_check_host}) へのアップタイムチェックが失敗しました。

      ### 確認手順
      1. Cloud Run サービスの状態を確認
      2. ロードバランサーのログを確認
      3. SSL 証明書の有効期限を確認

      ### 対応
      - Cloud Run サービスの再起動
      - デプロイエラーがある場合はロールバック
    EOT
    mime_type = "text/markdown"
  }

  user_labels = {
    environment = var.prefix
    severity    = "critical"
  }
}

# ----------------------------------------------------------------------------
# IAM ポリシー変更検知
# ----------------------------------------------------------------------------
# プロジェクトの IAM ポリシーが変更された場合にアラート
# condition_matched_log には roles/logging.configWriter が必要
resource "google_monitoring_alert_policy" "iam_policy_change" {
  count        = var.enable_iam_change_alert ? 1 : 0
  display_name = "${var.prefix} - IAM Policy Change Detected"
  combiner     = "OR"

  conditions {
    display_name = "IAM Policy Change"

    condition_matched_log {
      filter = <<-EOT
        protoPayload.methodName="SetIamPolicy"
        AND resource.type="project"
      EOT
    }
  }

  notification_channels = var.alert_notification_channels

  alert_strategy {
    auto_close = "604800s" # 7日後に自動クローズ
    notification_rate_limit {
      period = "300s" # 5分間に1回まで通知
    }
  }

  documentation {
    content   = <<-EOT
      ## IAM ポリシー変更検知アラート

      プロジェクトの IAM ポリシーが変更されました。

      ### 確認手順
      1. Cloud Audit Logs で変更内容を確認
      2. 変更を行ったアカウント（actor）を特定
      3. 意図した変更かどうか確認

      ### 対応
      - 意図しない変更の場合、即座にロールバック
      - 不正アクセスの疑いがある場合、セキュリティチームに報告
    EOT
    mime_type = "text/markdown"
  }

  user_labels = {
    environment = var.prefix
    severity    = "high"
  }
}
