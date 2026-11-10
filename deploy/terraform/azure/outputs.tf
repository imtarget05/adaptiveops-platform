output "target_profile" {
  description = "Target profile identifier"
  value       = "azure"
}

output "plan_only" {
  description = "Whether the module is in plan-only dry-run mode"
  value       = var.plan_only
}

output "chargeable" {
  description = "Whether chargeable resources are permitted"
  value       = var.chargeable
}

output "container_app_fqdn" {
  description = "FQDN of the Azure Container App"
  value       = local.is_provisionable ? azurerm_container_app.order_service[0].latest_revision_fqdn : "dry-run.azurecontainerapps.io"
}
