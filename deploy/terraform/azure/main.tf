# Safety check preventing unapproved chargeable infrastructure provisioning
check "cost_guard_safety" {
  assert {
    condition     = var.plan_only == true && var.chargeable == false && var.enable_chargeable_resources == false
    error_message = "Cost guard violation: Any action provisioning chargeable cloud resources without authorization is strictly prohibited. plan_only must be true and chargeable must be false."
  }
}

locals {
  is_provisionable = var.chargeable && !var.plan_only && var.enable_chargeable_resources
}

resource "azurerm_resource_group" "rg" {
  count    = local.is_provisionable ? 1 : 0
  name     = "rg-adaptiveops-${var.environment}"
  location = var.location
}

resource "azurerm_container_app_environment" "env" {
  count               = local.is_provisionable ? 1 : 0
  name                = "aca-env-${var.environment}"
  location            = azurerm_resource_group.rg[0].location
  resource_group_name = azurerm_resource_group.rg[0].name
}

resource "azurerm_container_app" "order_service" {
  count                        = local.is_provisionable ? 1 : 0
  name                         = "order-service-${var.environment}"
  container_app_environment_id = azurerm_container_app_environment.env[0].id
  resource_group_name          = azurerm_resource_group.rg[0].name
  revision_mode                = "Single"

  template {
    container {
      name   = "order-service"
      image  = "adaptiveops/order-service:${var.app_version}"
      cpu    = 0.25
      memory = "0.5Gi"

      readiness_probe {
        transport        = "HTTP"
        port             = 8080
        path             = "/actuator/health/readiness"
        interval_seconds = 10
      }

      liveness_probe {
        transport        = "HTTP"
        port             = 8080
        path             = "/actuator/health/liveness"
        interval_seconds = 15
      }

      startup_probe {
        transport               = "HTTP"
        port                    = 8080
        path                    = "/actuator/health/liveness"
        interval_seconds        = 5
        failure_count_threshold = 30
      }

      env {
        name  = "SPRING_PROFILES_ACTIVE"
        value = "azure"
      }
    }
  }
}
