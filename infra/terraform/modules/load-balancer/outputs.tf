output "lb_ip_address" { value = google_compute_global_address.lb_ip.address }
output "load_balancer_url" { value = "http://${google_compute_global_address.lb_ip.address}" }
