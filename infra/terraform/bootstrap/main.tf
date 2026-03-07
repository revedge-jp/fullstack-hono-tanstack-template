terraform {
  required_version = ">= 1.5"

  # Bootstrap uses local backend (it creates the GCS buckets for the main module)
  backend "local" {}

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
    null = {
      source  = "hashicorp/null"
      version = ">= 3.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
