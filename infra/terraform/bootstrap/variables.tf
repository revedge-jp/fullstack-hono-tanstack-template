variable "project_id" {
  type        = string
  description = "GCP Project ID"
}

variable "region" {
  type        = string
  default     = "asia-northeast1"
  description = "GCP region"
}

variable "prefix" {
  type        = string
  default     = "ax"
  description = "Resource name prefix"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,19}$", var.prefix))
    error_message = "prefix must be 2-20 characters, lowercase alphanumeric and hyphens only, starting with a letter"
  }
}

variable "github_repo" {
  type        = string
  description = "GitHub repository in org/repo format (e.g. my-org/my-repo)"
}

variable "deployer_sa_id" {
  type        = string
  default     = "ci-deployer"
  description = "Service account ID for CI/CD deployer"
}

variable "wif_pool_id" {
  type        = string
  description = "Workload Identity Federation pool ID (must be unique per repository)"
}

variable "wif_provider_id" {
  type        = string
  description = "Workload Identity Federation provider ID (must be unique per repository)"
}

variable "environment" {
  type        = string
  default     = "stg"
  description = "Target environment (stg or prd)"

  validation {
    condition     = contains(["stg", "prd"], var.environment)
    error_message = "environment must be either 'stg' or 'prd'"
  }
}
