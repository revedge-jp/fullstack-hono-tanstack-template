# Static IP for Load Balancer
resource "google_compute_global_address" "lb_ip" {
  name = var.lb_ip_name
}

# Cloud Run NEGs for Load Balancer backend
resource "google_compute_region_network_endpoint_group" "client_neg" {
  name                  = var.neg_name_client
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  cloud_run {
    service = var.client_service_name
  }
}

# Cloud Armor security policy (WAF + rate limiting)
resource "google_compute_security_policy" "default" {
  count = var.enable_cloud_armor ? 1 : 0
  name  = "${var.client_backend_name}-security-policy"

  # デフォルトルール: 全トラフィック許可
  rule {
    action   = "allow"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Default allow rule"
  }

  # レートリミット: IP単位でリクエスト数を制限
  rule {
    action   = "throttle"
    priority = 1000
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "XFF_IP"
      rate_limit_threshold {
        count        = var.cloud_armor_rate_limit_count
        interval_sec = var.cloud_armor_rate_limit_interval
      }
    }
    description = "Rate limit per IP"
  }
}

# Backend Services
resource "google_compute_backend_service" "client_backend" {
  name                  = var.client_backend_name
  protocol              = "HTTP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  timeout_sec           = 30
  enable_cdn            = false
  security_policy       = var.enable_cloud_armor ? one(google_compute_security_policy.default[*].id) : null

  backend {
    group = google_compute_region_network_endpoint_group.client_neg.id
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

# URL Map - Client only (server is internal-only)
# ドメイン設定時: 正しいホスト名のみ client へルーティングし、
#   IP 直接アクセスなど不正なホストはドメインへリダイレクト
# ドメイン未設定時: 全リクエストを client へ（開発用）
resource "google_compute_url_map" "main" {
  name = var.url_map_name

  # ドメイン未設定時: 全リクエストを client へ
  default_service = var.load_balancer_domain == "" ? google_compute_backend_service.client_backend.id : null

  # ドメイン設定時: IP 直接アクセスなどはドメインへリダイレクト
  dynamic "default_url_redirect" {
    for_each = var.load_balancer_domain != "" ? [1] : []
    content {
      host_redirect  = var.load_balancer_domain
      https_redirect = var.enable_ssl
      strip_query    = false
    }
  }

  # ドメイン設定時のみホストルールで正しいドメインを client へルーティング
  dynamic "host_rule" {
    for_each = var.load_balancer_domain != "" ? [1] : []
    content {
      hosts        = [var.load_balancer_domain]
      path_matcher = "client"
    }
  }

  dynamic "path_matcher" {
    for_each = var.load_balancer_domain != "" ? [1] : []
    content {
      name            = "client"
      default_service = google_compute_backend_service.client_backend.id
    }
  }
}

# HTTP → HTTPS redirect URL map (SSL有効時のみ)
resource "google_compute_url_map" "http_redirect" {
  count = var.enable_ssl ? 1 : 0
  name  = "${var.http_proxy_name}-redirect"

  default_url_redirect {
    https_redirect = true
    strip_query    = false
  }
}

# HTTP Proxy
resource "google_compute_target_http_proxy" "main" {
  name    = var.http_proxy_name
  url_map = var.enable_ssl ? google_compute_url_map.http_redirect[0].id : google_compute_url_map.main.id
}

# Global Forwarding Rule (HTTP)
resource "google_compute_global_forwarding_rule" "http" {
  name        = var.http_forwarding_name
  target      = google_compute_target_http_proxy.main.id
  port_range  = "80"
  ip_protocol = "TCP"
  ip_address  = google_compute_global_address.lb_ip.address
}

# HTTPS support (optional, controlled by enable_ssl variable)
# ドメイン変更時に証明書名が変わることで create_before_destroy が正しく動作する
# (新名で作成 → プロキシ切替 → 旧名を削除)
resource "google_compute_managed_ssl_certificate" "main" {
  count = var.enable_ssl ? 1 : 0
  name  = "${var.lb_ssl_cert_name}-${substr(md5(var.load_balancer_domain), 0, 8)}"

  managed {
    domains = [var.load_balancer_domain]
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_target_https_proxy" "main" {
  count            = var.enable_ssl ? 1 : 0
  name             = var.https_proxy_name
  url_map          = google_compute_url_map.main.id
  ssl_certificates = [google_compute_managed_ssl_certificate.main[0].id]
}

resource "google_compute_global_forwarding_rule" "https" {
  count       = var.enable_ssl ? 1 : 0
  name        = var.https_forwarding_name
  target      = google_compute_target_https_proxy.main[0].id
  port_range  = "443"
  ip_protocol = "TCP"
  ip_address  = google_compute_global_address.lb_ip.address
}
