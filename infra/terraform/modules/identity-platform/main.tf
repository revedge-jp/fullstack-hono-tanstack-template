# =============================================================================
# Identity Platform（Firebase Authentication）
# Google OAuth による認証を提供
#
# 注意: このモジュールは count で制御される（google_oauth_client_id が設定時のみ有効）
# =============================================================================

# Identity Platform API の有効化
resource "google_project_service" "identity_platform" {
  service            = "identitytoolkit.googleapis.com"
  disable_on_destroy = false
}

# Identity Platform 設定
resource "google_identity_platform_config" "default" {
  project = var.project_id

  sign_in {
    allow_duplicate_emails = false

    anonymous {
      enabled = false
    }

    email {
      enabled           = false
      password_required = false
    }
  }

  # 認可済みドメインの設定
  # localhost は非本番環境でのみ許可（本番環境ではセキュリティリスクのため除外）
  authorized_domains = compact([
    "${var.project_id}.firebaseapp.com",
    var.app_env != "production" ? "localhost" : null,
    var.load_balancer_domain != "" ? var.load_balancer_domain : null,
  ])

  depends_on = [google_project_service.identity_platform]
}

# Google OAuth プロバイダーの設定
resource "google_identity_platform_default_supported_idp_config" "google" {
  project       = var.project_id
  enabled       = true
  idp_id        = "google.com"
  client_id     = var.google_oauth_client_id
  client_secret = var.google_oauth_client_secret

  depends_on = [google_identity_platform_config.default]
}
