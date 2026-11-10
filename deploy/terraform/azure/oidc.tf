# Azure User-Assigned Identity & GitHub Actions OIDC Federated Credential
resource "azurerm_user_assigned_identity" "github_deployer" {
  count               = (var.chargeable && !var.plan_only && var.enable_chargeable_resources) ? 1 : 0
  name                = "uai-adaptiveops-github-${var.environment}"
  resource_group_name = azurerm_resource_group.rg[0].name
  location            = azurerm_resource_group.rg[0].location
}

resource "azurerm_federated_identity_credential" "github_actions" {
  count               = (var.chargeable && !var.plan_only && var.enable_chargeable_resources) ? 1 : 0
  name                = "fic-adaptiveops-github-${var.environment}"
  resource_group_name = azurerm_resource_group.rg[0].name
  audience            = ["api://AzureADTokenExchange"]
  issuer              = "https://token.actions.githubusercontent.com"
  parent_id           = azurerm_user_assigned_identity.github_deployer[0].id
  subject             = "repo:adaptiveops/adaptiveops-platform:environment:${var.environment}"
}
