output "target_profile" {
  description = "Target profile identifier"
  value       = "aws"
}

output "plan_only" {
  description = "Whether the module is in plan-only dry-run mode"
  value       = var.plan_only
}

output "chargeable" {
  description = "Whether chargeable resources are permitted"
  value       = var.chargeable
}

output "alb_dns_name" {
  description = "DNS name of the ALB"
  value       = local.is_provisionable ? aws_lb.main[0].dns_name : "dry-run.adaptiveops.local"
}
