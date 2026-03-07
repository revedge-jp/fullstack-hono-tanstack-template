output "vpc_id" { value = google_compute_network.vpc.id }
output "vpc_name" { value = google_compute_network.vpc.name }
output "connector_id" { value = google_vpc_access_connector.connector.id }
output "private_vpc_connection_id" { value = google_service_networking_connection.private_vpc_connection.id }
