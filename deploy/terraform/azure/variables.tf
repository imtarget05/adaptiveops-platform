variable "location" {
  type        = string
  description = "Azure region"
  default     = "eastus"
}

variable "environment" {
  type        = string
  description = "Deployment environment name"
  default     = "production-cloud"
}

variable "app_version" {
  type        = string
  description = "Docker image tag for Order Service"
  default     = "1.0.0"
}

variable "enable_chargeable_resources" {
  type        = bool
  description = "Safety gate: must be explicitly true to provision real cloud resources"
  default     = false
}

variable "chargeable" {
  type        = bool
  description = "Safety gate: disallows chargeable resource creation"
  default     = false
}

variable "plan_only" {
  type        = bool
  description = "Safety gate: enforces plan-only execution"
  default     = true
}

variable "budget_limit_usd" {
  type        = number
  description = "Budget limit for deployment"
  default     = 0.00
}

variable "client_id" {
  type        = string
  description = "Client ID of the User Assigned Identity"
  default     = "00000000-0000-0000-0000-000000000000"
}

variable "tenant_id" {
  type        = string
  description = "Azure Tenant ID"
  default     = "00000000-0000-0000-0000-000000000000"
}

variable "subscription_id" {
  type        = string
  description = "Azure Subscription ID"
  default     = "00000000-0000-0000-0000-000000000000"
}
