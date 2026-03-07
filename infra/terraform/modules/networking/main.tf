resource "google_compute_network" "vpc" {
  name                    = var.network_name
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "subnet" {
  name          = var.subnet_name
  ip_cidr_range = "10.10.0.0/24"
  region        = var.region
  network       = google_compute_network.vpc.id
}

# Serverless VPC Access connector for Cloud Run
resource "google_vpc_access_connector" "connector" {
  name           = var.connector_name
  region         = var.region
  network        = google_compute_network.vpc.name
  ip_cidr_range  = "10.8.0.0/28"
  machine_type   = "e2-micro"
  min_throughput = 200
  max_throughput = 300
}

# Private Service Connect to enable Private IP for Cloud SQL
resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_service_range.name]
}

resource "google_compute_global_address" "private_service_range" {
  name          = var.private_service_range_name
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}
