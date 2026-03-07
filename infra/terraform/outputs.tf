# Cloud Run Direct URIs (Used for internal references and debugging)
output "run_server_url" { value = module.cloud_run.server_uri }

# Resource Identifiers
output "artifact_repo" { value = module.artifact_registry.repository_id }

# Load Balancer outputs
output "load_balancer_ip" {
  value = module.load_balancer.lb_ip_address
}

output "load_balancer_url" {
  value = module.load_balancer.load_balancer_url
}

# Server is internal-only (not exposed via load balancer)
# Use run_server_url for internal access

output "client_url" {
  value = module.load_balancer.load_balancer_url
}

output "migrate_job_name" {
  value = module.cloud_run_job.job_name
}
