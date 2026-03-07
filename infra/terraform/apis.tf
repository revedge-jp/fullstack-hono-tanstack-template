# NOTE: Container Registry Vulnerability Scanning APIs are intentionally NOT enabled here.
# - containeranalysis.googleapis.com
# - containerscanning.googleapis.com
# These APIs incur significant costs (per-image scan fees) and are opt-in only.
# Enable them manually in the GCP console if vulnerability scanning is required.

resource "google_project_service" "apis" {
  for_each = toset([
    // Core APIs required before others
    "serviceusage.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "iam.googleapis.com",
    "compute.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "vpcaccess.googleapis.com",
    "monitoring.googleapis.com"
  ])

  service = each.key
}


