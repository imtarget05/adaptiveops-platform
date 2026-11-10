variable "aws_region" {
  type        = string
  description = "AWS deployment region"
  default     = "us-east-1"
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

variable "vpc_id" {
  type        = string
  description = "Target VPC ID"
  default     = ""
}

variable "subnets" {
  type        = list(string)
  description = "Subnet IDs for ALB and ECS tasks"
  default     = []
}
