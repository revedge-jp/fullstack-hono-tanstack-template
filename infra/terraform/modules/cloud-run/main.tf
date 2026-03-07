# Resolve latest image digests so Terraform detects changes
data "google_artifact_registry_docker_image" "server_latest" {
  project       = var.project_id
  location      = var.artifact_registry_location
  repository_id = var.repository_id
  image_name    = "server:latest"
}

data "google_artifact_registry_docker_image" "client_latest" {
  project       = var.project_id
  location      = var.artifact_registry_location
  repository_id = var.repository_id
  image_name    = "client:latest"
}

resource "google_cloud_run_v2_service" "server" {
  name                = var.run_service_name_server
  location            = var.region
  deletion_protection = var.deletion_protection
  labels              = var.labels

  # 初回デプロイ時のみ有効（その後は rollout スクリプトで管理）
  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  # トラフィック設定は rollout スクリプトで管理
  # Terraform apply 時に新しいリビジョンが作成されても、トラフィックは切り替わらない
  lifecycle {
    ignore_changes = [
      traffic,
    ]
  }

  template {
    service_account = var.server_sa_email

    scaling {
      min_instance_count = var.server_min_instance_count
      max_instance_count = var.server_max_instance_count
    }

    containers {
      image = "${var.image_base_url}/server:latest"
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "APP_ENV"
        value = var.app_env
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = var.database_url_secret_name
            version = "latest"
          }
        }
      }
      env {
        name  = "CORS_ORIGIN"
        value = var.cors_origin
      }
      # Firebase Admin SDK用（Identity Platform認証）
      env {
        name  = "FIREBASE_PROJECT_ID"
        value = var.project_id
      }
      dynamic "env" {
        for_each = var.server_env
        content {
          name  = env.key
          value = env.value
        }
      }
      ports {
        container_port = 8080
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true # 運用サービスにあわせて要調整
        startup_cpu_boost = true # 起動時にCPUを一時的にブーストして冷間起動を高速化
      }

      volume_mounts {
        name       = "cloudsql-ca-cert"
        mount_path = "/secrets/cloudsql"
      }

      # Startup probe: コンテナ起動確認（DB非依存）
      startup_probe {
        http_get {
          path = "/api/health/live"
          port = 8080
        }
        initial_delay_seconds = 2
        period_seconds        = 4
        failure_threshold     = 10
        timeout_seconds       = 3
      }
    }

    volumes {
      name = "cloudsql-ca-cert"
      secret {
        secret = var.cloudsql_ca_cert_secret_name
        items {
          version = "latest"
          path    = "server-ca.pem"
        }
      }
    }

    vpc_access {
      connector = var.connector_id
      # Cloud SQL (private IP) のみVPCアクセスが必要なため PRIVATE_RANGES_ONLY で十分
      egress = "PRIVATE_RANGES_ONLY"
    }
  }

  # INGRESS_TRAFFIC_INTERNAL_ONLY: VPC内部からのアクセスのみ許可（内部専用）
  # - Client (SSR) からのアクセス: VPC Connector経由（client SAで認証）
  # 外部からの直接アクセスは完全にブロック
  ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"
}

# 内部専用アクセス（client SA のみ許可）
# allUsers は削除し、VPC内部からのみアクセス可能
resource "google_cloud_run_v2_service_iam_policy" "server_access" {
  location    = google_cloud_run_v2_service.server.location
  name        = google_cloud_run_v2_service.server.name
  policy_data = var.server_access_policy_data
}

resource "google_cloud_run_v2_service" "client" {
  name                = var.run_service_name_client
  location            = var.region
  deletion_protection = var.deletion_protection
  labels              = var.labels

  # 初回デプロイ時のみ有効（その後は rollout スクリプトで管理）
  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  # トラフィック設定は rollout スクリプトで管理
  # Terraform apply 時に新しいリビジョンが作成されても、トラフィックは切り替わらない
  lifecycle {
    ignore_changes = [
      traffic,
    ]
  }

  template {
    service_account = var.client_sa_email

    scaling {
      min_instance_count = var.client_min_instance_count
      max_instance_count = var.client_max_instance_count
    }

    containers {
      image = "${var.image_base_url}/client:latest"
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "APP_ENV"
        value = var.app_env
      }
      # Next.js(サーバー側)専用のAPIベースURL
      # 内部通信のため直接Cloud RunのURLを使用（ロードバランサー経由は外部アクセス用）
      env {
        name  = "API_BASE_URL"
        value = google_cloud_run_v2_service.server.uri
      }
      dynamic "env" {
        for_each = var.client_env
        content {
          name  = env.key
          value = env.value
        }
      }
      ports {
        container_port = 3000
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true # 運用サービスにあわせて要調整
        startup_cpu_boost = true # 起動時にCPUを一時的にブーストして冷間起動を高速化
      }
    }

    vpc_access {
      connector = var.connector_id
      # ALL_TRAFFIC を維持: server は INGRESS_TRAFFIC_INTERNAL_ONLY のため、
      # VPC Connector 経由でなければ server.uri にアクセスできない。
      # PRIVATE_RANGES_ONLY にすると public URL へのトラフィックが VPC を迂回し、
      # server へのアクセスが拒否される。
      egress = "ALL_TRAFFIC"
    }
  }

  ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
}

# 公開アクセスを有効化（allUsers に run.invoker ロールを付与）
resource "google_cloud_run_v2_service_iam_policy" "client_noauth" {
  location    = google_cloud_run_v2_service.client.location
  name        = google_cloud_run_v2_service.client.name
  policy_data = var.noauth_policy_data
}
