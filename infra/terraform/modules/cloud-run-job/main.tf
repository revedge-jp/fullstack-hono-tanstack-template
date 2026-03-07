resource "google_cloud_run_v2_job" "db_migrate" {
  name                = var.job_name
  location            = var.region
  deletion_protection = false

  template {
    template {
      service_account = var.migrate_sa_email
      containers {
        image = "${var.image_base_url}/migrate:latest"
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = var.database_url_secret_name
              version = "latest"
            }
          }
        }
        volume_mounts {
          name       = "cloudsql-ca-cert"
          mount_path = "/secrets/cloudsql"
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
  }
}
